import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { ProviderService } from "../src/modules/providers/services/provider.service";

// Achado em teste manual (2026-10-09): a tela de Especialidades não aplicava
// nenhum filtro/ordenação geográfica — um cliente no Nordeste via resultado
// de profissional no Sudeste sem nenhum aviso. Em vez de forçar geolocalização
// ali, o cliente ganhou controle na própria tela de resultados: ordenar por
// avaliação ou proximidade, e filtrar por "só quem oferece consultoria
// online" (modalidade que não depende de distância).

const providerService = new ProviderService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

const marker = `PSEARCH_${Date.now()}`;
let nearLowRatedId = "";
let farHighRatedId = "";
let onlineOnlyId = "";
let noOfferId = "";
let inactiveOfferOnlyId = "";
let toggleDisabledId = "";
const userIds: string[] = [];
const providerIds: string[] = [];

// Av. Paulista, São Paulo — ponto de referência do "cliente" nos testes de distância.
const CLIENT_LAT = -23.5614;
const CLIENT_LNG = -46.6559;

async function makeProvider(opts: {
  suffix: string;
  rating: number;
  lat?: number;
  lng?: number;
}) {
  const user = await prisma.user.create({
    data: {
      name: `${marker} ${opts.suffix}`,
      email: `${uid("psearch")}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}`,
      role: UserRole.PROVIDER
    }
  });
  userIds.push(user.id);

  const provider = await prisma.providerProfile.create({
    data: {
      userId: user.id,
      displayName: `${marker} ${opts.suffix}`,
      bio: "test",
      experienceYears: 3,
      priceCents: 10000,
      mpAccountId: `mp_${uid("acc")}`,
      crefValidationStatus: "APPROVED",
      averageRating: opts.rating,
      totalReviews: 10,
      latitude: opts.lat,
      longitude: opts.lng
    }
  });
  providerIds.push(provider.id);
  return provider.id;
}

describe("Busca de profissionais — ordenar por avaliação/proximidade e filtrar consultoria online", () => {
  beforeAll(async () => {
    await prisma.$connect();

    nearLowRatedId = await makeProvider({ suffix: "perto nota baixa", rating: 3, lat: CLIENT_LAT + 0.01, lng: CLIENT_LNG });
    farHighRatedId = await makeProvider({ suffix: "longe nota alta", rating: 5, lat: CLIENT_LAT + 1, lng: CLIENT_LNG });

    onlineOnlyId = await makeProvider({ suffix: "com consultoria online", rating: 4 });
    await prisma.onlineConsultancySetting.create({ data: { providerId: onlineOnlyId, enabled: true } });
    await prisma.providerServiceOffer.create({
      data: {
        providerId: onlineOnlyId,
        kind: "ONLINE_CONSULTANCY",
        title: "Consultoria online",
        billingCycle: "MONTHLY",
        priceCents: 20000,
        isActive: true
      }
    });
    // Segunda oferta mais barata (com promoção) pra confirmar que o preço
    // exibido no card é o MENOR entre as ofertas ativas, já considerando
    // promoção vigente.
    await prisma.providerServiceOffer.create({
      data: {
        providerId: onlineOnlyId,
        kind: "ONLINE_CONSULTANCY_SPECIALIZED",
        title: "Consultoria especializada em promoção",
        billingCycle: "MONTHLY",
        priceCents: 18000,
        isPromotion: true,
        promotionPriceCents: 12000,
        promotionEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        isActive: true
      }
    });

    noOfferId = await makeProvider({ suffix: "sem nenhuma oferta", rating: 4 });

    inactiveOfferOnlyId = await makeProvider({ suffix: "oferta online inativa", rating: 4 });
    await prisma.onlineConsultancySetting.create({ data: { providerId: inactiveOfferOnlyId, enabled: true } });
    await prisma.providerServiceOffer.create({
      data: {
        providerId: inactiveOfferOnlyId,
        kind: "ONLINE_CONSULTANCY",
        title: "Consultoria online desativada",
        billingCycle: "MONTHLY",
        priceCents: 20000,
        isActive: false
      }
    });

    // Achado em teste manual (2026-10-11): oferta ativa não basta - o
    // profissional também precisa ter o toggle "aceitando consultoria
    // online agora" ligado (OnlineConsultancySetting.enabled).
    toggleDisabledId = await makeProvider({ suffix: "toggle de consultoria desligado", rating: 4 });
    await prisma.providerServiceOffer.create({
      data: {
        providerId: toggleDisabledId,
        kind: "ONLINE_CONSULTANCY",
        title: "Consultoria online (toggle desligado)",
        billingCycle: "MONTHLY",
        priceCents: 20000,
        isActive: true
      }
    });
  });

  afterAll(async () => {
    await prisma.providerServiceOffer.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("sortBy 'distance' (padrão com geo) prioriza quem está mais perto, mesmo com nota menor", async () => {
    const results = await providerService.search({
      q: marker,
      lat: CLIENT_LAT,
      lng: CLIENT_LNG,
      maxDistanceKm: 200
    } as any);
    const ids = results.map((p: any) => p.id);
    expect(ids.indexOf(nearLowRatedId)).toBeLessThan(ids.indexOf(farHighRatedId));
  });

  it("sortBy 'rating' prioriza quem tem nota maior, mesmo estando mais longe", async () => {
    const results = await providerService.search({
      q: marker,
      lat: CLIENT_LAT,
      lng: CLIENT_LNG,
      maxDistanceKm: 200,
      sortBy: "rating"
    } as any);
    const ids = results.map((p: any) => p.id);
    expect(ids.indexOf(farHighRatedId)).toBeLessThan(ids.indexOf(nearLowRatedId));
  });

  it("onlineConsultancyOnly inclui só quem tem oferta ATIVA e o toggle de consultoria LIGADO", async () => {
    const results = await providerService.search({ q: marker, onlineConsultancyOnly: true } as any);
    const ids = results.map((p: any) => p.id);
    expect(ids).toContain(onlineOnlyId);
    expect(ids).not.toContain(noOfferId);
    expect(ids).not.toContain(inactiveOfferOnlyId);
    expect(ids).not.toContain(toggleDisabledId);
  });

  it("sem o filtro, todo mundo aparece normalmente (inclusive quem não tem consultoria online)", async () => {
    const results = await providerService.search({ q: marker } as any);
    const ids = results.map((p: any) => p.id);
    expect(ids).toContain(onlineOnlyId);
    expect(ids).toContain(noOfferId);
  });

  it("onlineConsultancyFromCents expõe o MENOR preço ativo (considerando promoção), e null pra quem não oferece ou não tem o toggle ligado", async () => {
    const results = await providerService.search({ q: marker } as any);
    const online = results.find((p: any) => p.id === onlineOnlyId) as any;
    const noOffer = results.find((p: any) => p.id === noOfferId) as any;
    const inactiveOnly = results.find((p: any) => p.id === inactiveOfferOnlyId) as any;
    const toggleDisabled = results.find((p: any) => p.id === toggleDisabledId) as any;
    expect(online.onlineConsultancyFromCents).toBe(12000);
    expect(noOffer.onlineConsultancyFromCents).toBeNull();
    expect(inactiveOnly.onlineConsultancyFromCents).toBeNull();
    expect(toggleDisabled.onlineConsultancyFromCents).toBeNull();
  });

  it("getById (perfil completo) também expõe onlineConsultancyFromCents", async () => {
    const detail = await providerService.getById(onlineOnlyId) as any;
    expect(detail.onlineConsultancyFromCents).toBe(12000);
  });
});
