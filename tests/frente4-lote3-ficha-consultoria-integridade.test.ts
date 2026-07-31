import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { Payment, CardToken } from "mercadopago";
import { ConsultancyContractStatus, ConsultancyPaymentStatus } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { DisputeCaseService } from "../src/modules/admin/services/dispute-case.service";
import { encryptSensitiveText } from "../src/shared/utils/encryption";
import { env } from "../src/config/env";

// Épico de Frentes, Frente 4 (Criação/entrega/evolução do treino), Lote 3:
// (1) cliente com contrato cancelado ainda vê as fichas antigas (histórico),
//     mas não consegue mais registrar conclusão sobre elas.
// (2) updateTrainingPlan replica as proteções de deliverContract (contrato
//     ativo, sem contestação em aberto na própria ficha).
// (3) admin vê os exercícios completos ao julgar uma contestação de entrega.
// (4) entregar renovação desativa a ficha anterior automaticamente.

const consultancyService = new ConsultancyService();
const disputeCaseService = new DisputeCaseService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
let adminId = "";
const offerIds: string[] = [];
const contractIds: string[] = [];

describe("Frente 4, Lote 3 — integridade da ficha de consultoria", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `FI_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Ficha Integridade Client",
        email: `${uid("fi_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        mpCustomerId: "cus_test_fi"
      }
    });
    clientId = client.id;

    await prisma.customerPaymentMethod.create({
      data: {
        userId: clientId,
        mpCustomerId: "cus_test_fi",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });

    const providerUser = await prisma.user.create({
      data: {
        name: "Ficha Integridade Provider",
        email: `${uid("fi_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Ficha Integridade Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 15000,
        mpAccountId: "444333222",
        mpAccessToken: encryptSensitiveText("fake_access_token"),
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);

    const adminReg = await prisma.user
      .create({
        data: {
          name: "Ficha Integridade Admin",
          email: env.ADMIN_ALLOWED_EMAILS[0],
          password: "x",
          phone: `11${Date.now().toString().slice(-9)}9`,
          role: "CLIENT"
        }
      })
      .catch(() => prisma.user.findUniqueOrThrow({ where: { email: env.ADMIN_ALLOWED_EMAILS[0] } }));
    adminId = adminReg.id;
  });

  afterAll(async () => {
    await prisma.disputeCase.deleteMany({ where: { clientId } });
    await prisma.trainingPlan.deleteMany({ where: { providerId } });
    await prisma.consultancyContract.deleteMany({ where: { clientId } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
  });

  async function makeOffer() {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "ONLINE_CONSULTANCY",
        title: `Consultoria ${uid("offer")}`,
        billingCycle: "MONTHLY",
        priceCents: 20000,
        fichaValidityDays: 30
      }
    });
    offerIds.push(offer.id);
    return offer;
  }

  async function makeContract(offerId: string, status: ConsultancyContractStatus = ConsultancyContractStatus.ACTIVE) {
    const offer = await prisma.providerServiceOffer.findUniqueOrThrow({ where: { id: offerId } });
    const request = await prisma.consultancyRequest.create({
      data: {
        providerId,
        clientId,
        status: "ACCEPTED",
        quotedOfferId: offerId,
        responseDeadlineAt: new Date(),
        respondedAt: new Date(),
        clientDecisionAt: new Date()
      }
    });
    const contract = await prisma.consultancyContract.create({
      data: {
        requestId: request.id,
        providerId,
        clientId,
        offerId,
        status,
        paymentMethod: "CREDIT_CARD",
        paymentStatus: ConsultancyPaymentStatus.CAPTURED,
        paymentAmountCents: 20000,
        providerAmountCents: 18000,
        platformAmountCents: 2000,
        billingCycle: offer.billingCycle,
        kind: offer.kind,
        fichaValidityDays: offer.fichaValidityDays,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date()
      }
    });
    contractIds.push(contract.id);
    return contract;
  }

  it("contrato cancelado mantém as fichas visíveis (histórico), mas bloqueia nova conclusão", async () => {
    const offer = await makeOffer();
    const contract = await makeContract(offer.id);
    const { plan } = await consultancyService.deliverContract(providerUserId, contract.id, {
      title: "Ficha Histórico",
      exercises: []
    });

    await prisma.consultancyContract.update({
      where: { id: contract.id },
      data: { status: ConsultancyContractStatus.CANCELLED }
    });

    const myTraining = await consultancyService.getMyTraining(clientId);
    const foundContract = myTraining.contracts.find((c: any) => c.id === contract.id);
    expect(foundContract).toBeTruthy();
    expect(foundContract!.trainingPlans.some((p: any) => p.id === plan.id)).toBe(true);

    await expect(consultancyService.completeTrainingPlan(clientId, plan.id)).rejects.toThrow(/não está mais ativo/i);
  });

  it("updateTrainingPlan rejeita edição quando o contrato não está mais ativo", async () => {
    const offer = await makeOffer();
    const contract = await makeContract(offer.id);
    const { plan } = await consultancyService.deliverContract(providerUserId, contract.id, {
      title: "Ficha Editar",
      exercises: []
    });

    await prisma.consultancyContract.update({
      where: { id: contract.id },
      data: { status: ConsultancyContractStatus.CANCELLED }
    });

    await expect(
      consultancyService.updateTrainingPlan(providerUserId, plan.id, { title: "Tentativa de edição" })
    ).rejects.toThrow(/não está mais ativo/i);
  });

  it("updateTrainingPlan rejeita edição quando há contestação de entrega em aberto sobre a própria ficha", async () => {
    const offer = await makeOffer();
    const contract = await makeContract(offer.id);
    const { plan } = await consultancyService.deliverContract(providerUserId, contract.id, {
      title: "Ficha Contestada",
      exercises: []
    });
    await prisma.trainingPlan.updateMany({
      where: { id: plan.id },
      data: { createdAt: new Date(Date.now() - 60_000) }
    });
    await prisma.consultancyContract.update({
      where: { id: contract.id },
      data: { status: ConsultancyContractStatus.DELIVERED, deliveredAt: new Date(Date.now() - 60_000) }
    });

    await consultancyService.contestDelivery(clientId, contract.id, "Ficha vazia.");

    await expect(
      consultancyService.updateTrainingPlan(providerUserId, plan.id, { title: "Tentativa durante disputa" })
    ).rejects.toThrow(/contestação em aberto/i);
  });

  it("admin vê os exercícios completos da ficha ao julgar uma contestação de entrega", async () => {
    const offer = await makeOffer();
    const contract = await makeContract(offer.id);
    const { plan } = await consultancyService.deliverContract(providerUserId, contract.id, {
      title: "Ficha Com Exercicio",
      exercises: [{ name: "Agachamento", repetitionsSets: "3x10", load: "40kg" }]
    });
    await prisma.trainingPlan.updateMany({
      where: { id: plan.id },
      data: { createdAt: new Date(Date.now() - 60_000) }
    });
    await prisma.consultancyContract.update({
      where: { id: contract.id },
      data: { status: ConsultancyContractStatus.DELIVERED, deliveredAt: new Date(Date.now() - 60_000) }
    });

    const dispute = await consultancyService.contestDelivery(clientId, contract.id, "Ficha ruim.");

    const detail = await disputeCaseService.getCaseDetail(adminId, dispute.id);
    expect(detail.trainingPlan).not.toBeNull();
    expect(detail.trainingPlan!.exercises.length).toBe(1);
    expect(detail.trainingPlan!.exercises[0].name).toBe("Agachamento");
  });

  it("entregar renovação desativa a ficha anterior automaticamente", async () => {
    vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 3003, status: "approved" } as any);

    const offer = await makeOffer();
    const contract = await makeContract(offer.id);
    const { plan: firstPlan } = await consultancyService.deliverContract(providerUserId, contract.id, {
      title: "Ficha 1",
      exercises: []
    });
    await prisma.trainingPlan.updateMany({
      where: { contractId: contract.id },
      data: { createdAt: new Date(Date.now() - 15_000) }
    });

    await consultancyService.deliverContract(providerUserId, contract.id, {
      title: "Ficha 2 (renovação)",
      exercises: []
    });

    const oldPlan = await prisma.trainingPlan.findUniqueOrThrow({ where: { id: firstPlan.id } });
    expect(oldPlan.isActive).toBe(false);

    const activeCount = await prisma.trainingPlan.count({ where: { contractId: contract.id, isActive: true } });
    expect(activeCount).toBe(1);
  });
});
