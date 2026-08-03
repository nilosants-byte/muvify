import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FinancialRecurrence, UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { FinancialService } from "../src/modules/financial/services/financial.service";

// Épico de Frentes, Frente 7 (Tela Financeiro do profissional), Lote 11:
// tela de Alunos Financeiros manuais. listStudents calculava
// billableThisMonth sempre contra o mês real de hoje, ignorando a
// navegação de mês da tela; e limpar um campo de meta (undefined) nunca
// removia a meta antiga de fato, apesar do texto da UI prometer isso.

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
const studentIds: string[] = [];

describe("Frente 7, Lote 11 — Alunos Financeiros manuais respeitam o mês navegado", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Sete Lote Onze",
        email: `${uid("f7l11_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Sete Lote Onze",
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
    await prisma.financialStudent.deleteMany({ where: { id: { in: studentIds } } });
    await prisma.financialGoal.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: providerUserId } });
    await prisma.user.deleteMany({ where: { id: providerUserId } });
    await prisma.$disconnect();
  });

  it("listStudents(month) calcula billableThisMonth contra o mês pedido, não o mês real de hoje", async () => {
    // Aluno cuja cobrança começou há 3 meses e terminou há 1 mês - já não
    // cobra mais este mês, mas cobrava há 2 meses.
    const student = await prisma.financialStudent.create({
      data: {
        providerId,
        name: "Aluno Encerrado",
        monthlyValueCents: 20000,
        type: "PRESENTIAL",
        isActive: true,
        recurrence: FinancialRecurrence.RECURRING,
        startDate: dateMonthsAgo(-3),
        recurrenceEndDate: dateMonthsAgo(-1)
      }
    });
    studentIds.push(student.id);

    const currentMonthList = await financialService.listStudents(providerUserId);
    const currentEntry = currentMonthList.find((s) => s.id === student.id);
    expect(currentEntry?.billableThisMonth).toBe(false);

    const twoMonthsAgoKey = monthKeyOffset(-2);
    const pastMonthList = await financialService.listStudents(providerUserId, twoMonthsAgoKey);
    const pastEntry = pastMonthList.find((s) => s.id === student.id);
    expect(pastEntry?.billableThisMonth).toBe(true);
  });

  it("upsertGoal com null explícito limpa a meta; undefined (omitido) não mexe nas outras", async () => {
    const month = monthKeyOffset(0);
    await financialService.upsertGoal(providerUserId, {
      month,
      targetRevenueCents: 500000,
      targetStudents: 20,
      targetWeeklyClasses: 40
    });

    // Limpa só targetWeeklyClasses (null explícito); os outros dois campos
    // nem são mencionados (undefined) - devem continuar com os valores antigos.
    const updated = await financialService.upsertGoal(providerUserId, {
      month,
      targetWeeklyClasses: null
    });

    expect(updated.targetWeeklyClasses).toBeNull();
    expect(updated.targetRevenueCents).toBe(500000);
    expect(updated.targetStudents).toBe(20);
  });
});
