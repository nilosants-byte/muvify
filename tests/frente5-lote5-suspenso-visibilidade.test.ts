import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { UserRole } from "@prisma/client";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { FavoriteService } from "../src/modules/favorites/services/favorite.service";
import { ProviderService } from "../src/modules/providers/services/provider.service";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";

// Épico de Frentes, Frente 5 (Descoberta, agendamento e agenda), Lote 5:
// profissional suspenso não pode mais ser favoritado, some da lista de
// favoritos de quem já o tinha favoritado, some do acesso direto ao perfil
// (getById) e some da vitrine de destaques/promoções — mesmo filtro
// (user.suspendedAt: null) já usado na busca pública.

const favoriteService = new FavoriteService();
const providerService = new ProviderService();
const consultancyService = new ConsultancyService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
let offerId = "";

describe("Frente 5, Lote 5 — profissional suspenso some de favoritos, perfil e destaques", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `F5L5_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Cinco Lote Cinco",
        email: `${uid("f5l5_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.CLIENT
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Cinco Lote Cinco",
        email: `${uid("f5l5_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Cinco Lote Cinco",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "COMBO",
        title: `Combo Frente 5 Lote 5 ${uid("offer")}`,
        billingCycle: "MONTHLY",
        priceCents: 20000,
        isActive: true
      }
    });
    offerId = offer.id;

    await favoriteService.add(clientId, providerId);
  });

  afterAll(async () => {
    await prisma.favorite.deleteMany({ where: { providerId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: offerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [clientId, providerUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("com o profissional ativo: aparece nos favoritos, no getById e na vitrine de destaques", async () => {
    const favorites = await favoriteService.list(clientId);
    expect(favorites.some((f) => f.providerId === providerId)).toBe(true);

    const detail = await providerService.getById(providerId);
    expect(detail.id).toBe(providerId);

    const promotions = await consultancyService.listPromotions();
    expect(promotions.some((o: any) => o.offerId === offerId)).toBe(true);
  });

  it("suspender o profissional faz ele sumir dos favoritos, do getById e da vitrine de destaques", async () => {
    await prisma.user.update({ where: { id: providerUserId }, data: { suspendedAt: new Date(), suspensionReason: "teste" } });

    const favorites = await favoriteService.list(clientId);
    expect(favorites.some((f) => f.providerId === providerId)).toBe(false);

    await expect(providerService.getById(providerId)).rejects.toThrow(/não encontrado/i);

    const res = await request(app).get(`/api/providers/${providerId}`);
    expect(res.status).toBe(404);

    const promotions = await consultancyService.listPromotions();
    expect(promotions.some((o: any) => o.id === offerId)).toBe(false);

    await expect(favoriteService.add(clientId, providerId)).rejects.toThrow(/nao disponivel/i);

    await prisma.user.update({ where: { id: providerUserId }, data: { suspendedAt: null, suspensionReason: null } });
  });
});
