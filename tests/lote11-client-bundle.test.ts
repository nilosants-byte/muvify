import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/config/prisma";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";
import { DisputeCaseService } from "../src/modules/admin/services/dispute-case.service";

// Raio-X de pagamentos, Rodada 4, Lote 11: bundle de moderados na jornada do
// cliente. Cobre os dois itens com lógica de negócio nova: lembrete antes da
// próxima cobrança automática de um pacote recorrente, e a listagem
// self-service de disputas (cliente e profissional só veem os próprios
// casos).

const presentialPackageService = new PresentialPackageService();
const disputeCaseService = new DisputeCaseService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
let offerId = "";
const packageIds: string[] = [];
const disputeCaseIds: string[] = [];

describe("Bundle de moderados — jornada do cliente (Rodada 4, Lote 11)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `L11_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Lote Onze Client",
        email: `${uid("l11_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Lote Onze Provider",
        email: `${uid("l11_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Lote Onze Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000
      }
    });
    providerId = provider.id;

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "PRESENTIAL",
        title: "Pacote recorrente de teste",
        billingCycle: "MONTHLY",
        priceCents: 30000,
        presentialPackageMode: "FIXED_RECURRING",
        presentialHasFixedTerm: false,
        presentialSessionsPerCycle: 4
      }
    });
    offerId = offer.id;
  });

  afterAll(async () => {
    await prisma.disputeCase.deleteMany({ where: { id: { in: disputeCaseIds } } });
    await prisma.presentialPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: offerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  async function makePackage(nextBillingAt: Date) {
    const pkg = await prisma.presentialPackage.create({
      data: {
        providerId,
        clientId,
        offerId,
        categoryId,
        mode: "FIXED_RECURRING",
        status: "ACTIVE",
        cycleAmountCents: 30000,
        billingCycle: "MONTHLY",
        sessionsPerCycle: 4,
        nextBillingAt
      }
    });
    packageIds.push(pkg.id);
    return pkg;
  }

  it("envia lembrete uma única vez quando a próxima cobrança está próxima", async () => {
    const pkg = await makePackage(new Date(Date.now() + 24 * 60 * 60 * 1000)); // em 1 dia, janela é 3 dias

    await presentialPackageService.sendPresentialPackageBillingReminders();
    let fromDb = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(fromDb.billingReminderSentAt).not.toBeNull();

    const sentAtFirstRun = fromDb.billingReminderSentAt;
    await presentialPackageService.sendPresentialPackageBillingReminders();
    fromDb = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(fromDb.billingReminderSentAt?.getTime()).toBe(sentAtFirstRun?.getTime());
  });

  it("não envia lembrete quando a cobrança ainda está longe", async () => {
    const pkg = await makePackage(new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)); // em 10 dias, fora da janela de 3

    await presentialPackageService.sendPresentialPackageBillingReminders();
    const fromDb = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(fromDb.billingReminderSentAt).toBeNull();
  });

  it("listMyDisputes: cliente só vê os próprios casos, como cliente ou profissional", async () => {
    const myCase = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", clientId, providerId, amountCents: 5000 }
    });
    disputeCaseIds.push(myCase.id);

    const otherClient = await prisma.user.create({
      data: {
        name: "Other Dispute Client",
        email: `${uid("l11_other")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}3`,
        role: "CLIENT"
      }
    });
    const otherCase = await prisma.disputeCase.create({
      data: { type: "CHARGEBACK", clientId: otherClient.id, providerId, amountCents: 7000 }
    });
    disputeCaseIds.push(otherCase.id);

    const myDisputes = await disputeCaseService.listMyDisputes(clientId);
    expect(myDisputes.some((d) => d.id === myCase.id)).toBe(true);
    expect(myDisputes.some((d) => d.id === otherCase.id)).toBe(false);

    const providerDisputes = await disputeCaseService.listMyDisputes(providerUserId);
    expect(providerDisputes.some((d) => d.id === myCase.id)).toBe(true);
    expect(providerDisputes.some((d) => d.id === otherCase.id)).toBe(true);

    await prisma.session.deleteMany({ where: { userId: otherClient.id } });
    await prisma.user.deleteMany({ where: { id: otherClient.id } });
  });
});
