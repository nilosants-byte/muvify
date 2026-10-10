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

    noOfferId = await makeProvider({ suffix: "sem nenhuma oferta", rating: 4 });

    inactiveOfferOnlyId = await makeProvider({ suffix: "oferta online inativa", rating: 4 });
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

  it("onlineConsultancyOnly inclui só quem tem oferta de consultoria online ATIVA", async () => {
    const results = await providerService.search({ q: marker, onlineConsultancyOnly: true } as any);
    const ids = results.map((p: any) => p.id);
    expect(ids).toContain(onlineOnlyId);
    expect(ids).not.toContain(noOfferId);
    expect(ids).not.toContain(inactiveOfferOnlyId);
  });

  it("sem o filtro, todo mundo aparece normalmente (inclusive quem não tem consultoria online)", async () => {
    const results = await providerService.search({ q: marker } as any);
    const ids = results.map((p: any) => p.id);
    expect(ids).toContain(onlineOnlyId);
    expect(ids).toContain(noOfferId);
  });
});
