import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ConsultancyContractOrigin, ConsultancyContractStatus } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Bloco 4 (aluno externo): check-in periódico trimestral (90 dias —
// realinhado com o Will em 2026-08-25, era mensal/30 dias). Sem confirmação
// do profissional, o vínculo externo é encerrado automaticamente depois de
// mais 15 dias de carência (mesmo prazo já citado no documento de
// estratégia original pra aluno externo inadimplente — não mudou).

const consultancyService = new ConsultancyService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function makeProvider(label: string) {
  const user = await prisma.user.create({
    data: {
      name: `CheckIn ${label} Provider`,
      email: `${uid(`ci_${label}_prov`)}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}`,
      role: "PROVIDER"
    }
  });
  const profile = await prisma.providerProfile.create({
    data: {
      userId: user.id,
      displayName: `CheckIn ${label} Provider`,
      bio: "test",
      experienceYears: 3,
      priceCents: 15000,
      mpAccountId: `${Math.floor(Math.random() * 1_000_000_000)}`,
      mpAccessToken: encryptSensitiveText("fake_access_token"),
      crefValidationStatus: "IN_REVIEW"
    }
  });
  return { userId: user.id, providerId: profile.id };
}

async function makeClient(label: string) {
  const user = await prisma.user.create({
    data: {
      name: `CheckIn ${label} Client`,
      email: `${uid(`ci_${label}_client`)}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}`,
      role: "CLIENT"
    }
  });
  return user.id;
}

const userIdsToCleanup = new Set<string>();
const providerProfileIdsToCleanup = new Set<string>();

describe("Bloco 4 — check-in periódico do aluno externo", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    const userIds = Array.from(userIdsToCleanup);
    const requestIds = (
      await prisma.consultancyRequest.findMany({ where: { clientId: { in: userIds } }, select: { id: true } })
    ).map((r) => r.id);
    const offerIds = (
      await prisma.consultancyContract.findMany({ where: { clientId: { in: userIds } }, select: { offerId: true } })
    ).map((c) => c.offerId);
    await prisma.consultancyContract.deleteMany({ where: { clientId: { in: userIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: Array.from(providerProfileIdsToCleanup) } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("createExternalStudentContract já nasce com externalCheckInDueAt em ~90 dias", async () => {
    const provider = await makeProvider("create1");
    const client = await makeClient("create1");
    userIdsToCleanup.add(client);
    providerProfileIdsToCleanup.add(provider.providerId);

    const contract = await consultancyService.createExternalStudentContract(provider.userId, { clientId: client });

    expect(contract.externalCheckInDueAt).not.toBeNull();
    const diffDays =
      (contract.externalCheckInDueAt!.getTime() - contract.createdAt.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeCloseTo(90, 1);
  });

  it("listExternalCheckIns só devolve vínculos vencidos (dueAt <= agora)", async () => {
    const provider = await makeProvider("list1");
    const client = await makeClient("list1");
    userIdsToCleanup.add(client);
    providerProfileIdsToCleanup.add(provider.providerId);

    const contract = await consultancyService.createExternalStudentContract(provider.userId, { clientId: client });

    // Recém-criado, vencimento em 90 dias — não deve aparecer ainda.
    let checkIns = await consultancyService.listExternalCheckIns(provider.userId);
    expect(checkIns.find((c) => c.contractId === contract.id)).toBeUndefined();

    // Força o vencimento pro passado.
    await prisma.consultancyContract.update({
      where: { id: contract.id },
      data: { externalCheckInDueAt: new Date(Date.now() - 60 * 60 * 1000) }
    });

    checkIns = await consultancyService.listExternalCheckIns(provider.userId);
    expect(checkIns.find((c) => c.contractId === contract.id)).toBeTruthy();
  });

  it("confirmExternalCheckIn reseta o vencimento pra +90 dias a partir de agora", async () => {
    const provider = await makeProvider("confirm1");
    const client = await makeClient("confirm1");
    userIdsToCleanup.add(client);
    providerProfileIdsToCleanup.add(provider.providerId);

    const contract = await consultancyService.createExternalStudentContract(provider.userId, { clientId: client });
    await prisma.consultancyContract.update({
      where: { id: contract.id },
      data: {
        externalCheckInDueAt: new Date(Date.now() - 60 * 60 * 1000),
        externalCheckInReminderSentAt: new Date()
      }
    });

    const before = Date.now();
    const confirmed = await consultancyService.confirmExternalCheckIn(provider.userId, contract.id);
    expect(confirmed.externalCheckInReminderSentAt).toBeNull();
    const diffDays = (confirmed.externalCheckInDueAt!.getTime() - before) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeCloseTo(90, 1);

    const checkIns = await consultancyService.listExternalCheckIns(provider.userId);
    expect(checkIns.find((c) => c.contractId === contract.id)).toBeUndefined();
  });

  it("confirmExternalCheckIn rejeita outro profissional tentando confirmar", async () => {
    const provider = await makeProvider("confirm2");
    const otherProvider = await makeProvider("confirm2b");
    const client = await makeClient("confirm2");
    userIdsToCleanup.add(client);
    providerProfileIdsToCleanup.add(provider.providerId);
    providerProfileIdsToCleanup.add(otherProvider.providerId);

    const contract = await consultancyService.createExternalStudentContract(provider.userId, { clientId: client });

    await expect(
      consultancyService.confirmExternalCheckIn(otherProvider.userId, contract.id)
    ).rejects.toThrow(/não encontrado/i);
  });

  it("sendExternalCheckInReminders manda lembrete (throttle de 24h) enquanto dentro da carência de 15 dias", async () => {
    const provider = await makeProvider("remind1");
    const client = await makeClient("remind1");
    userIdsToCleanup.add(client);
    providerProfileIdsToCleanup.add(provider.providerId);

    const contract = await consultancyService.createExternalStudentContract(provider.userId, { clientId: client });
    const dueAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // vencido há 1 dia
    await prisma.consultancyContract.update({
      where: { id: contract.id },
      data: { externalCheckInDueAt: dueAt }
    });

    const referenceDate = new Date();
    await consultancyService.sendExternalCheckInReminders(referenceDate);

    let reloaded = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(reloaded.status).toBe(ConsultancyContractStatus.ACTIVE);
    expect(reloaded.externalCheckInReminderSentAt?.getTime()).toBe(referenceDate.getTime());

    // Rodar de novo minutos depois não manda outro lembrete (throttle 24h).
    const secondRun = new Date(referenceDate.getTime() + 5 * 60 * 1000);
    await consultancyService.sendExternalCheckInReminders(secondRun);
    reloaded = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(reloaded.externalCheckInReminderSentAt?.getTime()).toBe(referenceDate.getTime());
  });

  it("sendExternalCheckInReminders encerra automaticamente depois de 15 dias de carência sem confirmação", async () => {
    const provider = await makeProvider("autocancel1");
    const client = await makeClient("autocancel1");
    userIdsToCleanup.add(client);
    providerProfileIdsToCleanup.add(provider.providerId);

    const contract = await consultancyService.createExternalStudentContract(provider.userId, { clientId: client });
    const dueAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000); // vencido há 20 dias (> 15 dias de carência)
    await prisma.consultancyContract.update({
      where: { id: contract.id },
      data: { externalCheckInDueAt: dueAt }
    });

    await consultancyService.sendExternalCheckInReminders(new Date());

    const reloaded = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(reloaded.status).toBe(ConsultancyContractStatus.CANCELLED);
  });

  it("sendExternalCheckInReminders nunca mexe em contrato origin MARKETPLACE", async () => {
    const provider = await makeProvider("marketplace1");
    const client = await makeClient("marketplace1");
    userIdsToCleanup.add(client);
    providerProfileIdsToCleanup.add(provider.providerId);

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId: provider.providerId,
        kind: "ONLINE_CONSULTANCY",
        title: `Consultoria ${uid("offer")}`,
        billingCycle: "MONTHLY",
        priceCents: 20000,
        fichaValidityDays: 30
      }
    });
    const request = await prisma.consultancyRequest.create({
      data: {
        providerId: provider.providerId,
        clientId: client,
        status: "ACCEPTED",
        quotedOfferId: offer.id,
        responseDeadlineAt: new Date(),
        respondedAt: new Date(),
        clientDecisionAt: new Date()
      }
    });
    const contract = await prisma.consultancyContract.create({
      data: {
        requestId: request.id,
        providerId: provider.providerId,
        clientId: client,
        offerId: offer.id,
        origin: ConsultancyContractOrigin.MARKETPLACE,
        status: ConsultancyContractStatus.ACTIVE,
        paymentMethod: "CREDIT_CARD",
        paymentStatus: "CAPTURED",
        paymentAmountCents: 20000,
        providerAmountCents: 18000,
        platformAmountCents: 2000,
        billingCycle: offer.billingCycle,
        kind: offer.kind,
        fichaValidityDays: offer.fichaValidityDays,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date(),
        // dueAt vencido de propósito - não deveria importar, é MARKETPLACE.
        externalCheckInDueAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
      }
    });

    await consultancyService.sendExternalCheckInReminders(new Date());

    const reloaded = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(reloaded.status).toBe(ConsultancyContractStatus.ACTIVE);
    expect(reloaded.externalCheckInReminderSentAt).toBeNull();
  });
});
