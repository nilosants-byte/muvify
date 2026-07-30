import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BookingStatus } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";
import { BookingService } from "../src/modules/bookings/services/booking.service";

// Épico de Frentes, Frente 4 (Criação/entrega/evolução do treino), Lote 1:
// (1) cancelar/expirar uma sessão de pacote de sessões avulsas (FLEXIBLE_
//     CREDITS) devolve o crédito consumido, exceto quando o cliente cancela
//     em cima da hora (culpa dele, sessão é "gasta" mesmo sem acontecer).
// (2) duas reservas concorrentes com 1 crédito restante - só uma sucede, o
//     pacote nunca fica negativo.

const packageService = new PresentialPackageService();
const bookingService = new BookingService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const offerIds: string[] = [];
const packageIds: string[] = [];

describe("Frente 4, Lote 1 — crédito de pacote de sessões avulsas", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `CR_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Credito Client",
        email: `${uid("credito_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        mpCustomerId: "cus_test_credito",
        emailVerifiedAt: new Date()
      }
    });
    clientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });

    await prisma.customerPaymentMethod.create({
      data: {
        userId: clientId,
        mpCustomerId: "cus_test_credito",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });

    const providerUser = await prisma.user.create({
      data: {
        name: "Credito Provider",
        email: `${uid("credito_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Credito Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 15000,
        mpAccountId: "999888776",
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

  async function makeOffer(sessionsPerCycle = 2) {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "PRESENTIAL",
        title: `Pacote crédito ${uid("offer")}`,
        billingCycle: "MONTHLY",
        priceCents: 8000,
        presentialPackageMode: "FLEXIBLE_CREDITS",
        presentialSessionsPerCycle: sessionsPerCycle,
        presentialHasFixedTerm: true,
        presentialTotalCycles: 1
      }
    });
    offerIds.push(offer.id);
    return offer.id;
  }

  async function bookSession(pkgId: string, hoursFromNow: number) {
    const scheduledAtDate = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
    return bookingService.create(
      clientId,
      providerId,
      categoryId,
      scheduledAtDate.toISOString(),
      undefined,
      "CREDIT_CARD" as any,
      undefined,
      undefined,
      undefined,
      undefined,
      pkgId,
      true
    );
  }

  it("profissional cancelando a sessão devolve o crédito ao pacote", async () => {
    const offerId = await makeOffer();
    const { package: pkg } = await packageService.purchasePackage(clientId, {
      offerId,
      categoryId,
      paymentMethod: "CREDIT_CARD" as any
    });
    packageIds.push(pkg.id);

    const booking = await bookSession(pkg.id, 72);
    const afterBooking = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(afterBooking.creditsRemainingThisCycle).toBe(1);

    await bookingService.updateStatus(providerUserId, booking.id, BookingStatus.CANCELLED);

    const afterCancel = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(afterCancel.creditsRemainingThisCycle).toBe(2);
  });

  it("cliente cancelando com antecedência (>=2h) devolve o crédito", async () => {
    const offerId = await makeOffer();
    const { package: pkg } = await packageService.purchasePackage(clientId, {
      offerId,
      categoryId,
      paymentMethod: "CREDIT_CARD" as any
    });
    packageIds.push(pkg.id);

    const booking = await bookSession(pkg.id, 72);
    await bookingService.updateStatus(clientId, booking.id, BookingStatus.CANCELLED);

    const afterCancel = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(afterCancel.creditsRemainingThisCycle).toBe(2);
  });

  it("cliente cancelando em cima da hora (<2h) NÃO devolve o crédito - sessão é considerada gasta", async () => {
    const offerId = await makeOffer();
    const { package: pkg } = await packageService.purchasePackage(clientId, {
      offerId,
      categoryId,
      paymentMethod: "CREDIT_CARD" as any
    });
    packageIds.push(pkg.id);

    const booking = await bookSession(pkg.id, 72);
    const beforeCancel = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(beforeCancel.creditsRemainingThisCycle).toBe(1);

    // Reservado com antecedência suficiente pra passar na checagem de aviso
    // mínimo do profissional; recuando o horário aqui só pra simular "faltam
    // menos de 2h" no momento do cancelamento, sem violar essa checagem na
    // criação.
    await prisma.booking.update({
      where: { id: booking.id },
      data: { scheduledAt: new Date(Date.now() + 60 * 60 * 1000) }
    });

    await bookingService.updateStatus(clientId, booking.id, BookingStatus.CANCELLED);

    const afterCancel = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(afterCancel.creditsRemainingThisCycle).toBe(1);
  });

  it("duas reservas concorrentes com 1 crédito restante - só uma sucede, pacote nunca fica negativo", async () => {
    const offerId = await makeOffer(1);
    const { package: pkg } = await packageService.purchasePackage(clientId, {
      offerId,
      categoryId,
      paymentMethod: "CREDIT_CARD" as any
    });
    packageIds.push(pkg.id);

    const results = await Promise.allSettled([bookSession(pkg.id, 72), bookSession(pkg.id, 96)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const finalPkg = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(finalPkg.creditsRemainingThisCycle).toBe(0);
  });
});
