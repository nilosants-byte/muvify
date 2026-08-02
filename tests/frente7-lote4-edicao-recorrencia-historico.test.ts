import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FinancialRecurrence, UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { FinancialService } from "../src/modules/financial/services/financial.service";

// Épico de Frentes, Frente 7 (Tela Financeiro do profissional), Lote 4: o
// split (fechar a série antiga, nascer uma nova) só disparava quando o
// mobile pedia explicitamente um occurrenceMonth diferente do mês da
// âncora. Editar ou excluir a própria linha-âncora — vendo o mês dela
// mesma, mas já com meses elapsed depois — sobrescrevia/apagava a base de
// toda a projeção, corrompendo meses já fechados.

const financialService = new FinancialService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function monthKeyOffset(offsetMonths: number) {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function dateMonthsAgo(offsetMonths: number) {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths);
  return d;
}

let providerUserId = "";
let providerId = "";
const incomeIds: string[] = [];
const expenseIds: string[] = [];

describe("Frente 7, Lote 4 — editar/excluir recorrência protege histórico já elapsed", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Sete Lote Quatro",
        email: `${uid("f7l4_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Sete Lote Quatro",
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
    await prisma.financialExpense.deleteMany({ where: { id: { in: expenseIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: providerUserId } });
    await prisma.user.deleteMany({ where: { id: providerUserId } });
    await prisma.$disconnect();
  });

  it("editar a âncora de uma recorrência com 3 meses de histórico já passado não muda os meses antigos, só o mês corrente em diante", async () => {
    const anchorMonth = monthKeyOffset(-3);
    const income = await prisma.financialIncome.create({
      data: {
        providerId,
        description: "Mensalidade recorrente",
        amountCents: 50000,
        source: "MANUAL",
        paidAt: dateMonthsAgo(-3),
        recurrence: FinancialRecurrence.RECURRING
      }
    });
    incomeIds.push(income.id);

    // Profissional vendo o mês da própria âncora (março, por ex.) e editando
    // o valor lá - exatamente como o mobile faz hoje (sempre manda
    // occurrenceMonth = selectedMonth).
    const updated = await financialService.updateIncome(providerUserId, income.id, {
      amountCents: 55000,
      occurrenceMonth: anchorMonth
    });
    incomeIds.push(updated.id);

    const currentMonth = monthKeyOffset(0);
    const monthMinus2 = monthKeyOffset(-2);
    const monthMinus1 = monthKeyOffset(-1);

    const oldMonthList = await financialService.listIncomes(providerUserId, anchorMonth);
    expect(oldMonthList.find((i) => i.id === income.id)?.amountCents).toBe(50000);

    const midMonthList = await financialService.listIncomes(providerUserId, monthMinus2);
    expect(midMonthList.some((i) => i.amountCents === 50000)).toBe(true);

    const lastMonthList = await financialService.listIncomes(providerUserId, monthMinus1);
    expect(lastMonthList.some((i) => i.amountCents === 50000)).toBe(true);

    const currentMonthList = await financialService.listIncomes(providerUserId, currentMonth);
    expect(currentMonthList.some((i) => i.amountCents === 55000)).toBe(true);
    expect(currentMonthList.some((i) => i.amountCents === 50000)).toBe(false);
  });

  it("excluir a âncora de uma recorrência com histórico já passado preserva os meses antigos, só encerra dali pra frente", async () => {
    const anchorMonth = monthKeyOffset(-3);
    const income = await prisma.financialIncome.create({
      data: {
        providerId,
        description: "Mensalidade a ser excluída",
        amountCents: 30000,
        source: "MANUAL",
        paidAt: dateMonthsAgo(-3),
        recurrence: FinancialRecurrence.RECURRING
      }
    });
    incomeIds.push(income.id);

    await financialService.deleteIncome(providerUserId, income.id);

    const oldMonthList = await financialService.listIncomes(providerUserId, anchorMonth);
    expect(oldMonthList.some((i) => i.id === income.id && i.amountCents === 30000)).toBe(true);

    const currentMonth = monthKeyOffset(0);
    const currentMonthList = await financialService.listIncomes(providerUserId, currentMonth);
    expect(currentMonthList.some((i) => i.id === income.id)).toBe(false);

    const stillExists = await prisma.financialIncome.findUnique({ where: { id: income.id } });
    expect(stillExists).toBeTruthy();
    expect(stillExists!.recurrenceEndDate).toBeTruthy();
  });

  it("editar uma recorrência criada neste mês (sem histórico ainda) continua editando em vez de dividir", async () => {
    const income = await prisma.financialIncome.create({
      data: {
        providerId,
        description: "Recorrência recém-criada",
        amountCents: 10000,
        source: "MANUAL",
        paidAt: new Date(),
        recurrence: FinancialRecurrence.RECURRING
      }
    });
    incomeIds.push(income.id);

    const currentMonth = monthKeyOffset(0);
    const updated = await financialService.updateIncome(providerUserId, income.id, {
      amountCents: 12000,
      occurrenceMonth: currentMonth
    });

    expect(updated.id).toBe(income.id);
    const countRows = await prisma.financialIncome.count({ where: { providerId, description: "Recorrência recém-criada" } });
    expect(countRows).toBe(1);
  });

  it("excluir uma recorrência criada neste mês (sem histórico ainda) apaga de verdade", async () => {
    const income = await prisma.financialIncome.create({
      data: {
        providerId,
        description: "Recorrência fresca pra apagar",
        amountCents: 8000,
        source: "MANUAL",
        paidAt: new Date(),
        recurrence: FinancialRecurrence.RECURRING
      }
    });

    await financialService.deleteIncome(providerUserId, income.id);

    const stillExists = await prisma.financialIncome.findUnique({ where: { id: income.id } });
    expect(stillExists).toBeNull();
  });

  it("editar a âncora de uma despesa recorrente com histórico já passado tem a mesma proteção", async () => {
    const anchorMonth = monthKeyOffset(-2);
    const expense = await prisma.financialExpense.create({
      data: {
        providerId,
        description: "Aluguel recorrente",
        amountCents: 40000,
        category: "RENT",
        paidAt: dateMonthsAgo(-2),
        recurrence: FinancialRecurrence.RECURRING
      }
    });
    expenseIds.push(expense.id);

    const updated = await financialService.updateExpense(providerUserId, expense.id, {
      amountCents: 45000,
      occurrenceMonth: anchorMonth
    });
    expenseIds.push(updated.id);

    const oldMonthList = await financialService.listExpenses(providerUserId, anchorMonth);
    expect(oldMonthList.find((e) => e.id === expense.id)?.amountCents).toBe(40000);

    const currentMonth = monthKeyOffset(0);
    const currentMonthList = await financialService.listExpenses(providerUserId, currentMonth);
    expect(currentMonthList.some((e) => e.amountCents === 45000)).toBe(true);
  });
});
