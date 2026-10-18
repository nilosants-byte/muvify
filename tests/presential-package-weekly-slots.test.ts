import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";
import { prisma } from "../src/config/prisma";
import { encryptSensitiveText } from "../src/shared/utils/encryption";
import { weeklySlotsForPackage, weeksPerCycle } from "../src/shared/utils/presential-package-schedule";

// Achado no teste manual do checklist (C6.1, 18/10/2026): no pacote de
// horário fixo dava pra escolher quantos horários quisesse por semana
// (inclusive vários no mesmo dia), e cada um virava uma aula em toda semana
// do ciclo — 9 horários num pacote de 4 sessões/mês viravam ~39 aulas.
// Regra decidida: número EXATO de horários por semana (sessões por ciclo ÷
// semanas do ciclo), no máximo 1 por dia, e nunca mais aulas por ciclo do
// que o pacote cobre.

const packageService = new PresentialPackageService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const offerIds: string[] = [];

describe("Pacote de horário fixo: horários por semana coerentes com as sessões do pacote", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const category = await prisma.serviceCategory.create({ data: { name: `WS_${Date.now()}`, description: "test" } });
    categoryId = category.id;
    const client = await prisma.user.create({
      data: {
        name: "Cliente Horarios",
        email: `${uid("ws_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}3`,
        role: "CLIENT",
        mpCustomerId: "cus_test_ws",
        emailVerifiedAt: new Date()
      }
    });
    clientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });
    await prisma.customerPaymentMethod.create({
      data: { userId: clientId, mpCustomerId: "cus_test_ws", mpCardId: `card_${uid("c")}`, nickname: "Cartão", brand: "visa", last4: "4242", funding: "CREDIT" }
    });
    const providerUser = await prisma.user.create({
      data: { name: "Provider Horarios", email: `${uid("ws_provider")}@test.com`, password: "x", phone: `11${Date.now().toString().slice(-9)}4`, role: "PROVIDER" }
    });
    providerUserId = providerUser.id;
    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Provider Horarios",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "123123123",
        mpAccessToken: encryptSensitiveText("fake_access_token"),
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;
  });

  afterAll(async () => {
    const pkgs = await prisma.presentialPackage.findMany({ where: { offerId: { in: offerIds } }, select: { id: true } });
    const pkgIds = pkgs.map((p) => p.id);
    await prisma.payment.deleteMany({ where: { booking: { packageId: { in: pkgIds } } } });
    await prisma.booking.deleteMany({ where: { packageId: { in: pkgIds } } });
    await prisma.presentialPackageCycle.deleteMany({ where: { packageId: { in: pkgIds } } });
    await prisma.presentialPackage.deleteMany({ where: { id: { in: pkgIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: clientId } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  async function fixedOffer(sessionsPerCycle: number) {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "PRESENTIAL",
        title: `Fixo ${uid("o")}`,
        billingCycle: "MONTHLY",
        priceCents: 40000,
        presentialPackageMode: "FIXED_RECURRING",
        presentialSessionsPerCycle: sessionsPerCycle,
        acceptsCreditCard: true
      }
    });
    offerIds.push(offer.id);
    return offer.id;
  }

  it("calcula horários por semana a partir das sessões do ciclo", () => {
    expect(weeksPerCycle("MONTHLY")).toBe(4);
    expect(weeklySlotsForPackage("MONTHLY", 4)).toBe(1);
    expect(weeklySlotsForPackage("MONTHLY", 8)).toBe(2);
    expect(weeklySlotsForPackage("WEEKLY", 3)).toBe(3);
    expect(weeklySlotsForPackage("MONTHLY", 6)).toBeNull();
    expect(weeklySlotsForPackage("DAILY", 1)).toBeNull();
  });

  it("recusa dois horários no mesmo dia da semana", async () => {
    const offerId = await fixedOffer(8);
    await expect(
      packageService.purchasePackage(clientId, {
        offerId,
        categoryId,
        paymentMethod: "CREDIT_CARD" as any,
        weeklySchedule: [{ weekday: 1, time: "08:00" }, { weekday: 1, time: "18:00" }]
      })
    ).rejects.toThrow(/um horário por dia/);
  });

  it("recusa quantidade de horários diferente da que o pacote cobre", async () => {
    const offerId = await fixedOffer(4);
    await expect(
      packageService.purchasePackage(clientId, {
        offerId,
        categoryId,
        paymentMethod: "CREDIT_CARD" as any,
        weeklySchedule: [{ weekday: 1, time: "08:00" }, { weekday: 3, time: "08:00" }, { weekday: 5, time: "08:00" }]
      })
    ).rejects.toThrow(/exatamente 1 horário/);
    expect(await prisma.presentialPackage.count({ where: { clientId, offerId } })).toBe(0);
  });

  it("com a quantidade certa, gera no máximo as sessões do ciclo", async () => {
    const offerId = await fixedOffer(8);
    const result = await packageService.purchasePackage(clientId, {
      offerId,
      categoryId,
      paymentMethod: "CREDIT_CARD" as any,
      weeklySchedule: [{ weekday: 2, time: "07:00" }, { weekday: 4, time: "07:00" }]
    });
    const sessions = await prisma.booking.count({ where: { packageId: result.package.id } });
    expect(sessions).toBeGreaterThan(0);
    expect(sessions).toBeLessThanOrEqual(8);
  });
});
