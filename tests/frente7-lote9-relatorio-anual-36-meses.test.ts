import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { BookingStatus, UserRole } from "@prisma/client";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { FinancialService } from "../src/modules/financial/services/financial.service";
import { signToken } from "../src/shared/utils/jwt";

// Épico de Frentes, Frente 7 (Tela Financeiro do profissional), Lote 9: o
// mobile (Relatório Anual) já pedia 36 meses (3 anos) pra alimentar o
// seletor de ano, mas o controller cortava pra 12 antes mesmo de chegar no
// service - profissional ativo há mais de 1 ano nunca via o ano retrasado,
// mesmo tendo faturamento real registrado naquele período.

const financialService = new FinancialService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let categoryId = "";
let clientId = "";
let providerUserId = "";
let providerToken = "";
let providerId = "";
const bookingIds: string[] = [];

describe("Frente 7, Lote 9 — Relatório Anual acomoda 36 meses", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `F7L9_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Sete Lote Nove",
        email: `${uid("f7l9_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.CLIENT
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Sete Lote Nove",
        email: `${uid("f7l9_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;
    providerToken = signToken(providerUserId, UserRole.PROVIDER);

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Sete Lote Nove",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    // Sessão concluída há 15 meses - fora da janela antiga de 12 meses.
    const oldDate = new Date();
    oldDate.setMonth(oldDate.getMonth() - 15);
    const oldBooking = await prisma.booking.create({
      data: { clientId, providerId, categoryId, scheduledAt: oldDate, priceCents: 12345, status: BookingStatus.COMPLETED, completedAt: oldDate }
    });
    bookingIds.push(oldBooking.id);
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [providerUserId, clientId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [providerUserId, clientId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("GET /financial/report?months=36 não trunca em 12 - mostra um mês de 15 meses atrás com receita real", async () => {
    const res = await request(app)
      .get("/api/financial/report?months=36")
      .set("Authorization", `Bearer ${providerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.months.length).toBeGreaterThan(12);

    const oldDate = new Date();
    oldDate.setMonth(oldDate.getMonth() - 15);
    const oldMonthKey = `${oldDate.getFullYear()}-${String(oldDate.getMonth() + 1).padStart(2, "0")}`;

    const oldEntry = res.body.months.find((m: { month: string }) => m.month === oldMonthKey);
    expect(oldEntry).toBeTruthy();
    expect(oldEntry.appRevenueCents).toBeGreaterThanOrEqual(12345);
  });

  it("getReport(userId, 36) direto no service também acomoda os 36 meses pedidos", async () => {
    const report = await financialService.getReport(providerUserId, 36);
    expect(report.months.length).toBe(36);
  });
});
