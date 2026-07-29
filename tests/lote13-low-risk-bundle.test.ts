import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { DebtService } from "../src/modules/payments/services/debt.service";

// Raio-X de pagamentos, Rodada 4, Lote 13: bundle de baixo risco. Cobre o
// item com lógica de negócio nova: paginação em DebtService.listAllDebts
// (antes take:200 fixo, sem nenhum indicador de "há mais" — acima disso,
// dívidas mais antigas simplesmente somiam da lista sem ninguém perceber).

const debtService = new DebtService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let adminId = "";
let disputeCaseId = "";
const debtIds: string[] = [];

describe("DebtService.listAllDebts pagina corretamente (Rodada 4, Lote 13)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const client = await prisma.user.create({
      data: {
        name: "Lote Treze Client",
        email: `${uid("l13_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Lote Treze Provider",
        email: `${uid("l13_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Lote Treze Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000
      }
    });
    providerId = provider.id;

    const disputeCase = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", clientId, providerId, amountCents: 5000 }
    });
    disputeCaseId = disputeCase.id;

    // 5 dívidas pra paginar com take pequeno.
    for (let i = 0; i < 5; i++) {
      const debt = await prisma.debtRecord.create({
        data: {
          disputeCaseId,
          debtorType: "CLIENT",
          clientId,
          amountCents: 1000 + i,
          reason: `teste de paginação ${i}`,
          status: "PENDING"
        }
      });
      debtIds.push(debt.id);
    }

    const adminReg = await prisma.user
      .create({
        data: {
          name: "Lote Treze Admin",
          email: env.ADMIN_ALLOWED_EMAILS[0],
          password: "x",
          phone: `11${Date.now().toString().slice(-9)}3`,
          role: "CLIENT"
        }
      })
      .catch(() => prisma.user.findUniqueOrThrow({ where: { email: env.ADMIN_ALLOWED_EMAILS[0] } }));
    adminId = adminReg.id;
  });

  afterAll(async () => {
    await prisma.debtRecord.deleteMany({ where: { id: { in: debtIds } } });
    await prisma.disputeCase.deleteMany({ where: { id: disputeCaseId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.$disconnect();
  });

  it("hasMore é true quando há mais registros além da página, e false na última página", async () => {
    const firstPage = await debtService.listAllDebts(adminId, undefined, 0, 3);
    const ourFirstPageIds = firstPage.items.filter((d) => debtIds.includes(d.id)).map((d) => d.id);
    expect(firstPage.items.length).toBeLessThanOrEqual(3);
    expect(firstPage.hasMore).toBe(true);

    const secondPage = await debtService.listAllDebts(adminId, undefined, 3, 3);
    const ourSecondPageIds = secondPage.items.filter((d) => debtIds.includes(d.id)).map((d) => d.id);
    // Nenhum id repetido entre as duas páginas.
    expect(ourFirstPageIds.some((id) => ourSecondPageIds.includes(id))).toBe(false);

    // Página bem além do total não tem mais nada.
    const emptyPage = await debtService.listAllDebts(adminId, "PAID", 100000, 10);
    expect(emptyPage.items).toEqual([]);
    expect(emptyPage.hasMore).toBe(false);
  });
});
