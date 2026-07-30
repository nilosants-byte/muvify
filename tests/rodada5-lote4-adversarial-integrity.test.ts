import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { Payment, CardToken } from "mercadopago";
import { prisma } from "../src/config/prisma";
import { BookingService } from "../src/modules/bookings/services/booking.service";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";

// Raio-X de pagamentos, Rodada 5, Lote 4 (auditoria adversarial): integridade
// da conclusão de sessão presencial e reincidência.
// (1) confirmCompletion não podia mais ser chamado antes do horário marcado
// (conluio de 2 contas pra inflar sessões concluídas sem serviço prestado).
// (2) profissional com dívida pendente (PROVIDER) não pode mais vender novo
// serviço.
// (3) sessão que expira 48h depois sem o código de presença ter sido
// validado nem uma vez não é mais reembolsada automaticamente e sem
// registro — abre um caso pra revisão manual.

const bookingService = new BookingService();
const packageService = new PresentialPackageService();
const consultancyService = new ConsultancyService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const bookingIds: string[] = [];

describe("Rodada 5, Lote 4 — integridade de conclusão e reincidência", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const category = await prisma.serviceCategory.create({ data: { name: `R5L4_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Lote4 Client",
        email: `${uid("l5l4_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        mpCustomerId: "cus_test_l5l4",
        emailVerifiedAt: new Date()
      }
    });
    clientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });
    await prisma.customerPaymentMethod.create({
      data: {
        userId: clientId,
        mpCustomerId: "cus_test_l5l4",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });

    const providerUser = await prisma.user.create({
      data: {
        name: "Lote4 Provider",
        email: `${uid("l5l4_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Lote4 Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "555444333",
        crefValidationStatus: "APPROVED",
        minBookingNoticeHours: 1
      }
    });
    providerId = provider.id;
    await prisma.availability.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ providerId, weekday, startTime: "00:00", endTime: "23:59", isActive: true }))
    });
    await prisma.providerCategory.create({ data: { providerId, categoryId } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.disputeCase.deleteMany({ where: { clientId } });
    await prisma.debtRecord.deleteMany({ where: { providerId } });
    await prisma.payment.deleteMany({ where: { booking: { id: { in: bookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.availability.deleteMany({ where: { providerId } });
    await prisma.providerCategory.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: clientId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("confirmCompletion rejeita quando chamado antes do horário marcado (conluio de 2 contas)", async () => {
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_l5l4" } as any);
    vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 5001, status: "authorized" } as any);

    const scheduledAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const booking = await bookingService.create(
      clientId,
      providerId,
      categoryId,
      scheduledAt.toISOString(),
      undefined,
      "CREDIT_CARD" as any
    );
    bookingIds.push(booking.id);

    await bookingService.updateStatus(providerUserId, booking.id, "CONFIRMED" as any);

    await prisma.booking.update({
      where: { id: booking.id },
      data: { attendanceCodeValidatedAt: new Date() }
    });

    await expect(
      bookingService.updateStatus(clientId, booking.id, "COMPLETED" as any)
    ).rejects.toThrow(/antes do horário/i);
  });

  it("profissional com dívida (PROVIDER) pendente não consegue vender novo agendamento avulso", async () => {
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "CHARGEBACK", clientId, providerId, amountCents: 5000, mpPaymentId: `mp_${uid("l5l4_dc")}` }
    });
    const debt = await prisma.debtRecord.create({
      data: {
        disputeCaseId: disputeCase.id,
        debtorType: "PROVIDER",
        providerId,
        amountCents: 4500,
        reason: "teste lote4",
        status: "NOTIFIED"
      }
    });

    const scheduledAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    await expect(
      bookingService.create(clientId, providerId, categoryId, scheduledAt.toISOString(), undefined, "CREDIT_CARD" as any)
    ).rejects.toThrow(/temporariamente indisponível/i);

    await prisma.debtRecord.delete({ where: { id: debt.id } });
    await prisma.disputeCase.delete({ where: { id: disputeCase.id } });
  });

  it("profissional com dívida (PROVIDER) pendente não consegue vender novo pacote presencial", async () => {
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "CHARGEBACK", clientId, providerId, amountCents: 5000, mpPaymentId: `mp_${uid("l5l4_dc2")}` }
    });
    const debt = await prisma.debtRecord.create({
      data: {
        disputeCaseId: disputeCase.id,
        debtorType: "PROVIDER",
        providerId,
        amountCents: 4500,
        reason: "teste lote4",
        status: "NOTIFIED"
      }
    });

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "PRESENTIAL",
        title: `Pacote Lote4 ${uid("offer")}`,
        billingCycle: "MONTHLY",
        priceCents: 8000,
        presentialPackageMode: "FLEXIBLE_CREDITS",
        presentialSessionsPerCycle: 2,
        presentialHasFixedTerm: true,
        presentialTotalCycles: 1
      }
    });

    await expect(
      packageService.purchasePackage(clientId, { offerId: offer.id, categoryId, paymentMethod: "CREDIT_CARD" as any })
    ).rejects.toThrow(/temporariamente indisponível/i);

    await prisma.providerServiceOffer.delete({ where: { id: offer.id } });
    await prisma.debtRecord.delete({ where: { id: debt.id } });
    await prisma.disputeCase.delete({ where: { id: disputeCase.id } });
  });

  it("profissional com dívida (PROVIDER) pendente não consegue aceitar proposta de consultoria", async () => {
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "CHARGEBACK", clientId, providerId, amountCents: 5000, mpPaymentId: `mp_${uid("l5l4_dc3")}` }
    });
    const debt = await prisma.debtRecord.create({
      data: {
        disputeCaseId: disputeCase.id,
        debtorType: "PROVIDER",
        providerId,
        amountCents: 4500,
        reason: "teste lote4",
        status: "NOTIFIED"
      }
    });

    const offer = await prisma.providerServiceOffer.create({
      data: { providerId, kind: "ONLINE_CONSULTANCY", title: `Consultoria Lote4 ${uid("offer")}`, billingCycle: "MONTHLY", priceCents: 20000 }
    });
    const consultancyRequest = await prisma.consultancyRequest.create({
      data: {
        providerId,
        clientId,
        status: "RESPONDED",
        quotedOfferId: offer.id,
        responseDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        respondedAt: new Date()
      }
    });

    await expect(
      consultancyService.decideRequest(clientId, consultancyRequest.id, {
        decision: "ACCEPT",
        paymentMethod: "CREDIT_CARD" as any,
        acknowledgedImmediateExecution: true
      })
    ).rejects.toThrow(/temporariamente indisponível/i);

    await prisma.consultancyRequest.delete({ where: { id: consultancyRequest.id } });
    await prisma.providerServiceOffer.delete({ where: { id: offer.id } });
    await prisma.debtRecord.delete({ where: { id: debt.id } });
    await prisma.disputeCase.delete({ where: { id: disputeCase.id } });
  });

  it("sessão que expira 48h depois sem o código de presença validado abre um caso de revisão, sem reembolsar sozinha", async () => {
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_l5l4b" } as any);
    vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 5002, status: "authorized" } as any);

    const scheduledAt = new Date(Date.now() - 60 * 60 * 60 * 1000); // 60h atrás
    // +11 dias (não +10, como o primeiro teste do arquivo): o booking do
    // primeiro teste ("conluio de 2 contas") fica CONFIRMED em +10 dias
    // pra sempre (nunca é movido/cancelado) — com a checagem de
    // sobreposição por duração de sessão (Frente 5, Lote 3), reusar o
    // mesmo instante aqui conflitaria com aquele booking ainda ativo.
    const booking = await bookingService.create(
      clientId,
      providerId,
      categoryId,
      new Date(Date.now() + 11 * 24 * 60 * 60 * 1000).toISOString(),
      undefined,
      "CREDIT_CARD" as any
    );
    bookingIds.push(booking.id);
    await prisma.booking.update({ where: { id: booking.id }, data: { status: "CONFIRMED", scheduledAt } });
    await prisma.payment.update({
      where: { bookingId: booking.id },
      data: { status: "AUTHORIZED", mpPaymentId: `mp_${uid("l5l4_auth")}` }
    });

    const cancelSpy = vi.spyOn(Payment.prototype, "cancel");

    await bookingService.autoExpireStaleBookings();

    const afterRun = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(afterRun.status).toBe("CANCELLED");
    expect(cancelSpy).not.toHaveBeenCalled();

    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(payment.status).toBe("AUTHORIZED");

    const dispute = await prisma.disputeCase.findFirst({ where: { bookingId: booking.id } });
    expect(dispute).not.toBeNull();
    expect(dispute?.type).toBe("NO_SHOW_CONTESTED");
    expect(dispute?.status).toBe("OPEN");
  });

  it("sessão que expira 48h depois COM o código já validado continua sendo cancelada e reembolsada normalmente", async () => {
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_l5l4c" } as any);
    vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 5003, status: "authorized" } as any);

    const scheduledAt = new Date(Date.now() - 60 * 60 * 60 * 1000);
    // +12 dias — mesmo motivo do teste anterior (booking do primeiro
    // teste do arquivo fica ativo em +10 dias pra sempre).
    const booking = await bookingService.create(
      clientId,
      providerId,
      categoryId,
      new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString(),
      undefined,
      "CREDIT_CARD" as any
    );
    bookingIds.push(booking.id);
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "CONFIRMED", scheduledAt, attendanceCodeValidatedAt: new Date(scheduledAt.getTime() + 5 * 60 * 1000) }
    });
    await prisma.payment.update({
      where: { bookingId: booking.id },
      data: { status: "AUTHORIZED", mpPaymentId: `mp_${uid("l5l4_auth2")}` }
    });

    vi.spyOn(Payment.prototype, "cancel").mockResolvedValue({} as any);

    await bookingService.autoExpireStaleBookings();

    const afterRun = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(afterRun.status).toBe("CANCELLED");

    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(payment.status).not.toBe("AUTHORIZED");

    const dispute = await prisma.disputeCase.findFirst({ where: { bookingId: booking.id } });
    expect(dispute).toBeNull();
  });
});
