import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BookingStatus, PaymentStatus } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { BookingService } from "../src/modules/bookings/services/booking.service";

// Frente 2 do roteiro de seguranca de pagamentos: dois mecanismos novos de
// contestacao — entrega de consultoria de qualidade inadequada (48h apos a
// entrega), e cobranca forcada por confirmacao unica de sessao avulsa (24h
// apos a conclusao).

const consultancyService = new ConsultancyService();
const bookingService = new BookingService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
let offerId = "";

describe("Contestações — entrega de consultoria e captura automática", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `DC_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Contest Client",
        email: `${uid("contest_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Contest Provider",
        email: `${uid("contest_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Contest Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000
      }
    });
    providerId = provider.id;

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "ONLINE_CONSULTANCY",
        title: "Consultoria de teste",
        billingCycle: "MONTHLY",
        priceCents: 20000
      }
    });
    offerId = offer.id;
  });

  afterAll(async () => {
    await prisma.disputeCase.deleteMany({ where: { clientId } });
    await prisma.trainingPlan.deleteMany({ where: { providerId } });
    await prisma.consultancyContract.deleteMany({ where: { clientId } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: offerId } });
    await prisma.payment.deleteMany({ where: { booking: { clientId } } });
    await prisma.booking.deleteMany({ where: { clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  async function makeDeliveredContract(deliveredAt: Date) {
    const request = await prisma.consultancyRequest.create({
      data: {
        providerId,
        clientId,
        status: "ACCEPTED",
        quotedOfferId: offerId,
        responseDeadlineAt: new Date(),
        respondedAt: new Date(),
        clientDecisionAt: new Date()
      }
    });
    const contract = await prisma.consultancyContract.create({
      data: {
        requestId: request.id,
        providerId,
        clientId,
        offerId,
        status: "DELIVERED",
        paymentStatus: "CAPTURED",
        paymentAmountCents: 20000,
        providerAmountCents: 18000,
        platformAmountCents: 2000,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date(),
        deliveredAt
      }
    });
    // contestDelivery agora usa a ficha (TrainingPlan) mais recente do
    // contrato pra calcular o prazo de 48h, não mais contract.deliveredAt
    // diretamente — precisa existir uma ficha entregue com o mesmo horário.
    await prisma.trainingPlan.create({
      data: {
        providerId,
        contractId: contract.id,
        title: "Ficha de teste",
        isPrebuilt: false,
        isActive: true,
        createdAt: deliveredAt
      }
    });
    return contract;
  }

  it("contesta a entrega dentro das 48h e cria um caso de disputa DELIVERY_CONTESTED", async () => {
    const contract = await makeDeliveredContract(new Date());

    const disputeCase = await consultancyService.contestDelivery(clientId, contract.id, "Ficha veio em branco.");

    expect(disputeCase.type).toBe("DELIVERY_CONTESTED");
    expect(disputeCase.status).toBe("OPEN");
    expect(disputeCase.consultancyContractId).toBe(contract.id);
    expect(disputeCase.contextNote).toBe("Ficha veio em branco.");
  });

  it("rejeita contestar a mesma entrega duas vezes", async () => {
    const contract = await makeDeliveredContract(new Date());
    await consultancyService.contestDelivery(clientId, contract.id, "primeira contestação");

    await expect(consultancyService.contestDelivery(clientId, contract.id, "segunda")).rejects.toThrow();
  });

  it("rejeita contestar depois do prazo de 48h", async () => {
    const oldDelivery = new Date(Date.now() - 49 * 60 * 60 * 1000);
    const contract = await makeDeliveredContract(oldDelivery);

    await expect(consultancyService.contestDelivery(clientId, contract.id, "tarde demais")).rejects.toThrow();
  });

  it("rejeita contestar um contrato que ainda não teve entrega", async () => {
    const request = await prisma.consultancyRequest.create({
      data: {
        providerId,
        clientId,
        status: "ACCEPTED",
        quotedOfferId: offerId,
        responseDeadlineAt: new Date(),
        respondedAt: new Date(),
        clientDecisionAt: new Date()
      }
    });
    const contract = await prisma.consultancyContract.create({
      data: {
        requestId: request.id,
        providerId,
        clientId,
        offerId,
        status: "ACTIVE",
        paymentStatus: "CAPTURED",
        paymentAmountCents: 20000,
        providerAmountCents: 18000,
        platformAmountCents: 2000,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date()
      }
    });

    await expect(consultancyService.contestDelivery(clientId, contract.id, "ainda nao entregou")).rejects.toThrow();
  });

  async function makeAutoCapturedBooking(opts: { clientConfirmed: boolean; providerConfirmed: boolean; completedAt: Date }) {
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        priceCents: 8000,
        status: BookingStatus.COMPLETED,
        completedAt: opts.completedAt,
        clientConfirmedAt: opts.clientConfirmed ? opts.completedAt : null,
        providerConfirmedAt: opts.providerConfirmed ? opts.completedAt : null
      }
    });
    await prisma.payment.create({
      data: {
        bookingId: booking.id,
        amountCents: 8000,
        status: PaymentStatus.CAPTURED,
        mpPaymentId: `mp_${uid("cap")}`,
        capturedAt: opts.completedAt
      }
    });
    return booking;
  }

  it("cliente que nunca confirmou pode contestar a cobrança automática dentro de 24h", async () => {
    const booking = await makeAutoCapturedBooking({
      clientConfirmed: false,
      providerConfirmed: true,
      completedAt: new Date()
    });

    const disputeCase = await bookingService.contestAutoCapturedCompletion(clientId, booking.id, "não foi bem assim");

    expect(disputeCase.type).toBe("AUTO_CAPTURE_CONTESTED");
    expect(disputeCase.bookingId).toBe(booking.id);
  });

  it("quem já confirmou não pode contestar (só quem nunca confirmou)", async () => {
    const booking = await makeAutoCapturedBooking({
      clientConfirmed: false,
      providerConfirmed: true,
      completedAt: new Date()
    });

    await expect(bookingService.contestAutoCapturedCompletion(providerUserId, booking.id)).rejects.toThrow();
  });

  it("rejeita contestar depois do prazo de 24h", async () => {
    const oldCompletion = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const booking = await makeAutoCapturedBooking({
      clientConfirmed: false,
      providerConfirmed: true,
      completedAt: oldCompletion
    });

    await expect(bookingService.contestAutoCapturedCompletion(clientId, booking.id)).rejects.toThrow();
  });

  it("rejeita contestar uma sessão concluída normalmente (as duas partes confirmaram)", async () => {
    const booking = await makeAutoCapturedBooking({
      clientConfirmed: true,
      providerConfirmed: true,
      completedAt: new Date()
    });

    await expect(bookingService.contestAutoCapturedCompletion(clientId, booking.id)).rejects.toThrow();
  });
});
