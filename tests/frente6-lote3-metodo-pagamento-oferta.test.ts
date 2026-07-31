import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BookingStatus, ConsultancyPaymentMethod, OfferBillingCycle, PresentialPackageMode, ServiceOfferKind, UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { BookingService } from "../src/modules/bookings/services/booking.service";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";
import { PaymentService } from "../src/modules/payments/services/payment.service";

// Épico de Frentes, Frente 6 (Ofertas do profissional), Lote 3: cada oferta
// pode desabilitar Pix/débito/crédito individualmente
// (acceptsPix/acceptsDebitCard/acceptsCreditCard) — mas compra de COMBO e
// booking avulso vinculado a uma oferta ignoravam essa configuração por
// completo (os únicos 2 dos 4 fluxos que checam método de pagamento sem
// checar a config da oferta).

const bookingService = new BookingService();
const presentialPackageService = new PresentialPackageService();
const paymentService = new PaymentService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let categoryId = "";
let providerUserId = "";
let providerId = "";
let clientId = "";
const offerIds: string[] = [];
const bookingIds: string[] = [];

describe("Frente 6, Lote 3 — método de pagamento configurado pela oferta", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `F6L3_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Seis Lote Tres",
        email: `${uid("f6l3_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Seis Lote Tres",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Seis Lote Tres",
        email: `${uid("f6l3_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: UserRole.CLIENT,
        emailVerifiedAt: new Date()
      }
    });
    clientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });

    // Disponibilidade cobrindo o dia inteiro em todos os dias da semana —
    // os testes de criação de booking só precisam chegar até a checagem de
    // método de pagamento, não testar disponibilidade em si.
    for (let weekday = 0; weekday <= 6; weekday++) {
      await prisma.availability.create({
        data: { providerId, weekday, startTime: "00:00", endTime: "23:59", isActive: true }
      });
    }
  });

  afterAll(async () => {
    await prisma.availability.deleteMany({ where: { providerId } });
    await prisma.payment.deleteMany({ where: { booking: { id: { in: bookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [providerUserId, clientId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [providerUserId, clientId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("purchaseCombo rejeita Pix quando a oferta tem acceptsPix=false", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: ServiceOfferKind.COMBO,
        title: `Combo ${uid("offer")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 50000,
        presentialPackageMode: PresentialPackageMode.FLEXIBLE_CREDITS,
        comboPresentialShareCents: 30000,
        comboConsultancyShareCents: 20000,
        acceptsPix: false
      }
    });
    offerIds.push(offer.id);

    await expect(
      presentialPackageService.purchaseCombo(clientId, {
        offerId: offer.id,
        categoryId,
        paymentMethod: ConsultancyPaymentMethod.PIX,
        acknowledgedImmediateExecution: true
      })
    ).rejects.toThrow(/não aceita Pix/i);
  });

  it("purchaseCombo rejeita cartão de crédito quando a oferta tem acceptsCreditCard=false", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: ServiceOfferKind.COMBO,
        title: `Combo ${uid("offer")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 50000,
        presentialPackageMode: PresentialPackageMode.FLEXIBLE_CREDITS,
        comboPresentialShareCents: 30000,
        comboConsultancyShareCents: 20000,
        acceptsCreditCard: false
      }
    });
    offerIds.push(offer.id);

    await expect(
      presentialPackageService.purchaseCombo(clientId, {
        offerId: offer.id,
        categoryId,
        paymentMethod: ConsultancyPaymentMethod.CREDIT_CARD,
        acknowledgedImmediateExecution: true
      })
    ).rejects.toThrow(/não aceita cartão de crédito/i);
  });

  it("criar booking avulso vinculado a uma oferta rejeita método de pagamento desabilitado pela oferta", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: ServiceOfferKind.PRESENTIAL,
        title: `Sessão avulsa ${uid("offer")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 10000,
        acceptsPix: false
      }
    });
    offerIds.push(offer.id);

    await expect(
      bookingService.create(
        clientId,
        providerId,
        categoryId,
        new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
        offer.id,
        "PIX" as any
      )
    ).rejects.toThrow(/não aceita Pix/i);
  });

  it("booking avulso com método permitido pela oferta é criado normalmente e persiste offerId", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: ServiceOfferKind.PRESENTIAL,
        title: `Sessão avulsa ${uid("offer")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 10000,
        acceptsPix: false
      }
    });
    offerIds.push(offer.id);

    const booking = await bookingService.create(
      clientId,
      providerId,
      categoryId,
      new Date(Date.now() + 11 * 24 * 60 * 60 * 1000).toISOString(),
      offer.id,
      "CREDIT_CARD" as any
    );
    bookingIds.push(booking.id);

    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.offerId).toBe(offer.id);
  });

  it("selectBookingPaymentMethod rejeita trocar pra Pix quando a oferta vinculada ao booking não aceita Pix", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: ServiceOfferKind.PRESENTIAL,
        title: `Sessão avulsa ${uid("offer")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 10000,
        acceptsPix: false
      }
    });
    offerIds.push(offer.id);

    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        offerId: offer.id,
        scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        priceCents: 10000,
        status: BookingStatus.PENDING
      }
    });
    bookingIds.push(booking.id);

    await prisma.payment.create({
      data: {
        bookingId: booking.id,
        method: "CREDIT_CARD",
        status: "PENDING_AUTH",
        amountCents: 10000,
        currency: "BRL"
      }
    });

    await expect(
      paymentService.selectBookingPaymentMethod(clientId, booking.id, { method: "PIX" })
    ).rejects.toThrow(/não aceita Pix/i);
  });
});
