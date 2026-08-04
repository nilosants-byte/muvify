import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { CrefValidationStatus, PresentialPackageMode, PresentialPackageStatus, ConsultancyContractStatus } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { NotificationService } from "../src/modules/notifications/services/notification.service";
import { hashValue } from "../src/shared/utils/hash";

// Épico de Frentes, Frente 9, Lote 18: polish de push e lembretes.
// (1) purgeStaleDevices expurga PushDevice inativo há muito tempo, mas
//     preserva dispositivo inativo recente e dispositivo ainda ativo.
// (2) sendFlexibleSessionPackExpiryReminders/sendPresentialPackageBillingReminders
//     passam a notificar também o profissional, com texto diferente do
//     cliente.
// (3) sendConsultancyExpiryReminders separa o texto por papel (cliente vs
//     profissional), no mesmo padrão de sendFichaExpiryReminders.
//
// Observação transparente: o achado original também citava "CHARGEBACK"
// como tipo de notificação sem deep link — investigando a origem real
// (payment.service.ts / dispute-case.service.ts), "CHARGEBACK" nunca é
// emitido como data.type de notificação, só existe como valor de
// DisputeCase.type no banco. O fluxo de notificação real desse caso já usa
// type: "PAYMENT_DISPUTED" (coberto pelo Lote 17). Nenhum tratamento de
// deep link foi adicionado para "CHARGEBACK" por não ser código alcançável.

const presentialPackageService = new PresentialPackageService();
const consultancyService = new ConsultancyService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let categoryId = "";
let clientId = "";
let providerUserId = "";
let providerId = "";
let offerId = "";
let consultancyOfferId = "";
const createdUserIds: string[] = [];
const packageIds: string[] = [];
const contractIds: string[] = [];
const requestIds: string[] = [];
const deviceIds: string[] = [];

