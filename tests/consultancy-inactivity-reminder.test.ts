import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { ConsultancyContractStatus } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { NotificationService } from "../src/modules/notifications/services/notification.service";

// Segunda camada: aviso ao profissional quando um aluno de consultoria
// online (contrato DELIVERED) fica 3+ dias sem registrar treino, repetindo
// a cada 24h enquanto continuar inativo.

const consultancyService = new ConsultancyService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let categoryId = "";
let clientId = "";
let providerUserId = "";
let providerId = "";
let consultancyOfferId = "";
const createdUserIds: string[] = [];
const contractIds: string[] = [];
const requestIds: string[] = [];

describe("sendConsultancyInactivityReminders", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `INACT_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Inactivity Client",
        email: `${uid("inact_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;
    createdUserIds.push(clientId);

    const providerUser = await prisma.user.create({
      data: {
        name: "Inactivity Provider",
        email: `${uid("inact_provider")}@test.com`,
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
        displayName: "Inactivity Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000
      }
    });
    providerId = provider.id;

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
    await prisma.trainingPlanCompletion.deleteMany({ where: { providerId } });
    await prisma.trainingPlan.deleteMany({ where: { providerId } });
    await prisma.consultancyContract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: consultancyOfferId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  async function makeContract(status: ConsultancyContractStatus, deliveredAt: Date | null, inactivityReminderSentAt: Date | null = null) {
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
        status,
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
        deliveredAt,
        inactivityReminderSentAt
      }
    });
    contractIds.push(contract.id);
    return contract;
  }

  async function makePlan(contractId: string) {
    return prisma.trainingPlan.create({
      data: { providerId, contractId, title: "Ficha de teste", isPrebuilt: false, isActive: true }
    });
  }

  async function makeCompletion(contractId: string, trainingPlanId: string, completedAt: Date) {
    return prisma.trainingPlanCompletion.create({
      data: { clientId, providerId, trainingPlanId, contractId, completedAt }
    });
  }

  it("aluno sem treinar há 4 dias (última conclusão): notifica o profissional", async () => {
    const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
    const now = new Date();
    const contract = await makeContract(ConsultancyContractStatus.DELIVERED, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
    const plan = await makePlan(contract.id);
    await makeCompletion(contract.id, plan.id, new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000));

    await consultancyService.sendConsultancyInactivityReminders(now);

    const providerCall = notifySpy.mock.calls.find((call) => (call[0] as string[]).includes(providerUserId));
    expect(providerCall).toBeDefined();
    expect((providerCall![1] as any).data.contractId).toBe(contract.id);

    const fromDb = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(fromDb.inactivityReminderSentAt?.getTime()).toBe(now.getTime());
  });

  it("aluno treinou há 1 dia: não notifica", async () => {
    const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
    const now = new Date();
    const contract = await makeContract(ConsultancyContractStatus.DELIVERED, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
    const plan = await makePlan(contract.id);
    await makeCompletion(contract.id, plan.id, new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000));

    await consultancyService.sendConsultancyInactivityReminders(now);

    const providerCall = notifySpy.mock.calls.find((call) => (call[0] as string[]).includes(providerUserId));
    expect(providerCall).toBeUndefined();

    const fromDb = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(fromDb.inactivityReminderSentAt).toBeNull();
  });

  it("sem nenhuma conclusão registrada, ficha entregue há 4 dias: usa deliveredAt como referência e notifica", async () => {
    const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
    const now = new Date();
    const contract = await makeContract(ConsultancyContractStatus.DELIVERED, new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000));
    await makePlan(contract.id);

    await consultancyService.sendConsultancyInactivityReminders(now);

    const providerCall = notifySpy.mock.calls.find((call) => (call[0] as string[]).includes(providerUserId));
    expect(providerCall).toBeDefined();
  });

  it("contrato ainda ACTIVE (ficha não entregue): não notifica, mesmo sem nenhum treino", async () => {
    const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
    const now = new Date();
    const contract = await makeContract(ConsultancyContractStatus.ACTIVE, null);

    await consultancyService.sendConsultancyInactivityReminders(now);

    const providerCall = notifySpy.mock.calls.find((call) => (call[0] as string[]).includes(providerUserId));
    expect(providerCall).toBeUndefined();

    const fromDb = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(fromDb.inactivityReminderSentAt).toBeNull();
  });

  it("aluno inativo com último aviso há 5h: não repete ainda (throttle de 24h)", async () => {
    const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
    const now = new Date();
    const lastSent = new Date(now.getTime() - 5 * 60 * 60 * 1000);
    const contract = await makeContract(
      ConsultancyContractStatus.DELIVERED,
      new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      lastSent
    );
    const plan = await makePlan(contract.id);
    await makeCompletion(contract.id, plan.id, new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000));

    await consultancyService.sendConsultancyInactivityReminders(now);

    const providerCall = notifySpy.mock.calls.find((call) => (call[0] as string[]).includes(providerUserId));
    expect(providerCall).toBeUndefined();

    const fromDb = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(fromDb.inactivityReminderSentAt?.getTime()).toBe(lastSent.getTime());
  });

  it("aluno inativo com último aviso há 25h: repete", async () => {
    const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
    const now = new Date();
    const contract = await makeContract(
      ConsultancyContractStatus.DELIVERED,
      new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      new Date(now.getTime() - 25 * 60 * 60 * 1000)
    );
    const plan = await makePlan(contract.id);
    await makeCompletion(contract.id, plan.id, new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));

    await consultancyService.sendConsultancyInactivityReminders(now);

    const providerCall = notifySpy.mock.calls.find((call) => (call[0] as string[]).includes(providerUserId));
    expect(providerCall).toBeDefined();

    const fromDb = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(fromDb.inactivityReminderSentAt?.getTime()).toBe(now.getTime());
  });
});
