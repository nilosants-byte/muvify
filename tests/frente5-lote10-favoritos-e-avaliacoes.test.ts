import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BookingStatus, UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { ReviewService } from "../src/modules/reviews/services/review.service";
import { FavoriteService } from "../src/modules/favorites/services/favorite.service";

// Épico de Frentes, Frente 5 (Descoberta, agendamento e agenda), Lote 10:
// (1) reviewService.listMine devolve paginação real (skip/take + total)
//     pro próprio profissional, não mais limitado às 10 mais recentes do
//     endpoint público de detalhe.
// (2) favoriteService.countFavoritedBy devolve quantos clientes
//     favoritaram o profissional — lacuna de produto sem endpoint algum.

const reviewService = new ReviewService();
const favoriteService = new FavoriteService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let providerUserId = "";
let providerId = "";
let categoryId = "";
const clientIds: string[] = [];
const reviewIds: string[] = [];

describe("Frente 5, Lote 10 — paginação real de avaliações e contagem de favoritos", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `F5L10_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Cinco Lote Dez",
        email: `${uid("f5l10_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}0`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Cinco Lote Dez",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    // 12 clientes: cria uma review de cada, pra ultrapassar o antigo
    // limite fixo de 10 e exercitar a paginação de verdade.
    for (let i = 0; i < 12; i++) {
      const client = await prisma.user.create({
        data: {
          name: `Cliente Frente Cinco Lote Dez ${i}`,
          email: `${uid(`f5l10_client_${i}`)}@test.com`,
          password: "x",
          phone: `11${Date.now().toString().slice(-9)}${i}`,
          role: UserRole.CLIENT
        }
      });
      clientIds.push(client.id);

      const booking = await prisma.booking.create({
        data: {
          clientId: client.id,
          providerId,
          categoryId,
          scheduledAt: new Date(Date.now() - (i + 1) * 60 * 60 * 1000),
          priceCents: 10000,
          status: BookingStatus.COMPLETED,
          completedAt: new Date()
        }
      });

      const review = await prisma.review.create({
        data: {
          bookingId: booking.id,
          userId: client.id,
          providerId,
          rating: 5,
          comment: `Review ${i}`
        }
      });
      reviewIds.push(review.id);
    }
  });

  afterAll(async () => {
    await prisma.review.deleteMany({ where: { id: { in: reviewIds } } });
    await prisma.booking.deleteMany({ where: { providerId } });
    await prisma.favorite.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [...clientIds, providerUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [...clientIds, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("listMine devolve total correto e pagina além das 10 primeiras", async () => {
    const firstPage = await reviewService.listMine(providerUserId, 0, 10);
    expect(firstPage.total).toBe(12);
    expect(firstPage.reviews).toHaveLength(10);

    const secondPage = await reviewService.listMine(providerUserId, 10, 10);
    expect(secondPage.reviews).toHaveLength(2);

    const firstPageIds = new Set(firstPage.reviews.map((r) => r.id));
    const secondPageIds = secondPage.reviews.map((r) => r.id);
    expect(secondPageIds.every((id) => !firstPageIds.has(id))).toBe(true);
  });

  it("countFavoritedBy reflete favoritar/desfavoritar em tempo real", async () => {
    const before = await favoriteService.countFavoritedBy(providerUserId);
    expect(before.count).toBe(0);

    await favoriteService.add(clientIds[0], providerId);
    await favoriteService.add(clientIds[1], providerId);

    const afterTwoAdds = await favoriteService.countFavoritedBy(providerUserId);
    expect(afterTwoAdds.count).toBe(2);

    await favoriteService.remove(clientIds[0], providerId);

    const afterOneRemove = await favoriteService.countFavoritedBy(providerUserId);
    expect(afterOneRemove.count).toBe(1);
  });
});
