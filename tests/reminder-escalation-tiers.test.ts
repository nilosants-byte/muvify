import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { ConsultancyContractStatus, PresentialPackageMode, PresentialPackageStatus } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { NotificationService } from "../src/modules/notifications/services/notification.service";

// Segunda camada: lembretes de cobrança vencendo passam a repetir (diário
// nos primeiros dias, a cada 3 dias depois) em vez de disparar só uma vez.
// Cobre os três pontos que ganharam esse comportamento: pacote presencial
// recorrente, ficha de consultoria na fase pré-vencimento, e o
// escalonamento pós-vencimento da ficha na fase estendida (>3 dias vencida).

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

describe("Escalonamento de lembretes de cobrança vencendo", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `ESC_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Escalation Client",
        email: `${uid("esc_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;
    createdUserIds.push(clientId);

    const providerUser = await prisma.user.create({
      data: {
        name: "Escalation Provider",
        email: `${uid("esc_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;
    createdUserIds.push(providerUserId);

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Escalation Provider",
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
        title: "Pacote recorrente escalonamento",
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.trainingPlan.deleteMany({ where: { providerId } });
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

  describe("sendPresentialPackageBillingReminders", () => {
    async function makePackage(nextBillingAt: Date, billingReminderSentAt: Date | null) {
      const pkg = await prisma.presentialPackage.create({
        data: {
          providerId,
          clientId,
          offerId,
          categoryId,
          mode: PresentialPackageMode.FIXED_RECURRING,
          status: PresentialPackageStatus.ACTIVE,
          cycleAmountCents: 30000,
          billingCycle: "MONTHLY",
          sessionsPerCycle: 4,
          nextBillingAt,
          billingReminderSentAt
        }
      });
      packageIds.push(pkg.id);
      return pkg;
    }

    it("vencida há 1 dia (fase inicial) com último aviso há 25h: repete", async () => {
      vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
      const now = new Date();
      const pkg = await makePackage(
        new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
        new Date(now.getTime() - 25 * 60 * 60 * 1000)
      );

      await presentialPackageService.sendPresentialPackageBillingReminders(now);
      const fromDb = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
      expect(fromDb.billingReminderSentAt?.getTime()).toBe(now.getTime());
    });

    it("vencida há 1 dia (fase inicial) com último aviso há 5h: não repete ainda (throttle de 24h)", async () => {
      vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
      const now = new Date();
      const lastSent = new Date(now.getTime() - 5 * 60 * 60 * 1000);
      const pkg = await makePackage(new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000), lastSent);

      await presentialPackageService.sendPresentialPackageBillingReminders(now);
      const fromDb = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
      expect(fromDb.billingReminderSentAt?.getTime()).toBe(lastSent.getTime());
    });

    it("vencida há 4 dias (fase estendida) com último aviso há 25h: não repete ainda (throttle passa a 72h)", async () => {
      vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
      const now = new Date();
      const lastSent = new Date(now.getTime() - 25 * 60 * 60 * 1000);
      const pkg = await makePackage(new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000), lastSent);

      await presentialPackageService.sendPresentialPackageBillingReminders(now);
      const fromDb = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
      expect(fromDb.billingReminderSentAt?.getTime()).toBe(lastSent.getTime());
    });

    it("vencida há 4 dias (fase estendida) com último aviso há 73h: repete", async () => {
      vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
      const now = new Date();
      const pkg = await makePackage(
        new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
        new Date(now.getTime() - 73 * 60 * 60 * 1000)
      );

      await presentialPackageService.sendPresentialPackageBillingReminders(now);
      const fromDb = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
      expect(fromDb.billingReminderSentAt?.getTime()).toBe(now.getTime());
    });
  });

  describe("sendFichaExpiryReminders (fase pré-vencimento)", () => {
    async function makeDeliveredContract() {
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
          status: ConsultancyContractStatus.DELIVERED,
          paymentMethod: "CREDIT_CARD",
          paymentStatus: "CAPTURED",
          paymentAmountCents: 20000,
          providerAmountCents: 18000,
          platformAmountCents: 2000,
          billingCycle: "MONTHLY",
          kind: "ONLINE_CONSULTANCY",
          fichaValidityDays: 30,
          deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
          immediateExecutionAcknowledgedAt: new Date(),
          deliveredAt: new Date()
        }
      });
      contractIds.push(contract.id);
      return contract;
    }

    it("vencendo em 2 dias com último aviso há 25h: repete", async () => {
      vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
      const now = new Date();
      const contract = await makeDeliveredContract();
      const plan = await prisma.trainingPlan.create({
        data: {
          providerId,
          contractId: contract.id,
          title: "Ficha pré-vencimento",
          isPrebuilt: false,
          isActive: true,
          validUntil: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
          expiryReminderSentAt: new Date(now.getTime() - 25 * 60 * 60 * 1000)
        }
      });

      await consultancyService.sendFichaExpiryReminders(now);
      const fromDb = await prisma.trainingPlan.findUniqueOrThrow({ where: { id: plan.id } });
      expect(fromDb.expiryReminderSentAt?.getTime()).toBe(now.getTime());
    });

    it("vencendo em 2 dias com último aviso há 5h: não repete ainda", async () => {
      vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
      const now = new Date();
      const lastSent = new Date(now.getTime() - 5 * 60 * 60 * 1000);
      const contract = await makeDeliveredContract();
      const plan = await prisma.trainingPlan.create({
        data: {
          providerId,
          contractId: contract.id,
          title: "Ficha pré-vencimento 2",
          isPrebuilt: false,
          isActive: true,
          validUntil: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
          expiryReminderSentAt: lastSent
        }
      });

      await consultancyService.sendFichaExpiryReminders(now);
      const fromDb = await prisma.trainingPlan.findUniqueOrThrow({ where: { id: plan.id } });
      expect(fromDb.expiryReminderSentAt?.getTime()).toBe(lastSent.getTime());
    });
  });

  describe("escalateExpiredFichaContracts (fase estendida pós-vencimento)", () => {
    async function makeExpiredDeliveredContract() {
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
          status: ConsultancyContractStatus.DELIVERED,
          paymentMethod: "CREDIT_CARD",
          paymentStatus: "CAPTURED",
          paymentAmountCents: 20000,
          providerAmountCents: 18000,
          platformAmountCents: 2000,
          billingCycle: "MONTHLY",
          kind: "ONLINE_CONSULTANCY",
          fichaValidityDays: 30,
          deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
          immediateExecutionAcknowledgedAt: new Date(),
          deliveredAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000)
        }
      });
      contractIds.push(contract.id);
      return contract;
    }

    it("vencida há 4 dias (fase estendida) com última escalada há 25h: não escala ainda (throttle passa a 72h)", async () => {
      vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
      const now = new Date();
      const lastEscalation = new Date(now.getTime() - 25 * 60 * 60 * 1000);
      const contract = await makeExpiredDeliveredContract();
      const plan = await prisma.trainingPlan.create({
        data: {
          providerId,
          contractId: contract.id,
          title: "Ficha vencida fase estendida",
          isPrebuilt: false,
          isActive: true,
          validUntil: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
          expiredNoticeSentAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
          lastEscalationSentAt: lastEscalation
        }
      });

      await consultancyService.escalateExpiredFichaContracts(now);
      const fromDb = await prisma.trainingPlan.findUniqueOrThrow({ where: { id: plan.id } });
      expect(fromDb.lastEscalationSentAt?.getTime()).toBe(lastEscalation.getTime());
    });

    it("vencida há 4 dias (fase estendida) com última escalada há 73h: escala de novo", async () => {
      vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
      const now = new Date();
      const contract = await makeExpiredDeliveredContract();
      const plan = await prisma.trainingPlan.create({
        data: {
          providerId,
          contractId: contract.id,
          title: "Ficha vencida fase estendida 2",
          isPrebuilt: false,
          isActive: true,
          validUntil: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
          expiredNoticeSentAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
          lastEscalationSentAt: new Date(now.getTime() - 73 * 60 * 60 * 1000)
        }
      });

      await consultancyService.escalateExpiredFichaContracts(now);
      const fromDb = await prisma.trainingPlan.findUniqueOrThrow({ where: { id: plan.id } });
      expect(fromDb.lastEscalationSentAt?.getTime()).toBe(now.getTime());
    });

    it("vencida há 2 dias (ainda fase inicial) com última escalada há 25h: escala de novo (throttle ainda é 24h)", async () => {
      vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
      const now = new Date();
      const contract = await makeExpiredDeliveredContract();
      const plan = await prisma.trainingPlan.create({
        data: {
          providerId,
          contractId: contract.id,
          title: "Ficha vencida fase inicial",
          isPrebuilt: false,
          isActive: true,
          validUntil: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
          expiredNoticeSentAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
          lastEscalationSentAt: new Date(now.getTime() - 25 * 60 * 60 * 1000)
        }
      });

      await consultancyService.escalateExpiredFichaContracts(now);
      const fromDb = await prisma.trainingPlan.findUniqueOrThrow({ where: { id: plan.id } });
      expect(fromDb.lastEscalationSentAt?.getTime()).toBe(now.getTime());
    });
  });
});
