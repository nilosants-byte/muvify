import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ConsultancyContractStatus, ConsultancyPaymentStatus, ConsultancyRequestStatus, OfferBillingCycle, ServiceOfferKind, UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";

// Épico de Frentes, Frente 6 (Ofertas do profissional), Lote 4:
// (1) excluir oferta com venda histórica retorna mensagem clara sugerindo
//     desativação, em vez do erro genérico de FK.
// (2) excluir oferta com solicitação RESPONDED pendente é bloqueado.
// (3) desativar oferta (isActive: false) funciona sem afetar contratos ativos.
// (4) criar oferta COMBO sem presentialPackageMode/valores de partição é
//     rejeitado no schema/serviço.

const consultancyService = new ConsultancyService();

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

describe("Frente 6, Lote 4 — exclusão/desativação de oferta", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `F6L4_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Seis Lote Quatro",
        email: `${uid("f6l4_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Seis Lote Quatro",
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
        name: "Cliente Frente Seis Lote Quatro",
        email: `${uid("f6l4_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: UserRole.CLIENT
      }
    });
    clientId = client.id;
  });

  afterAll(async () => {
    await prisma.consultancyContract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [providerUserId, clientId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [providerUserId, clientId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("excluir oferta com venda histórica retorna mensagem clara sugerindo desativação, não o erro genérico de FK", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: ServiceOfferKind.ONLINE_CONSULTANCY,
        title: `Consultoria ${uid("offer")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 20000
      }
    });
    offerIds.push(offer.id);

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
    requestIds.push(request.id);

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
        billingCycle: OfferBillingCycle.MONTHLY,
        kind: ServiceOfferKind.ONLINE_CONSULTANCY,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date()
      }
    });
    contractIds.push(contract.id);

    await expect(consultancyService.deleteProviderOffer(providerUserId, offer.id)).rejects.toThrow(
      /já tem vendas registradas.*desative/i
    );
  });

  it("excluir oferta com solicitação RESPONDED pendente é bloqueado", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: ServiceOfferKind.ONLINE_CONSULTANCY,
        title: `Consultoria ${uid("offer")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 20000
      }
    });
    offerIds.push(offer.id);

    const request = await prisma.consultancyRequest.create({
      data: {
        providerId,
        clientId,
        status: ConsultancyRequestStatus.RESPONDED,
        quotedOfferId: offer.id,
        responseDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        respondedAt: new Date()
      }
    });
    requestIds.push(request.id);

    await expect(consultancyService.deleteProviderOffer(providerUserId, offer.id)).rejects.toThrow(
      /aguardando decisão/i
    );
  });

  it("desativar oferta (isActive: false) funciona e não afeta contrato ativo existente", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: ServiceOfferKind.ONLINE_CONSULTANCY,
        title: `Consultoria ${uid("offer")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 20000
      }
    });
    offerIds.push(offer.id);

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
    requestIds.push(request.id);

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
        billingCycle: OfferBillingCycle.MONTHLY,
        kind: ServiceOfferKind.ONLINE_CONSULTANCY,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date()
      }
    });
    contractIds.push(contract.id);

    const updated = await consultancyService.updateProviderOffer(providerUserId, offer.id, { isActive: false });
    expect(updated.isActive).toBe(false);

    const contractAfter = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(contractAfter.status).toBe(ConsultancyContractStatus.ACTIVE);
  });

  it("criar oferta COMBO sem presentialPackageMode/valores de partição é rejeitado", async () => {
    await expect(
      consultancyService.createProviderOffer(providerUserId, {
        kind: ServiceOfferKind.COMBO,
        title: `Combo ${uid("offer")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 50000,
        comboPresentialDaysPerWeek: 2,
        comboOnlineDaysPerWeek: 3
      } as any)
    ).rejects.toThrow(/modo do pacote presencial/i);
  });
});
