import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";

// Liberdade de ofertas — Frente C: local de atendimento configurável por
// oferta (nunca pode expandir o que o perfil do profissional já permite) e
// pacote presencial passa a registrar o local das sessões que gera (gap
// real encontrado no mapeamento: pacotes nunca tinham local nenhum).

const consultancyService = new ConsultancyService();
const presentialPackageService = new PresentialPackageService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let categoryId = "";
let fixedOnlyProviderUserId = "";
let fixedOnlyProviderId = "";
let bothProviderUserId = "";
let bothProviderId = "";
const offerIds: string[] = [];
const packageIds: string[] = [];

describe("Liberdade de ofertas — Frente C (local por oferta + local do pacote)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `LOC_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Location Client",
        email: `${uid("loc_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        mpCustomerId: "cus_test_loc"
      }
    });
    clientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });

    await prisma.customerPaymentMethod.create({
      data: {
        userId: clientId,
        mpCustomerId: "cus_test_loc",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });

    // Profissional que só atende em local fixo (São Paulo - Av. Paulista),
    // raio de 5km, sem opção de domicílio.
    const fixedOnlyProviderUser = await prisma.user.create({
      data: {
        name: "Fixed Only Provider",
        email: `${uid("fixed_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    fixedOnlyProviderUserId = fixedOnlyProviderUser.id;
    const fixedOnlyProvider = await prisma.providerProfile.create({
      data: {
        userId: fixedOnlyProviderUserId,
        displayName: "Fixed Only Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        crefValidationStatus: "APPROVED",
        serviceMode: "PRESENTIAL_ONLY",
        serviceRadiusKm: 5,
        latitude: -23.5613,
        longitude: -46.6558,
        fixedLocations: [{ id: "loc1", name: "Studio Paulista" }]
      }
    });
    fixedOnlyProviderId = fixedOnlyProvider.id;

    // Profissional que atende nos dois formatos (local fixo + domicílio).
    const bothProviderUser = await prisma.user.create({
      data: {
        name: "Both Provider",
        email: `${uid("both_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}3`,
        role: "PROVIDER"
      }
    });
    bothProviderUserId = bothProviderUser.id;
    const bothProvider = await prisma.providerProfile.create({
      data: {
        userId: bothProviderUserId,
        displayName: "Both Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "444555666",
        crefValidationStatus: "APPROVED",
        serviceMode: "BOTH",
        serviceRadiusKm: 5,
        latitude: -23.5613,
        longitude: -46.6558,
        fixedLocations: [{ id: "loc2", name: "Studio Central" }]
      }
    });
    bothProviderId = bothProvider.id;
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { packageId: { in: packageIds } } });
    await prisma.presentialPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: [fixedOnlyProviderId, bothProviderId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, fixedOnlyProviderUserId, bothProviderUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("rejeita oferta com domicílio para profissional que só atende em local fixo", async () => {
    await expect(
      consultancyService.createProviderOffer(fixedOnlyProviderUserId, {
        kind: "PRESENTIAL",
        title: "Oferta inválida",
        billingCycle: "DAILY",
        priceCents: 10000,
        offerServiceMode: "HOME_VISIT_ONLY"
      })
    ).rejects.toThrow(/domicílio/);
  });

  it("aceita oferta com local fixo para profissional que só atende em local fixo", async () => {
    const offer = await consultancyService.createProviderOffer(fixedOnlyProviderUserId, {
      kind: "PRESENTIAL",
      title: "Oferta válida",
      billingCycle: "DAILY",
      priceCents: 10000,
      offerServiceMode: "PRESENTIAL_ONLY"
    });
    offerIds.push(offer.id);
    expect(offer.offerServiceMode).toBe("PRESENTIAL_ONLY");
  });

  it("profissional com perfil BOTH pode restringir uma oferta específica só a domicílio", async () => {
    const offer = await consultancyService.createProviderOffer(bothProviderUserId, {
      kind: "PRESENTIAL",
      title: "Só domicílio",
      billingCycle: "DAILY",
      priceCents: 10000,
      offerServiceMode: "HOME_VISIT_ONLY"
    });
    offerIds.push(offer.id);
    expect(offer.offerServiceMode).toBe("HOME_VISIT_ONLY");
  });

  it("compra de pacote com endereço fora do raio de atendimento é rejeitada", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId: bothProviderId,
        kind: "PRESENTIAL",
        title: `Pacote domicílio ${uid("offer")}`,
        billingCycle: "MONTHLY",
        priceCents: 40000,
        presentialPackageMode: "FLEXIBLE_CREDITS",
        presentialSessionsPerCycle: 4
      }
    });
    offerIds.push(offer.id);

    await expect(
      presentialPackageService.purchasePackage(clientId, {
        offerId: offer.id,
        categoryId,
        paymentMethod: "CREDIT_CARD" as any,
        sessionLocation: "A domicílio",
        // Rio de Janeiro - bem longe do raio de 5km em São Paulo.
        clientLatitude: -22.9068,
        clientLongitude: -43.1729
      })
    ).rejects.toThrow(/fora do raio/);
  });

  it("compra de pacote com local fixo salva o local e propaga pras sessões geradas", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId: bothProviderId,
        kind: "PRESENTIAL",
        title: `Pacote local fixo ${uid("offer")}`,
        billingCycle: "MONTHLY",
        priceCents: 40000,
        presentialPackageMode: "FIXED_RECURRING",
        presentialSessionsPerCycle: 4
      }
    });
    offerIds.push(offer.id);

    const { package: pkg } = await presentialPackageService.purchasePackage(clientId, {
      offerId: offer.id,
      categoryId,
      paymentMethod: "CREDIT_CARD" as any,
      sessionLocation: "Studio Central",
      weeklySchedule: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, time: "07:00" }))
    });
    packageIds.push(pkg.id);

    expect(pkg.sessionLocation).toBe("Studio Central");

    const bookings = await prisma.booking.findMany({ where: { packageId: pkg.id } });
    expect(bookings.length).toBeGreaterThan(0);
    for (const booking of bookings) {
      expect(booking.sessionLocation).toBe("Studio Central");
    }
  });
});
