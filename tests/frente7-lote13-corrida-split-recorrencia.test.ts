import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FinancialRecurrence, UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { FinancialService } from "../src/modules/financial/services/financial.service";

// Épico de Frentes, Frente 7 (Tela Financeiro do profissional), Lote 13:
// updateIncome/updateExpense faziam o split de recorrência (fechar a série
// antiga + criar uma nova) em duas chamadas Prisma separadas, sem nenhuma
// proteção contra corrida - duas edições quase simultâneas da mesma âncora
// liam o mesmo recurrenceEndDate original e cada uma criava sua própria
// série nova, duplicando a recorrência dali em diante.

const financialService = new FinancialService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function monthsAgo(offset: number) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return d;
}

let providerUserId = "";
let providerId = "";
const incomeIds: string[] = [];

describe("Frente 7, Lote 13 — corrida ao editar a âncora de uma recorrência com histórico já passado", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Sete Lote Treze",
        email: `${uid("f7l13_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Sete Lote Treze",
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
    await prisma.financialIncome.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: providerUserId } });
    await prisma.user.deleteMany({ where: { id: providerUserId } });
    await prisma.$disconnect();
  });

  it("duas edições quase simultâneas da mesma âncora: só uma cria a nova série, a outra recebe conflito", async () => {
    const anchor = await prisma.financialIncome.create({
      data: {
        providerId,
        description: "Mensalidade recorrente",
        amountCents: 20000,
        source: "MANUAL",
        recurrence: FinancialRecurrence.RECURRING,
        paidAt: monthsAgo(-3)
      }
    });
    incomeIds.push(anchor.id);

    const results = await Promise.allSettled([
      financialService.updateIncome(providerUserId, anchor.id, { amountCents: 25000 }),
      financialService.updateIncome(providerUserId, anchor.id, { amountCents: 30000 })
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const seriesRows = await prisma.financialIncome.findMany({
      where: { providerId, description: "Mensalidade recorrente" }
    });
    seriesRows.forEach((r) => incomeIds.push(r.id));
    // A âncora original + exatamente UMA nova série (não duas).
    expect(seriesRows).toHaveLength(2);
    const closedAnchor = seriesRows.find((r) => r.id === anchor.id)!;
    expect(closedAnchor.recurrenceEndDate).not.toBeNull();
  });
});
