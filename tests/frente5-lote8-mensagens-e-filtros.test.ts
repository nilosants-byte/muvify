import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { BookingService } from "../src/modules/bookings/services/booking.service";
import { ProviderService } from "../src/modules/providers/services/provider.service";
import { PaymentService } from "../src/modules/payments/services/payment.service";

// Épico de Frentes, Frente 5 (Descoberta, agendamento e agenda), Lote 8:
// (1) erro de dívida do profissional ao criar booking mostra mensagem
//     neutra (perspectiva do cliente), não mais a mensagem antiga escrita
//     pro profissional.
// (2) filtro de modalidade "Só academia"/"Vai ao cliente" passa a incluir
//     profissionais "Ambas" (BOTH).
// (3) getCustomerPaymentStatus expõe hasOutstandingDebt, pra a tela de
//     criação de booking avisar antes do cliente preencher tudo.

const bookingService = new BookingService();
const providerService = new ProviderService();
const paymentService = new PaymentService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let providerBothUserId = "";
let providerBothId = "";
let categoryId = "";
const marker = `F5L8_${Date.now()}`;

describe("Frente 5, Lote 8 — mensagens e filtro de modalidade", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `${marker}_cat`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Cinco Lote Oito",
        email: `${uid("f5l8_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.CLIENT,
        emailVerifiedAt: new Date()
      }
    });
    clientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Cinco Lote Oito",
        email: `${uid("f5l8_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: `${marker} Provider`,
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;
    await prisma.providerCategory.create({ data: { providerId, categoryId } });

    const providerBothUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Cinco Lote Oito Ambas",
        email: `${uid("f5l8_provider_both")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}3`,
        role: UserRole.PROVIDER
      }
    });
    providerBothUserId = providerBothUser.id;

    const providerBoth = await prisma.providerProfile.create({
      data: {
        userId: providerBothUserId,
        displayName: `${marker} Provider Ambas`,
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "444555666",
        crefValidationStatus: "APPROVED",
        serviceMode: "BOTH"
      }
    });
    providerBothId = providerBoth.id;
  });

  afterAll(async () => {
    await prisma.clientAnamnesis.deleteMany({ where: { clientId } });
    await prisma.providerCategory.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: [providerId, providerBothId] } } });
    await prisma.session.deleteMany({ where: { userId: { in: [providerUserId, providerBothUserId, clientId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [providerUserId, providerBothUserId, clientId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("criar booking com profissional em dívida mostra mensagem neutra pro cliente, não a mensagem antiga do profissional", async () => {
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "CHARGEBACK", clientId, providerId, amountCents: 5000, mpPaymentId: `mp_${uid("dc")}` }
    });
    const debt = await prisma.debtRecord.create({
      data: {
        disputeCaseId: disputeCase.id,
        debtorType: "PROVIDER",
        providerId,
        amountCents: 4500,
        reason: "teste lote8",
        status: "NOTIFIED"
      }
    });

    const scheduledAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    let caughtMessage = "";
    try {
      await bookingService.create(clientId, providerId, categoryId, scheduledAt.toISOString(), undefined, "CREDIT_CARD" as any);
    } catch (error) {
      caughtMessage = error instanceof Error ? error.message : String(error);
    }
    expect(caughtMessage).toMatch(/temporariamente indisponível/i);
    expect(caughtMessage).not.toMatch(/vender um novo serviço/i);

    await prisma.debtRecord.delete({ where: { id: debt.id } });
    await prisma.disputeCase.delete({ where: { id: disputeCase.id } });
  });

  it("filtrar por 'Só academia' (PRESENTIAL_ONLY) inclui profissional 'Ambas' (BOTH)", async () => {
    const results = await providerService.search({ q: marker, serviceMode: "PRESENTIAL_ONLY" as any } as any);
    expect(results.some((p: any) => p.id === providerBothId)).toBe(true);
  });

  it("filtrar por 'Ambas' (BOTH) não inclui profissional PRESENTIAL_ONLY puro", async () => {
    await prisma.providerProfile.update({ where: { id: providerId }, data: { serviceMode: "PRESENTIAL_ONLY" } });
    const results = await providerService.search({ q: marker, serviceMode: "BOTH" as any } as any);
    expect(results.some((p: any) => p.id === providerBothId)).toBe(true);
    expect(results.some((p: any) => p.id === providerId)).toBe(false);
  });

  it("getCustomerPaymentStatus expõe hasOutstandingDebt", async () => {
    const before = await paymentService.getCustomerPaymentStatus(clientId);
    expect(before.hasOutstandingDebt).toBe(false);

    const disputeCase = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", clientId, providerId, amountCents: 3000, contextNote: "teste" }
    });
    const debt = await prisma.debtRecord.create({
      data: {
        disputeCaseId: disputeCase.id,
        debtorType: "CLIENT",
        clientId,
        amountCents: 3000,
        reason: "teste lote8 cliente",
        status: "PENDING"
      }
    });

    const after = await paymentService.getCustomerPaymentStatus(clientId);
    expect(after.hasOutstandingDebt).toBe(true);

    await prisma.debtRecord.delete({ where: { id: debt.id } });
    await prisma.disputeCase.delete({ where: { id: disputeCase.id } });
  });
});
