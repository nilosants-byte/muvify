import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ProviderSubscriptionStatus, WaitlistAudience } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { ProviderService } from "../src/modules/providers/services/provider.service";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { FavoriteService } from "../src/modules/favorites/services/favorite.service";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Bloco 7 (programa 100 Fundadores): só o selo visual público — a checagem
// de elegibilidade de fundador em si já foi feita no Bloco 5
// (matchFounderSlot, na criação do perfil). Aqui só confirma que
// `isFounder` sai pro cliente nos lugares certos, e que o resto de
// ProviderSubscription (status de cobrança) nunca vaza pro perfil público.

const providerService = new ProviderService();
const consultancyService = new ConsultancyService();
const favoriteService = new FavoriteService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function makeProvider(label: string, isFounder: boolean) {
  const user = await prisma.user.create({
    data: {
      name: `Badge ${label} Provider`,
      email: `${uid(`badge_${label}_prov`)}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}`,
      role: "PROVIDER"
    }
  });
  const displayName = `${uid(`Badge_${label}`)}_Provider`;
  const profile = await prisma.providerProfile.create({
    data: {
      userId: user.id,
      displayName,
      bio: "test",
      experienceYears: 3,
      priceCents: 15000,
      mpAccountId: `${Math.floor(Math.random() * 1_000_000_000)}`,
      mpAccessToken: encryptSensitiveText("fake_access_token"),
      crefValidationStatus: "APPROVED"
    }
  });
  await prisma.providerSubscription.create({
    data: { providerId: profile.id, status: ProviderSubscriptionStatus.ACTIVE, isFounder }
  });
  return { userId: user.id, providerId: profile.id, displayName };
}

const userIdsToCleanup = new Set<string>();
const providerProfileIdsToCleanup = new Set<string>();

describe("Bloco 7 — selo de fundador no perfil público", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    const userIds = Array.from(userIdsToCleanup);
    const providerIds = Array.from(providerProfileIdsToCleanup);
    await prisma.favorite.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.providerSubscription.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("getById expõe isFounder=true pro fundador e nunca vaza subscription.status", async () => {
    const founder = await makeProvider("getbyid_founder", true);
    providerProfileIdsToCleanup.add(founder.providerId);

    const result = await providerService.getById(founder.providerId);
    expect((result as any).isFounder).toBe(true);
    expect((result as any).subscription).toBeUndefined();
  });

  it("getById expõe isFounder=false pro não-fundador", async () => {
    const nonFounder = await makeProvider("getbyid_nonfounder", false);
    providerProfileIdsToCleanup.add(nonFounder.providerId);

    const result = await providerService.getById(nonFounder.providerId);
    expect((result as any).isFounder).toBe(false);
  });

  it("search expõe isFounder e nunca subscription.status", async () => {
    const founder = await makeProvider("search_founder", true);
    providerProfileIdsToCleanup.add(founder.providerId);

    const results = await providerService.search({ q: founder.displayName } as any);
    const found = (results as any[]).find((r) => r.id === founder.providerId);
    expect(found).toBeTruthy();
    expect(found.isFounder).toBe(true);
    expect(found.subscription).toBeUndefined();
  });

  it("favoriteService.add expõe isFounder e nunca subscription.status", async () => {
    const founder = await makeProvider("fav_founder", true);
    providerProfileIdsToCleanup.add(founder.providerId);
    const clientUser = await prisma.user.create({
      data: {
        name: "Badge Fav Client",
        email: `${uid("badge_fav_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}9`,
        role: "CLIENT"
      }
    });
    userIdsToCleanup.add(clientUser.id);

    const result = await favoriteService.add(clientUser.id, founder.providerId);
    expect((result.provider as any).isFounder).toBe(true);
    expect((result.provider as any).subscription).toBeUndefined();
  });

  it("getProviderCatalog expõe isFounder no objeto provider", async () => {
    const founder = await makeProvider("catalog_founder", true);
    providerProfileIdsToCleanup.add(founder.providerId);

    const catalog = await consultancyService.getProviderCatalog(founder.providerId);
    expect(catalog.provider.isFounder).toBe(true);
  });
});