describe("Frente 9, Lote 18 — polish de push e lembretes", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `F9L18_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Frente Nove Lote Dezoito Client",
        email: `${uid("f9l18_client")}@test.com`,
        password: await hashValue("Test1234"),
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;
    createdUserIds.push(clientId);

    const providerUser = await prisma.user.create({
      data: {
        name: "Frente Nove Lote Dezoito Provider",
        email: `${uid("f9l18_provider")}@test.com`,
        password: await hashValue("Test1234"),
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;
    createdUserIds.push(providerUserId);

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "F9L18 Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: `mp_${uid("f9l18")}`,
        crefValidationStatus: CrefValidationStatus.APPROVED
      }
    });
    providerId = provider.id;

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "PRESENTIAL",
        title: "Pacote de teste F9L18",
        billingCycle: "MONTHLY",
        priceCents: 30000,
        presentialPackageMode: "FIXED_RECURRING",
        presentialHasFixedTerm: false,
        presentialSessionsPerCycle: 4
      }
    });
    offerId = offer.id;

    const consultancyOffer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "ONLINE_CONSULTANCY",
        title: `Consultoria ${uid("offer")}`,
        billingCycle: "MONTHLY",
        priceCents: 20000,
        fichaValidityDays: 30
      }
    });
    consultancyOfferId = consultancyOffer.id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.pushDevice.deleteMany({ where: { id: { in: deviceIds } } });
    await prisma.consultancyContract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.presentialPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: [offerId, consultancyOfferId] } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  describe("purgeStaleDevices", () => {
    it("remove dispositivo inativo há mais tempo que o limite, preserva inativo recente e ativo", async () => {
      const notificationService = new NotificationService();
      const longInactive = await prisma.pushDevice.create({
        data: {
          userId: clientId,
          token: `ExponentPushToken[${uid("stale")}]`,
          isActive: false,
          invalidAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000)
        }
      });
      deviceIds.push(longInactive.id);

      const recentlyInactive = await prisma.pushDevice.create({
        data: {
          userId: clientId,
          token: `ExponentPushToken[${uid("recent")}]`,
          isActive: false,
          invalidAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
        }
      });
      deviceIds.push(recentlyInactive.id);

      const stillActive = await prisma.pushDevice.create({
        data: {
          userId: clientId,
          token: `ExponentPushToken[${uid("active")}]`,
          isActive: true
        }
      });
      deviceIds.push(stillActive.id);

      const purged = await notificationService.purgeStaleDevices(new Date(), 90);
      expect(purged).toBeGreaterThanOrEqual(1);

      const remaining = await prisma.pushDevice.findMany({
        where: { id: { in: [longInactive.id, recentlyInactive.id, stillActive.id] } },
        select: { id: true }
      });
      const remainingIds = remaining.map((d) => d.id);
      expect(remainingIds).not.toContain(longInactive.id);
      expect(remainingIds).toContain(recentlyInactive.id);
      expect(remainingIds).toContain(stillActive.id);
    });
  });

  describe("lembretes de pacote presencial notificam também o profissional", () => {
    it("pacote de créditos flexíveis vencendo notifica cliente e profissional com textos diferentes", async () => {
      const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);

      const pkg = await prisma.presentialPackage.create({
        data: {
          clientId,
          providerId,
          offerId,
          categoryId,
          mode: PresentialPackageMode.FLEXIBLE_CREDITS,
          status: PresentialPackageStatus.ACTIVE,
          cycleAmountCents: 30000,
          billingCycle: "MONTHLY",
          sessionsPerCycle: 4,
          creditsRemainingThisCycle: 3,
          validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });
      packageIds.push(pkg.id);

      await presentialPackageService.sendFlexibleSessionPackExpiryReminders();

      const clientCall = notifySpy.mock.calls.find((call) => (call[0] as string[]).includes(clientId));
      const providerCall = notifySpy.mock.calls.find((call) => (call[0] as string[]).includes(providerUserId));
      expect(clientCall).toBeDefined();
      expect(providerCall).toBeDefined();
      expect((clientCall![1] as any).body).not.toBe((providerCall![1] as any).body);
    });

    it("pacote recorrente com cobrança chegando notifica cliente e profissional com textos diferentes", async () => {
      const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);

      const pkg = await prisma.presentialPackage.create({
        data: {
          clientId,
          providerId,
          offerId,
          categoryId,
          mode: PresentialPackageMode.FIXED_RECURRING,
          status: PresentialPackageStatus.ACTIVE,
          cycleAmountCents: 30000,
          billingCycle: "MONTHLY",
          sessionsPerCycle: 4,
          nextBillingAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });
      packageIds.push(pkg.id);

      await presentialPackageService.sendPresentialPackageBillingReminders();

      const clientCall = notifySpy.mock.calls.find((call) => (call[0] as string[]).includes(clientId));
      const providerCall = notifySpy.mock.calls.find((call) => (call[0] as string[]).includes(providerUserId));
      expect(clientCall).toBeDefined();
      expect(providerCall).toBeDefined();
      expect((clientCall![1] as any).body).not.toBe((providerCall![1] as any).body);
    });
  });

  describe("lembrete de vencimento de consultoria separado por papel", () => {
    async function makeActiveConsultancyContract(deliveryDeadlineAt: Date) {
      const request = await prisma.consultancyRequest.create({
        data: {
          providerId,
          clientId,
          status: "ACCEPTED",
          quotedOfferId: consultancyOfferId,
          responseDeadlineAt: new Date(),
          respondedAt: new Date(),
          clientDecisionAt: new Date()
        }
      });
      requestIds.push(request.id);

      const contract = await prisma.consultancyContract.create({
        data: {
          requestId: request.id,
          providerId,
          clientId,
          offerId: consultancyOfferId,
          status: ConsultancyContractStatus.ACTIVE,
          paymentMethod: "CREDIT_CARD",
          paymentStatus: "CAPTURED",
          paymentAmountCents: 20000,
          providerAmountCents: 18000,
          platformAmountCents: 2000,
          billingCycle: "MONTHLY",
          kind: "ONLINE_CONSULTANCY",
          fichaValidityDays: 30,
          deliveryDeadlineAt,
          immediateExecutionAcknowledgedAt: new Date()
        }
      });
      contractIds.push(contract.id);
      return contract;
    }

    it("aviso de 24h usa texto diferente para cliente e profissional", async () => {
      const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
      await makeActiveConsultancyContract(new Date(Date.now() + 24 * 60 * 60 * 1000));

      await consultancyService.sendConsultancyExpiryReminders();

      const clientCall = notifySpy.mock.calls.find((call) => (call[0] as string[]).includes(clientId));
      const providerCall = notifySpy.mock.calls.find((call) => (call[0] as string[]).includes(providerUserId));
      expect(clientCall).toBeDefined();
      expect(providerCall).toBeDefined();
      expect((clientCall![1] as any).body).not.toBe((providerCall![1] as any).body);
      // Texto do cliente fala do "seu plano de treino"; o do profissional
      // precisa deixar claro que é ELE quem tem que entregar.
      expect((providerCall![1] as any).body.toLowerCase()).toContain("entregar");
    });

    it("aviso de 6h usa texto diferente para cliente e profissional", async () => {
      const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
      await makeActiveConsultancyContract(new Date(Date.now() + 6 * 60 * 60 * 1000));

      await consultancyService.sendConsultancyExpiryReminders();

      const clientCall = notifySpy.mock.calls.find((call) => (call[0] as string[]).includes(clientId));
      const providerCall = notifySpy.mock.calls.find((call) => (call[0] as string[]).includes(providerUserId));
      expect(clientCall).toBeDefined();
      expect(providerCall).toBeDefined();
      expect((clientCall![1] as any).body).not.toBe((providerCall![1] as any).body);
    });
  });
});
