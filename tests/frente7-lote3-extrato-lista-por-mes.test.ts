import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BookingStatus, PaymentMethod, PaymentStatus, UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { FinancialService } from "../src/modules/financial/services/financial.service";

// Épico de Frentes, Frente 7 (Tela Financeiro do profissional), Lote 3: a
// lista de "Lançamentos" do Extrato vinha de buildPayoutsData(userId, 50) -
// os 50 pagamentos mais recentes de TODA a história, sem filtro de mês,
// filtrados depois no mobile. Profissional com mais de 50 transações
// históricas via o total do topo (getReport) certo, mas a lista de
// lançamentos de um mês antigo vazia/incompleta - as transações desse mês
// já tinham saído da janela dos 50 mais recentes.

const financialService = new FinancialService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let categoryId = "";
let clientId = "";
let providerUserId = "";
let providerId = "";
const bookingIds: string[] = [];

describe("Frente 7, Lote 3 — Extrato lista transações do mês selecionado, não um corte global", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `F7L3_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Sete Lote Três",
        email: `${uid("f7l3_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.CLIENT
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Sete Lote Três",
        email: `${uid("f7l3_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Sete Lote Três",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    // 55 transações recentes (mês corrente) - mais que o corte antigo de 50.
    for (let i = 0; i < 55; i++) {
      const booking = await prisma.booking.create({
        data: { clientId, providerId, categoryId, scheduledAt: new Date(), priceCents: 1000, status: BookingStatus.COMPLETED, completedAt: new Date() }
      });
      bookingIds.push(booking.id);
      await prisma.payment.create({
        data: {
          bookingId: booking.id,
          method: PaymentMethod.CREDIT_CARD,
          status: PaymentStatus.CAPTURED,
          amountCents: 1000,
          currency: "BRL",
          mpPaymentId: `mp_${uid("recent")}_${i}`,
          capturedAt: new Date()
        }
      });
    }

    // 1 transação de 3 meses atrás - some do corte global de 50 mais recentes.
    const oldCapturedAt = new Date();
    oldCapturedAt.setMonth(oldCapturedAt.getMonth() - 3);
    const oldBooking = await prisma.booking.create({
      data: { clientId, providerId, categoryId, scheduledAt: oldCapturedAt, priceCents: 5000, status: BookingStatus.COMPLETED, completedAt: oldCapturedAt }
    });
    bookingIds.push(oldBooking.id);
    await prisma.payment.create({
      data: {
        bookingId: oldBooking.id,
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.CAPTURED,
        amountCents: 5000,
        currency: "BRL",
        mpPaymentId: `mp_${uid("old")}`,
        capturedAt: oldCapturedAt
      }
    });
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { booking: { id: { in: bookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [providerUserId, clientId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [providerUserId, clientId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("sem month: mantém o comportamento antigo (top 50 mais recentes de toda a história)", async () => {
    const result = await financialService.getPayouts(providerUserId);
    expect(result.payments).toHaveLength(50);
    // a transação de 3 meses atrás não sobrevive ao corte global — cenário
    // que reproduz o bug original (mas continua sendo o comportamento
    // esperado pra essa chamada sem month, usada só pro card-resumo).
    expect(result.payments.some((p) => p.amountCents === 5000)).toBe(false);
  });

  it("com month: mostra exatamente as transações daquele mês, mesmo com 50+ transações mais recentes em outros meses", async () => {
    const oldMonthDate = new Date();
    oldMonthDate.setMonth(oldMonthDate.getMonth() - 3);
    const oldMonthKey = `${oldMonthDate.getFullYear()}-${String(oldMonthDate.getMonth() + 1).padStart(2, "0")}`;

    const result = await financialService.getPayouts(providerUserId, oldMonthKey);
    expect(result.payments).toHaveLength(1);
    expect(result.payments[0].amountCents).toBe(5000);

    // bate com o total do topo da mesma tela (getReport) pro mesmo mês.
    const report = await financialService.getReport(providerUserId, 4);
    const oldMonthEntry = report.months.find((m) => m.month === oldMonthKey);
    expect(oldMonthEntry?.appRevenueCents).toBe(5000);
  });
});
