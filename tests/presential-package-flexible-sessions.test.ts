import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/config/prisma";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";
import { BookingService } from "../src/modules/bookings/services/booking.service";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";

// Liberdade de ofertas — Frente D: pacote de sessões avulsas (créditos
// flexíveis redesenhado). Um bloco fechado de N sessões com validade, sem
// nenhuma cobrança na compra — cada sessão que o aluno agenda é cobrada
// individualmente (mesmo motor da sessão avulsa comum), consumindo uma vaga
// do total contratado.

const packageService = new PresentialPackageService();
const bookingService = new BookingService();
const consultancyService = new ConsultancyService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const offerIds: string[] = [];
const packageIds: string[] = [];

describe("Pacote de sessões avulsas (créditos flexíveis redesenhado) — Frente D", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `FS_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Flex Session Client",
        email: `${uid("flex_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        mpCustomerId: "cus_test_flex",
        emailVerifiedAt: new Date()
      }
    });
    clientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });

    await prisma.customerPaymentMethod.create({
      data: {
        userId: clientId,
        mpCustomerId: "cus_test_flex",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });

    const providerUser = await prisma.user.create({
      data: {
        name: "Flex Session Provider",
        email: `${uid("flex_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Flex Session Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 15000,
        mpAccountId: "999888777",
        crefValidationStatus: "APPROVED",
        minBookingNoticeHours: 1
      }
    });
    providerId = provider.id;

    await prisma.availability.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        providerId,
        weekday,
        startTime: "06:00",
        endTime: "22:00",
        isActive: true
      }))
    });
    await prisma.providerCategory.create({ data: { providerId, categoryId } });
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { booking: { packageId: { in: packageIds } } } });
    await prisma.booking.deleteMany({ where: { packageId: { in: packageIds } } });
    await prisma.presentialPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: clientId } });
    await prisma.availability.deleteMany({ where: { providerId } });
    await prisma.providerCategory.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  async function makeOffer() {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "PRESENTIAL",
        title: `Pacote de sessões ${uid("offer")}`,
        billingCycle: "MONTHLY",
        priceCents: 8000,
        presentialPackageMode: "FLEXIBLE_CREDITS",
        presentialSessionsPerCycle: 2,
        presentialHasFixedTerm: true,
        presentialTotalCycles: 1
      }
    });
    offerIds.push(offer.id);
    return offer.id;
  }

  it("oferta de sessões avulsas exige validade determinada", async () => {
    await expect(
      consultancyService.createProviderOffer(providerUserId, {
        kind: "PRESENTIAL",
        title: "Sem validade",
        billingCycle: "MONTHLY",
        priceCents: 8000,
        presentialPackageMode: "FLEXIBLE_CREDITS",
        presentialSessionsPerCycle: 2,
        presentialHasFixedTerm: false
      })
    ).rejects.toThrow(/validade/);
  });

  it("compra não cobra nada adiantado e já fica ativo com as sessões disponíveis", async () => {
    const offerId = await makeOffer();
    const { package: pkg, payment } = await packageService.purchasePackage(clientId, {
      offerId,
      categoryId,
      paymentMethod: "CREDIT_CARD" as any
    });
    packageIds.push(pkg.id);

    expect(payment.status).toBe("READY");
    expect((payment as any).sessionsAvailable).toBe(2);
    expect(pkg.status).toBe("ACTIVE");
    expect(pkg.creditsRemainingThisCycle).toBe(2);
    expect(pkg.validUntil).not.toBeNull();

    const payments = await prisma.payment.findMany({ where: { booking: { packageId: pkg.id } } });
    expect(payments).toHaveLength(0);
  });

  it("agendar uma sessão do pacote cobra individualmente e consome uma vaga", async () => {
    const offerId = await makeOffer();
    const { package: pkg } = await packageService.purchasePackage(clientId, {
      offerId,
      categoryId,
      paymentMethod: "CREDIT_CARD" as any
    });
    packageIds.push(pkg.id);

    const scheduledAtDate = new Date(Date.now() + 48 * 60 * 60 * 1000);
    scheduledAtDate.setHours(14, 0, 0, 0);
    const scheduledAt = scheduledAtDate.toISOString();
    const booking = await bookingService.create(
      clientId,
      providerId,
      categoryId,
      scheduledAt,
      undefined,
      "CREDIT_CARD" as any,
      undefined,
      undefined,
      undefined,
      undefined,
      pkg.id,
      true
    );

    expect(booking.priceCents).toBe(8000);
    expect(booking.packageId).toBe(pkg.id);

    const payment = await prisma.payment.findUnique({ where: { bookingId: booking.id } });
    expect(payment).not.toBeNull();
    expect(payment!.amountCents).toBe(8000);

    const updatedPkg = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(updatedPkg.creditsRemainingThisCycle).toBe(1);
  });

  it("rejeita agendar quando as sessões do pacote já acabaram", async () => {
    const offerId = await makeOffer();
    const { package: pkg } = await packageService.purchasePackage(clientId, {
      offerId,
      categoryId,
      paymentMethod: "CREDIT_CARD" as any
    });
    packageIds.push(pkg.id);

    await prisma.presentialPackage.update({
      where: { id: pkg.id },
      data: { creditsRemainingThisCycle: 0 }
    });

    const scheduledAtDate = new Date(Date.now() + 48 * 60 * 60 * 1000);
    scheduledAtDate.setHours(14, 0, 0, 0);
    const scheduledAt = scheduledAtDate.toISOString();
    await expect(
      bookingService.create(
        clientId,
        providerId,
        categoryId,
        scheduledAt,
        undefined,
        "CREDIT_CARD" as any,
        undefined,
        undefined,
        undefined,
        undefined,
        pkg.id,
        true
      )
    ).rejects.toThrow(/sessões/);
  });

  it("rejeita agendar sessão fora da validade do pacote", async () => {
    const offerId = await makeOffer();
    const { package: pkg } = await packageService.purchasePackage(clientId, {
      offerId,
      categoryId,
      paymentMethod: "CREDIT_CARD" as any
    });
    packageIds.push(pkg.id);

    const scheduledAt = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString();
    await expect(
      bookingService.create(
        clientId,
        providerId,
        categoryId,
        scheduledAt,
        undefined,
        "CREDIT_CARD" as any,
        undefined,
        undefined,
        undefined,
        undefined,
        pkg.id
      )
    ).rejects.toThrow(/validade/);
  });

  it("cancelar o pacote libera as sessões futuras já agendadas sem tentar reembolsar nada", async () => {
    const offerId = await makeOffer();
    const { package: pkg } = await packageService.purchasePackage(clientId, {
      offerId,
      categoryId,
      paymentMethod: "CREDIT_CARD" as any
    });
    packageIds.push(pkg.id);

    const scheduledAtDate2 = new Date(Date.now() + 72 * 60 * 60 * 1000);
    scheduledAtDate2.setHours(14, 0, 0, 0);
    const scheduledAt = scheduledAtDate2.toISOString();
    const booking = await bookingService.create(
      clientId,
      providerId,
      categoryId,
      scheduledAt,
      undefined,
      "CREDIT_CARD" as any,
      undefined,
      undefined,
      undefined,
      undefined,
      pkg.id,
      true
    );

    const cancelled = await packageService.cancelPackage(clientId, pkg.id);
    expect(cancelled.status).toBe("CANCELLED");

    const afterBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(afterBooking.status).toBe("CANCELLED");

    const afterPayment = await prisma.payment.findUnique({ where: { bookingId: booking.id } });
    expect(afterPayment?.status).toBe("CANCELED");
  });
});
