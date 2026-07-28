import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { Payment, CardToken } from "mercadopago";
import { ConsultancyContractStatus, ConsultancyPaymentStatus, ConsultancyRequestStatus } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Raio-X de pagamentos (27/07/2026) — Lote 4: renovação de ficha justa e
// transparente. Cobre: contestação por renovação específica (não só a
// primeira ficha), guarda contra duplo clique na entrega, escalonamento e
// encerramento automático de ficha vencida sem ação de nenhum lado, e
// expiração de Pix travado na aceitação da consultoria.

const consultancyService = new ConsultancyService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const offerIds: string[] = [];
const contractIds: string[] = [];

describe("Renovação de ficha justa e transparente (Lote 4 do raio-x)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `FR_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Ficha Renewal Client",
        email: `${uid("fr_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        mpCustomerId: "cus_test_fr"
      }
    });
    clientId = client.id;

    await prisma.customerPaymentMethod.create({
      data: {
        userId: clientId,
        mpCustomerId: "cus_test_fr",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });

    const providerUser = await prisma.user.create({
      data: {
        name: "Ficha Renewal Provider",
        email: `${uid("fr_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Ficha Renewal Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 15000,
        mpAccountId: "555444333",
        mpAccessToken: encryptSensitiveText("fake_access_token"),
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
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

  async function makeOfferWithFichaValidity(days: number) {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "ONLINE_CONSULTANCY",
        title: `Consultoria ${uid("offer")}`,
        billingCycle: "MONTHLY",
        priceCents: 20000,
        fichaValidityDays: days
      }
    });
    offerIds.push(offer.id);
    return offer;
  }

  async function makeActiveContract(offerId: string) {
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
        status: ConsultancyContractStatus.ACTIVE,
        paymentMethod: "CREDIT_CARD",
        paymentStatus: ConsultancyPaymentStatus.CAPTURED,
        paymentAmountCents: 20000,
        providerAmountCents: 18000,
        platformAmountCents: 2000,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date()
      }
    });
    contractIds.push(contract.id);
    return contract;
  }

  it("duas entregas de renovação disparadas ao mesmo tempo pro mesmo contrato: só uma vence, a outra é rejeitada (sem duplicar ficha nem cobrança)", async () => {
    vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 1001, status: "approved" } as any);

    const offer = await makeOfferWithFichaValidity(30);
    const contract = await makeActiveContract(offer.id);

    await consultancyService.deliverContract(providerUserId, contract.id, {
      title: "Ficha 1",
      exercises: []
    });
    await prisma.trainingPlan.updateMany({
      where: { contractId: contract.id },
      data: { createdAt: new Date(Date.now() - 15_000) }
    });

    // Duas requisições de renovação disparadas sem esperar uma pela outra —
    // simula duplo clique / retry de rede quase simultâneo.
    const [r1, r2] = await Promise.allSettled([
      consultancyService.deliverContract(providerUserId, contract.id, { title: "Ficha 2a", exercises: [] }),
      consultancyService.deliverContract(providerUserId, contract.id, { title: "Ficha 2b", exercises: [] })
    ]);

    const statuses = [r1.status, r2.status];
    expect(statuses.filter((s) => s === "fulfilled")).toHaveLength(1);
    expect(statuses.filter((s) => s === "rejected")).toHaveLength(1);

    const plansCount = await prisma.trainingPlan.count({ where: { contractId: contract.id } });
    expect(plansCount).toBe(2);
  });

  it("renovação salva o mpPaymentId da própria cobrança na ficha (não reaproveita o da primeira)", async () => {
    // A 1a entrega não chama a MP (a cobrança original já foi feita na
    // aceitação da proposta; o fixture já cria o contrato com paymentStatus
    // CAPTURED). Só a renovação (2a ficha em diante) cobra de verdade.
    vi.spyOn(Payment.prototype, "create").mockResolvedValueOnce({ id: 2002, status: "approved" } as any);

    const offer = await makeOfferWithFichaValidity(30);
    const contract = await makeActiveContract(offer.id);

    await consultancyService.deliverContract(providerUserId, contract.id, { title: "Ficha 1", exercises: [] });

    // Recua o createdAt da 1a ficha pra fora da janela de 10s do guard
    // contra duplo clique, simulando uma renovação de verdade (não um clique
    // duplicado do mesmo evento).
    await prisma.trainingPlan.updateMany({
      where: { contractId: contract.id },
      data: { createdAt: new Date(Date.now() - 15_000) }
    });

    const renewalResult = await consultancyService.deliverContract(providerUserId, contract.id, {
      title: "Ficha 2 (renovação)",
      exercises: []
    });

    const savedPlan = await prisma.trainingPlan.findUniqueOrThrow({ where: { id: (renewalResult as any).plan.id } });
    expect(savedPlan.renewalMpPaymentId).toBe("2002");
  });

  it("contestar a renovação mais recente funciona mesmo já tendo contestado uma ficha anterior", async () => {
    // A 1a entrega não chama a MP (contrato já criado com paymentStatus
    // CAPTURED no fixture) — só a renovação (ficha 2) cobra de verdade.
    const offer = await makeOfferWithFichaValidity(30);
    const contract = await makeActiveContract(offer.id);

    await consultancyService.deliverContract(providerUserId, contract.id, { title: "Ficha 1", exercises: [] });
    const disputeOnFicha1 = await consultancyService.contestDelivery(clientId, contract.id, "Ficha 1 estava ruim");

    // Duplo clique bloquearia a 2a ficha se entregue nos primeiros 10s — força
    // o relógio pra frente ajustando createdAt da 1a ficha manualmente.
    await prisma.trainingPlan.updateMany({
      where: { contractId: contract.id },
      data: { createdAt: new Date(Date.now() - 15_000) }
    });

    // Raio-X Rodada 2, Lote 4: entregar (e cobrar) a próxima ficha enquanto a
    // contestação da ficha mais recente ainda está em aberto passou a ser
    // bloqueado — resolve a disputa da ficha 1 antes de entregar a ficha 2,
    // simulando o admin já ter julgado o caso.
    await prisma.disputeCase.update({
      where: { id: disputeOnFicha1.id },
      data: { status: "RESOLVED", resolution: "DENIED", resolutionNote: "Julgado improcedente.", resolvedAt: new Date() }
    });

    vi.spyOn(Payment.prototype, "create").mockResolvedValueOnce({ id: 3002, status: "approved" } as any);
    await consultancyService.deliverContract(providerUserId, contract.id, { title: "Ficha 2", exercises: [] });

    // Contestar a ficha 2 (mais recente) deve funcionar, mesmo já existindo
    // uma disputa DELIVERY_CONTESTED pra ficha 1 nesse mesmo contrato.
    const dispute = await consultancyService.contestDelivery(clientId, contract.id, "Ficha 2 também veio ruim");
    expect(dispute.type).toBe("DELIVERY_CONTESTED");
    expect(dispute.mpPaymentId).toBe("3002");

    const disputesCount = await prisma.disputeCase.count({
      where: { consultancyContractId: contract.id, type: "DELIVERY_CONTESTED" }
    });
    expect(disputesCount).toBe(2);
  });

  it("escalateExpiredFichaContracts avisa quando a ficha vence sem ação e encerra automaticamente após 7 dias", async () => {
    const offer = await makeOfferWithFichaValidity(10);
    const contractEscalating = await makeActiveContract(offer.id);
    await prisma.consultancyContract.update({
      where: { id: contractEscalating.id },
      data: { status: ConsultancyContractStatus.DELIVERED, deliveredAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) }
    });
    await prisma.trainingPlan.create({
      data: {
        providerId,
        contractId: contractEscalating.id,
        title: "Ficha vencida há 3 dias",
        isPrebuilt: false,
        isActive: true,
        createdAt: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000),
        validUntil: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        expiredNoticeSentAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      }
    });

    const contractToCancel = await makeActiveContract(offer.id);
    await prisma.consultancyContract.update({
      where: { id: contractToCancel.id },
      data: { status: ConsultancyContractStatus.DELIVERED, deliveredAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) }
    });
    await prisma.trainingPlan.create({
      data: {
        providerId,
        contractId: contractToCancel.id,
        title: "Ficha vencida há 8 dias",
        isPrebuilt: false,
        isActive: true,
        createdAt: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000),
        validUntil: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        expiredNoticeSentAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
      }
    });

    await consultancyService.escalateExpiredFichaContracts();

    const afterEscalating = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contractEscalating.id } });
    expect(afterEscalating.status).toBe(ConsultancyContractStatus.DELIVERED);
    const escalatingPlan = await prisma.trainingPlan.findFirstOrThrow({ where: { contractId: contractEscalating.id } });
    expect(escalatingPlan.lastEscalationSentAt).not.toBeNull();

    const afterCancel = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contractToCancel.id } });
    expect(afterCancel.status).toBe(ConsultancyContractStatus.CANCELLED);
  });

  it("expireStalePendingPixConsultancyContracts marca Pix travado como falho e devolve o request pra RESPONDED (permite tentar de novo)", async () => {
    const offer = await makeOfferWithFichaValidity(30);
    const request = await prisma.consultancyRequest.create({
      data: {
        providerId,
        clientId,
        status: ConsultancyRequestStatus.ACCEPTED,
        quotedOfferId: offer.id,
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
        offerId: offer.id,
        status: ConsultancyContractStatus.PENDING_PAYMENT,
        paymentMethod: "PIX",
        paymentStatus: ConsultancyPaymentStatus.PENDING,
        paymentAmountCents: 20000,
        providerAmountCents: 18000,
        platformAmountCents: 2000,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date(),
        createdAt: new Date(Date.now() - 27 * 60 * 60 * 1000)
      }
    });
    contractIds.push(contract.id);

    await consultancyService.expireStalePendingPixConsultancyContracts();

    const afterContract = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(afterContract.paymentStatus).toBe(ConsultancyPaymentStatus.FAILED);

    const afterRequest = await prisma.consultancyRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(afterRequest.status).toBe(ConsultancyRequestStatus.RESPONDED);
  });
});
