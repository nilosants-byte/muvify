import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { OfferBillingCycle, ServiceOfferKind, UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";

// Épico de Frentes, Frente 6 (Ofertas do profissional), Lote 5:
// (1) decideRequest revalida oferta.isActive e CREF/suspensão do
//     profissional dentro da transação — se algo mudou entre a cotação
//     (respondToRequest) e o aceite do cliente, o pagamento é bloqueado.
// (2) getProviderCatalog de profissional suspenso retorna 404, igual
//     providersApi.detail já fazia.

const consultancyService = new ConsultancyService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let providerUserId = "";
let providerId = "";
let clientId = "";
const offerIds: string[] = [];
const requestIds: string[] = [];

async function createRespondedRequest() {
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
      status: "OPEN",
      responseDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000)
    }
  });
  requestIds.push(request.id);

  await consultancyService.respondToRequest(providerUserId, request.id, {
    providerResponseText: "Proposta enviada",
    quotedOfferId: offer.id
  });

  return { offer, requestId: request.id };
}

describe("Frente 6, Lote 5 — corrida entre desativação/suspensão e aceite do cliente", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Seis Lote Cinco",
        email: `${uid("f6l5_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Seis Lote Cinco",
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
        name: "Cliente Frente Seis Lote Cinco",
        email: `${uid("f6l5_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: UserRole.CLIENT,
        emailVerifiedAt: new Date()
      }
    });
    clientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });
  });

  afterAll(async () => {
    await prisma.consultancyContract.deleteMany({ where: { clientId } });
    await prisma.consultancyRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [providerUserId, clientId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [providerUserId, clientId] } } });
    await prisma.$disconnect();
  });

  it("decideRequest bloqueia o aceite se a oferta cotada foi desativada depois da resposta do profissional", async () => {
    const { offer, requestId } = await createRespondedRequest();

    await prisma.providerServiceOffer.update({ where: { id: offer.id }, data: { isActive: false } });

    await expect(
      consultancyService.decideRequest(clientId, requestId, {
        decision: "ACCEPT",
        acknowledgedImmediateExecution: true
      })
    ).rejects.toThrow(/não está mais disponível/i);
  });

  it("decideRequest bloqueia o aceite se o profissional foi suspenso depois da resposta", async () => {
    const { requestId } = await createRespondedRequest();

    await prisma.user.update({ where: { id: providerUserId }, data: { suspendedAt: new Date() } });

    await expect(
      consultancyService.decideRequest(clientId, requestId, {
        decision: "ACCEPT",
        acknowledgedImmediateExecution: true
      })
    ).rejects.toThrow(/profissional não está disponível/i);

    await prisma.user.update({ where: { id: providerUserId }, data: { suspendedAt: null } });
  });

  it("decideRequest bloqueia o aceite se o CREF do profissional for revogado depois da resposta (sem checagem prévia fora da transação)", async () => {
    const { requestId } = await createRespondedRequest();

    await prisma.providerProfile.update({ where: { id: providerId }, data: { crefValidationStatus: "REJECTED" } });

    await expect(
      consultancyService.decideRequest(clientId, requestId, {
        decision: "ACCEPT",
        acknowledgedImmediateExecution: true
      })
    ).rejects.toThrow(/profissional não está mais disponível/i);

    await prisma.providerProfile.update({ where: { id: providerId }, data: { crefValidationStatus: "APPROVED" } });
  });

  it("getProviderCatalog de profissional suspenso retorna 404 (mesmo comportamento de providersApi.detail)", async () => {
    await prisma.user.update({ where: { id: providerUserId }, data: { suspendedAt: new Date() } });

    await expect(consultancyService.getProviderCatalog(providerId)).rejects.toThrow(/não encontrado/i);

    await prisma.user.update({ where: { id: providerUserId }, data: { suspendedAt: null } });
  });
});
