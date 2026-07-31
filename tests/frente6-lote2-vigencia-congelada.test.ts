import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ConsultancyContractStatus, ConsultancyPaymentStatus, OfferBillingCycle, ServiceOfferKind, UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { ProviderService } from "../src/modules/providers/services/provider.service";
import { consultancyValidUntil } from "../src/shared/utils/consultancy-validity";

// Épico de Frentes, Frente 6 (Ofertas do profissional), Lote 2:
// (1) billingCycle/kind/fichaValidityDays da oferta são congelados no
//     contrato na hora da compra — editar a oferta depois não muda mais
//     retroativamente a vigência/categorização de contratos já ativos.
// (2) contrato no modelo de renovação por ficha (fichaValidityDays
//     configurado) não é marcado "vencido" por billingCycle — fica
//     vigente enquanto status/pagamento estiverem em dia.
// (3) job de auto-cancelamento de ficha vencida continua funcionando
//     mesmo se fichaValidityDays for zerado na oferta depois da venda.

const consultancyService = new ConsultancyService();
const providerService = new ProviderService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let categoryId = "";
let providerUserId = "";
let providerId = "";
let clientId = "";

const offerIds: string[] = [];
const requestIds: string[] = [];
const contractIds: string[] = [];

describe("Frente 6, Lote 2 — vigência/config do contrato congelada na compra", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `F6L2_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Seis Lote Dois",
        email: `${uid("f6l2_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Seis Lote Dois",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Seis Lote Dois",
        email: `${uid("f6l2_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: UserRole.CLIENT
      }
    });
    clientId = client.id;
  });

  afterAll(async () => {
    await prisma.trainingPlan.deleteMany({ where: { providerId } });
    await prisma.consultancyContract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [providerUserId, clientId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [providerUserId, clientId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  async function makeContract(offerData: {
    kind: ServiceOfferKind;
    billingCycle: OfferBillingCycle;
    fichaValidityDays?: number | null;
  }) {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: offerData.kind,
        title: `Oferta ${uid("offer")}`,
        billingCycle: offerData.billingCycle,
        priceCents: 20000,
        fichaValidityDays: offerData.fichaValidityDays ?? null
      }
    });
    offerIds.push(offer.id);

    const request = await prisma.consultancyRequest.create({
      data: {
        providerId,
        clientId,
        status: "ACCEPTED",
        quotedOfferId: offer.id,
        responseDeadlineAt: new Date(),
        respondedAt: new Date(),
        clientDecisionAt: new Date()
      }
    });
    requestIds.push(request.id);

    // Snapshot congelado exatamente como decideRequest faz na hora da compra.
    const contract = await prisma.consultancyContract.create({
      data: {
        requestId: request.id,
        providerId,
        clientId,
        offerId: offer.id,
        status: ConsultancyContractStatus.ACTIVE,
        paymentStatus: ConsultancyPaymentStatus.CAPTURED,
        paymentAmountCents: 20000,
        providerAmountCents: 18000,
        platformAmountCents: 2000,
        billingCycle: offer.billingCycle,
        kind: offer.kind,
        fichaValidityDays: offer.fichaValidityDays,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date(),
        paymentCapturedAt: new Date()
      }
    });
    contractIds.push(contract.id);
    return { offer, contract };
  }

  it("editar billingCycle/kind da oferta depois da venda não muda a vigência/categorização de um contrato já ativo", async () => {
    const { offer, contract } = await makeContract({
      kind: ServiceOfferKind.ONLINE_CONSULTANCY,
      billingCycle: OfferBillingCycle.ANNUAL
    });

    const validUntilBefore = consultancyValidUntil(contract);

    // Profissional edita a oferta depois da venda: ciclo mensal, tipo diferente.
    await prisma.providerServiceOffer.update({
      where: { id: offer.id },
      data: { billingCycle: OfferBillingCycle.MONTHLY, kind: ServiceOfferKind.ONLINE_CONSULTANCY_SPECIALIZED }
    });

    const contractAfterOfferEdit = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(contractAfterOfferEdit.billingCycle).toBe(OfferBillingCycle.ANNUAL);
    expect(contractAfterOfferEdit.kind).toBe(ServiceOfferKind.ONLINE_CONSULTANCY);

    const validUntilAfter = consultancyValidUntil(contractAfterOfferEdit);
    expect(validUntilAfter.getTime()).toBe(validUntilBefore.getTime());
  });

  it("contrato de renovação por ficha (fichaValidityDays configurado) não é marcado vencido por billingCycle na tela de gestão de alunos", async () => {
    const { contract } = await makeContract({
      kind: ServiceOfferKind.ONLINE_CONSULTANCY,
      billingCycle: OfferBillingCycle.DAILY,
      fichaValidityDays: 30
    });
    // paymentCapturedAt já é "agora" no fixture — com billingCycle DAILY,
    // a vigência ao vivo já teria vencido (ou vence quase imediatamente).
    await prisma.consultancyContract.update({
      where: { id: contract.id },
      data: { paymentCapturedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) }
    });

    const detail = await providerService.getStudentManagementDetail(providerUserId, clientId);
    const found = detail.consultancyContracts.find((c: any) => c.id === contract.id) as any;
    expect(found).toBeTruthy();
    expect(found.isVigente).toBe(true);
    expect(found.validUntil).toBeNull();
  });

  it("contrato sem fichaValidityDays (modelo clássico) continua usando a vigência por billingCycle normalmente", async () => {
    const { contract } = await makeContract({
      kind: ServiceOfferKind.ONLINE_CONSULTANCY,
      billingCycle: OfferBillingCycle.MONTHLY
    });
    // Captura há 40 dias — vigência mensal (30 dias) já venceu.
    await prisma.consultancyContract.update({
      where: { id: contract.id },
      data: { paymentCapturedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) }
    });

    const detail = await providerService.getStudentManagementDetail(providerUserId, clientId);
    const found = detail.consultancyContracts.find((c: any) => c.id === contract.id) as any;
    expect(found).toBeTruthy();
    expect(found.isVigente).toBe(false);
    expect(found.validUntil).not.toBeNull();
  });

  it("escalateExpiredFichaContracts continua funcionando mesmo se fichaValidityDays for zerado na oferta depois da venda", async () => {
    const { offer, contract } = await makeContract({
      kind: ServiceOfferKind.ONLINE_CONSULTANCY,
      billingCycle: OfferBillingCycle.MONTHLY,
      fichaValidityDays: 7
    });

    await consultancyService.deliverContract(providerUserId, contract.id, { title: "Ficha 1", exercises: [] });

    const plan = await prisma.trainingPlan.findFirstOrThrow({ where: { contractId: contract.id } });
    await prisma.trainingPlan.update({
      where: { id: plan.id },
      data: {
        validUntil: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        expiredNoticeSentAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
      }
    });

    // Profissional zera fichaValidityDays na oferta depois da venda — o job
    // não pode passar a ignorar esse contrato por causa disso (lê o valor
    // congelado no próprio contrato, não mais o da oferta ao vivo).
    await prisma.providerServiceOffer.update({ where: { id: offer.id }, data: { fichaValidityDays: null } });

    await consultancyService.escalateExpiredFichaContracts();

    const contractAfter = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(contractAfter.status).toBe(ConsultancyContractStatus.CANCELLED);
  });
});
