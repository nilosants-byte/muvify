import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { OfferBillingCycle, ServiceOfferKind, UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";

// Épico de Frentes, Frente 6 (Ofertas do profissional), Lote 10: a checagem
// do cooldown de 30 dias pra alterar o preço base da oferta lia
// basePriceUpdatedAt fora de qualquer trava - duas edições de preço quase
// simultâneas na mesma oferta liam o mesmo valor "antigo" (cooldown já
// expirado), passavam as duas pela checagem, e as duas escreviam. Corrigido
// com um updateMany condicional (só efetiva a escrita se o
// basePriceUpdatedAt ainda permitir a troca no momento exato da escrita).

const consultancyService = new ConsultancyService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let categoryId = "";
let providerUserId = "";
let providerId = "";

const offerIds: string[] = [];

describe("Frente 6, Lote 10 — corrida no cooldown de preço da oferta", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `F6L10_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Seis Lote Dez",
        email: `${uid("f6l10_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Seis Lote Dez",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;
  });

  afterAll(async () => {
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: providerUserId } });
    await prisma.user.deleteMany({ where: { id: providerUserId } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("duas edições de preço quase simultâneas na mesma oferta não conseguem burlar o cooldown de 30 dias", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: ServiceOfferKind.ONLINE_CONSULTANCY,
        title: `Oferta ${uid("offer")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 10000,
        // Cooldown já expirado - a primeira troca de preço deveria ser permitida.
        basePriceUpdatedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
      }
    });
    offerIds.push(offer.id);

    const [resultA, resultB] = await Promise.allSettled([
      consultancyService.updateProviderOffer(providerUserId, offer.id, { priceCents: 15000 }),
      consultancyService.updateProviderOffer(providerUserId, offer.id, { priceCents: 20000 })
    ]);

    const fulfilled = [resultA, resultB].filter((r) => r.status === "fulfilled");
    const rejected = [resultA, resultB].filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/apenas uma vez a cada 30 dias/i);

    const finalOffer = await prisma.providerServiceOffer.findUniqueOrThrow({ where: { id: offer.id } });
    // O preço final deve ser exatamente o da chamada que de fato foi aceita,
    // e basePriceUpdatedAt deve ter sido atualizado só uma vez (por essa
    // chamada), nunca pelas duas.
    const acceptedPrice = (fulfilled[0] as PromiseFulfilledResult<{ priceCents: number }>).value.priceCents;
    expect(finalOffer.priceCents).toBe(acceptedPrice);
    expect(finalOffer.basePriceUpdatedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);

    // Uma terceira tentativa, agora que o cooldown acabou de ser reiniciado,
    // também deve ser bloqueada.
    await expect(
      consultancyService.updateProviderOffer(providerUserId, offer.id, { priceCents: 25000 })
    ).rejects.toThrow(/apenas uma vez a cada 30 dias/i);
  });
});
