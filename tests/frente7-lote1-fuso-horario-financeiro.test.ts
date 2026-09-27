import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { FinancialService } from "../src/modules/financial/services/financial.service";

// Épico de Frentes, Frente 7 (Tela Financeiro do profissional), Lote 1: o
// módulo financeiro classificava transações por mês/dia usando o fuso do
// PROCESSO (UTC em produção), nunca APP_TIMEZONE (America/Sao_Paulo) —
// diferente do resto do backend. Uma transação lançada às 23h30 de
// Brasília no último dia do mês (= 02h30 UTC do dia seguinte) caía no mês
// errado.

const financialService = new FinancialService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let providerUserId = "";
let providerId = "";
const incomeIds: string[] = [];

describe("Frente 7, Lote 1 — fuso horário do módulo financeiro", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Sete Lote Um",
        email: `${uid("f7l1_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Sete Lote Um",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;
  });

  afterAll(async () => {
    await prisma.financialIncome.deleteMany({ where: { id: { in: incomeIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: providerUserId } });
    await prisma.$disconnect();
  });

  it("receita lançada às 23h30 de Brasília no último dia do mês é classificada no mês certo, não no seguinte (dashboard e relatório)", async () => {
    // Achado em teste manual (2026-09-27): os dois meses eram fixos
    // ("2026-07"/"2026-08"), mas getReport(providerUserId, 2) devolve os
    // ÚLTIMOS 2 meses relativos a HOJE — conforme a data real avança, a
    // janela sai de julho/agosto e o teste passa a falhar sozinho, sem
    // nenhuma mudança de código (mesmo problema já visto antes noutro
    // arquivo desta suíte). Usa mês anterior/mês atual, sempre relativos a
    // "agora", pra nunca ficar obsoleto.
    const now = new Date();
    const targetMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const targetMonthKey = `${targetMonth.getFullYear()}-${String(targetMonth.getMonth() + 1).padStart(2, "0")}`;
    const nextMonthKey = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`;
    const lastDayOfTargetMonth = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    const lastDayKey = `${targetMonthKey}-${String(lastDayOfTargetMonth).padStart(2, "0")}`;
    const firstDayOfNextMonthKey = `${nextMonthKey}-01`;

    // 23h30 de Brasília (UTC-3) no último dia do mês-alvo = 02h30 UTC do
    // primeiro dia do mês seguinte. Com o bug antigo (fuso do
    // processo/UTC), isso cairia no mês seguinte.
    const paidAt = new Date(Date.UTC(nextMonth.getFullYear(), nextMonth.getMonth(), 1, 2, 30, 0));
    const income = await prisma.financialIncome.create({
      data: {
        providerId,
        description: "Sessão avulsa tarde da noite",
        amountCents: 15000,
        paidAt
      }
    });
    incomeIds.push(income.id);

    const targetDashboard = await financialService.getDashboard(providerUserId, targetMonthKey);
    expect(targetDashboard.dailyRevenue[lastDayKey]).toBe(15000);

    const nextDashboard = await financialService.getDashboard(providerUserId, nextMonthKey);
    expect(nextDashboard.dailyRevenue[firstDayOfNextMonthKey]).toBeUndefined();

    const report = await financialService.getReport(providerUserId, 2);
    const targetEntry = report.months.find((r) => r.month === targetMonthKey);
    const nextEntry = report.months.find((r) => r.month === nextMonthKey);
    expect(targetEntry?.revenueCents ?? 0).toBeGreaterThanOrEqual(15000);
    expect(nextEntry?.revenueCents ?? 0).toBe(0);
  });

  it("receita lançada de madrugada (00h30 de Brasília) no primeiro dia do mês é classificada nesse mês, não no anterior", async () => {
    // 2026-07-01T00:30:00 em America/Sao_Paulo = 2026-07-01T03:30:00Z.
    const paidAt = new Date("2026-07-01T03:30:00.000Z");
    const income = await prisma.financialIncome.create({
      data: {
        providerId,
        description: "Sessão de madrugada",
        amountCents: 8000,
        paidAt
      }
    });
    incomeIds.push(income.id);

    const julyDashboard = await financialService.getDashboard(providerUserId, "2026-07");
    expect(julyDashboard.dailyRevenue["2026-07-01"]).toBe(8000);

    const juneDashboard = await financialService.getDashboard(providerUserId, "2026-06");
    expect(juneDashboard.dailyRevenue["2026-06-30"]).toBeUndefined();
  });
});
