import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { PaymentRefund } from "mercadopago";
import { prisma } from "../src/config/prisma";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";

// Raio-X de pagamentos, Rodada 5, Lote 7 (baixo risco): cancelamento de
// pacote FIXED_RECURRING pago em Pix pelo profissional estornava o valor
// cheio do último ciclo, mesmo quando várias sessões daquele ciclo já
// tinham sido entregues. Agora prorateia pelo número de sessões restantes.

const packageService = new PresentialPackageService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const packageIds: string[] = [];

describe("Rodada 5, Lote 7 — prorateio do estorno de ciclo", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const category = await prisma.serviceCategory.create({ data: { name: `R5L7_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Lote7 Client",
        email: `${uid("l5l7_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Lote7 Provider",
        email: `${uid("l5l7_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Lote7 Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "444333222",
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { packageId: { in: packageIds } } });
    await prisma.presentialPackageCycle.deleteMany({ where: { packageId: { in: packageIds } } });
    await prisma.presentialPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  async function makeFixedRecurringPixPackage() {
    const offer = await prisma.providerServiceOffer.create({
      data: { providerId, kind: "PRESENTIAL", title: `Pacote Lote7 ${uid("offer")}`, billingCycle: "MONTHLY", priceCents: 8000 }
    });
    const periodStart = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
    const pkg = await prisma.presentialPackage.create({
      data: {
        providerId,
        clientId,
        offerId: offer.id,
        categoryId,
        mode: "FIXED_RECURRING",
        paymentMethod: "PIX",
        status: "ACTIVE",
        cycleAmountCents: 8000,
        billingCycle: "MONTHLY",
        sessionsPerCycle: 4
      }
    });
    packageIds.push(pkg.id);
    const cycle = await prisma.presentialPackageCycle.create({
      data: {
        packageId: pkg.id,
        cycleIndex: 1,
        amountCents: 8000,
        sessionsGranted: 4,
        mpPaymentId: `mp_${uid("cycle")}`,
        periodStart,
        periodEnd
      }
    });
    return { pkg, cycle, periodStart, periodEnd };
  }

  it("estorna só a fração correspondente às sessões restantes quando metade do ciclo já foi entregue", async () => {
    const { pkg, periodStart } = await makeFixedRecurringPixPackage();

    await prisma.booking.createMany({
      data: [
        { clientId, providerId, categoryId, packageId: pkg.id, scheduledAt: new Date(periodStart.getTime() + 1 * 24 * 60 * 60 * 1000), priceCents: 2000, status: "COMPLETED" },
        { clientId, providerId, categoryId, packageId: pkg.id, scheduledAt: new Date(periodStart.getTime() + 2 * 24 * 60 * 60 * 1000), priceCents: 2000, status: "COMPLETED" },
        { clientId, providerId, categoryId, packageId: pkg.id, scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), priceCents: 2000, status: "CONFIRMED" },
        { clientId, providerId, categoryId, packageId: pkg.id, scheduledAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000), priceCents: 2000, status: "CONFIRMED" }
      ]
    });

    const refundSpy = vi.spyOn(PaymentRefund.prototype, "create").mockResolvedValue({} as any);

    await packageService.cancelPackage(providerUserId, pkg.id);

    expect(refundSpy).toHaveBeenCalledTimes(1);
    const callArg = refundSpy.mock.calls[0][0] as any;
    expect(callArg.body).toEqual({ amount: 40 });
  });

  it("estorna o valor cheio quando nenhuma sessão do ciclo foi entregue ainda", async () => {
    const { pkg } = await makeFixedRecurringPixPackage();

    await prisma.booking.createMany({
      data: [
        { clientId, providerId, categoryId, packageId: pkg.id, scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), priceCents: 2000, status: "CONFIRMED" },
        { clientId, providerId, categoryId, packageId: pkg.id, scheduledAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000), priceCents: 2000, status: "CONFIRMED" }
      ]
    });

    const refundSpy = vi.spyOn(PaymentRefund.prototype, "create").mockResolvedValue({} as any);

    await packageService.cancelPackage(providerUserId, pkg.id);

    expect(refundSpy).toHaveBeenCalledTimes(1);
    const callArg = refundSpy.mock.calls[0][0] as any;
    expect(callArg.body).toEqual({});
  });

  it("não estorna nada quando todas as sessões do ciclo já foram entregues", async () => {
    const { pkg, periodStart } = await makeFixedRecurringPixPackage();

    await prisma.booking.createMany({
      data: [
        { clientId, providerId, categoryId, packageId: pkg.id, scheduledAt: new Date(periodStart.getTime() + 1 * 24 * 60 * 60 * 1000), priceCents: 2000, status: "COMPLETED" },
        { clientId, providerId, categoryId, packageId: pkg.id, scheduledAt: new Date(periodStart.getTime() + 2 * 24 * 60 * 60 * 1000), priceCents: 2000, status: "COMPLETED" },
        { clientId, providerId, categoryId, packageId: pkg.id, scheduledAt: new Date(periodStart.getTime() + 3 * 24 * 60 * 60 * 1000), priceCents: 2000, status: "COMPLETED" },
        { clientId, providerId, categoryId, packageId: pkg.id, scheduledAt: new Date(periodStart.getTime() + 4 * 24 * 60 * 60 * 1000), priceCents: 2000, status: "COMPLETED" }
      ]
    });

    const refundSpy = vi.spyOn(PaymentRefund.prototype, "create").mockResolvedValue({} as any);

    await packageService.cancelPackage(providerUserId, pkg.id);

    expect(refundSpy).not.toHaveBeenCalled();
  });
});
