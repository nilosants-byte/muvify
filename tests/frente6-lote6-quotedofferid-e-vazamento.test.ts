import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { OfferBillingCycle, PresentialPackageMode, ServiceOfferKind, UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";

// Épico de Frentes, Frente 6 (Ofertas do profissional), Lote 6:
// (1) quotedOfferId escolhido pelo cliente na solicitação de consultoria
//     passa a ser de fato usado (decisão do usuário) quando válido, e
//     ignorado (sem falhar a criação) quando inválido/de outro
//     profissional/inativo/não é oferta de consultoria.
// (2) createConsultancyRequest não vaza mpAccessToken/mpRefreshToken do
//     profissional na resposta pro cliente (mesmo achado do Lote 1,
//     ponto que tinha ficado de fora).

const consultancyService = new ConsultancyService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let providerUserId = "";
let providerId = "";
let otherProviderUserId = "";
let otherProviderId = "";
let clientId = "";
const offerIds: string[] = [];
const requestIds: string[] = [];

describe("Frente 6, Lote 6 — quotedOfferId escolhido pelo cliente e vazamento de dados", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Seis Lote Seis",
        email: `${uid("f6l6_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Seis Lote Seis",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        mpAccessToken: "SECRET_ACCESS_TOKEN_L6",
        mpRefreshToken: "SECRET_REFRESH_TOKEN_L6",
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    const otherProviderUser = await prisma.user.create({
      data: {
        name: "Outro Profissional Frente Seis Lote Seis",
        email: `${uid("f6l6_other_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: UserRole.PROVIDER
      }
    });
    otherProviderUserId = otherProviderUser.id;

    const otherProvider = await prisma.providerProfile.create({
      data: {
        userId: otherProviderUserId,
        displayName: "Outro Profissional Frente Seis Lote Seis",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "444555666",
        crefValidationStatus: "APPROVED"
      }
    });
    otherProviderId = otherProvider.id;

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Seis Lote Seis",
        email: `${uid("f6l6_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}3`,
        role: UserRole.CLIENT,
        emailVerifiedAt: new Date()
      }
    });
    clientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });

    await prisma.onlineConsultancySetting.upsert({
      where: { providerId },
      update: { enabled: true },
      create: { providerId, enabled: true }
    });
    await prisma.onlineConsultancySetting.upsert({
      where: { providerId: otherProviderId },
      update: { enabled: true },
      create: { providerId: otherProviderId, enabled: true }
    });
    // Oferta ativa "de sustentação" pra hasActiveOffer do outro profissional
    // — os testes que miram otherProviderId precisam disso, mas não usam
    // essa oferta especificamente como quotedOfferId.
    const otherProviderBaselineOffer = await prisma.providerServiceOffer.create({
      data: {
        providerId: otherProviderId,
        kind: ServiceOfferKind.ONLINE_CONSULTANCY,
        title: `Consultoria base ${uid("offer")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 20000
      }
    });
    offerIds.push(otherProviderBaselineOffer.id);
  });

  afterAll(async () => {
    await prisma.consultancyRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.onlineConsultancySetting.deleteMany({ where: { providerId } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: [providerId, otherProviderId] } } });
    await prisma.session.deleteMany({ where: { userId: { in: [providerUserId, otherProviderUserId, clientId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [providerUserId, otherProviderUserId, clientId] } } });
    await prisma.$disconnect();
  });

  it("quotedOfferId válido (do próprio profissional, ativo, consultoria) é gravado na solicitação e não vaza mpAccessToken/mpRefreshToken", async () => {
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

    const request: any = await consultancyService.createConsultancyRequest(clientId, {
      providerId,
      quotedOfferId: offer.id
    });
    requestIds.push(request.id);

    expect(request.quotedOfferId).toBe(offer.id);
    expect(request.provider).not.toHaveProperty("mpAccessToken");
    expect(request.provider).not.toHaveProperty("mpRefreshToken");
    expect(request.provider.displayName).toBe("Profissional Frente Seis Lote Seis");
  });

  it("quotedOfferId de uma oferta de OUTRO profissional é ignorado (não falha a criação, só não usa a oferta)", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId: otherProviderId,
        kind: ServiceOfferKind.ONLINE_CONSULTANCY,
        title: `Consultoria ${uid("offer")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 20000
      }
    });
    offerIds.push(offer.id);

    const request: any = await consultancyService.createConsultancyRequest(clientId, {
      providerId,
      quotedOfferId: offer.id
    });
    requestIds.push(request.id);

    expect(request.quotedOfferId).toBeNull();
  });

  it("quotedOfferId de uma oferta PRESENTIAL (não é consultoria) é ignorado", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId: otherProviderId,
        kind: ServiceOfferKind.PRESENTIAL,
        title: `Presencial ${uid("offer")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 15000
      }
    });
    offerIds.push(offer.id);

    const request: any = await consultancyService.createConsultancyRequest(clientId, {
      providerId: otherProviderId,
      quotedOfferId: offer.id
    });
    requestIds.push(request.id);

    expect(request.quotedOfferId).toBeNull();
  });

  it("sem quotedOfferId, a solicitação continua sendo criada normalmente (comportamento antigo preservado)", async () => {
    const request: any = await consultancyService.createConsultancyRequest(clientId, {
      providerId: otherProviderId
    });
    requestIds.push(request.id);

    expect(request.quotedOfferId).toBeNull();
    expect(request.status).toBe("OPEN");
  });
});
