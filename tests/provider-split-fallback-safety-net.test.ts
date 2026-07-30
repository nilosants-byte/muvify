import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { Payment, CardToken } from "mercadopago";
import { PaymentMethod, PaymentStatus, ConsultancyPaymentMethod, OfferBillingCycle, PresentialPackageMode, PresentialPackageStatus } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { BookingService } from "../src/modules/bookings/services/booking.service";
import { PaymentService } from "../src/modules/payments/services/payment.service";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";
import { DebtService } from "../src/modules/payments/services/debt.service";
import { NotificationService } from "../src/modules/notifications/services/notification.service";

// Raio-X de pagamentos, Rodada 2, Lote 1: antes desta correcao, se o token do
// profissional nao resolvesse por QUALQUER motivo (nunca conectou conta,
// erro transitorio, etc — nao so o caso ja tratado de token explicitamente
// invalidado), a cobranca acontecia mesmo assim, sem collector/marketplace_fee
// — o dinheiro cai inteiro na conta MP da propria Muvify em vez de ir pro
// profissional. Esses testes cobrem os pontos de cobranca mais
// representativos (booking avulso Pix e cartao, ciclo de pacote presencial —
// 1a cobranca e renovacao — e cobranca de divida), usando um profissional
// SEM mpAccessToken salvo (o caso geral, nao so "invalidado").

const bookingService = new BookingService();
const paymentService = new PaymentService();
const packageService = new PresentialPackageService();
const debtService = new DebtService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const bookingIds: string[] = [];
const offerIds: string[] = [];
const packageIds: string[] = [];

describe("Nunca cobra sem split resolvido (Rodada 2, Lote 1 do raio-x)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `SF_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Split Fallback Client",
        email: `${uid("sf_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        mpCustomerId: "cus_test_sf",
        emailVerifiedAt: new Date()
      }
    });
    clientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });

    const defaultCardId = `card_${uid("c")}`;
    await prisma.customerPaymentMethod.create({
      data: {
        userId: clientId,
        mpCustomerId: "cus_test_sf",
        mpCardId: defaultCardId,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT",
        isDefault: true
      }
    });
    await prisma.user.update({ where: { id: clientId }, data: { mpDefaultCardId: defaultCardId } });

    const providerUser = await prisma.user.create({
      data: {
        name: "Split Fallback Provider",
        email: `${uid("sf_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    // Profissional com mpAccountId configurado, mas SEM mpAccessToken salvo —
    // o caso geral (nunca completou a conexao OAuth de verdade), diferente do
    // caso ja tratado de token explicitamente invalidado.
    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Split Fallback Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "777666555",
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

    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
  });

  afterAll(async () => {
    await prisma.debtRecord.deleteMany({ where: { clientId } });
    await prisma.presentialPackageCycle.deleteMany({ where: { package: { id: { in: packageIds } } } });
    await prisma.presentialPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.payment.deleteMany({ where: { booking: { id: { in: bookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.availability.deleteMany({ where: { providerId } });
    await prisma.providerCategory.deleteMany({ where: { providerId } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  async function createFutureBooking(method: PaymentMethod, daysFromNow = 3) {
    const scheduledAt = new Date();
    scheduledAt.setDate(scheduledAt.getDate() + daysFromNow);
    scheduledAt.setHours(14, 0, 0, 0);
    const booking = await bookingService.create(
      clientId,
      providerId,
      categoryId,
      scheduledAt.toISOString(),
      undefined,
      method,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true
    );
    bookingIds.push(booking.id);
    return booking;
  }

  it("booking avulso via Pix: nao gera cobranca sem split — falha alto e claro e o Payment fica FAILED (nao trava em AUTHORIZING)", async () => {
    const createSpy = vi.spyOn(Payment.prototype, "create");
    const booking = await createFutureBooking(PaymentMethod.PIX, 20);

    await expect(paymentService.createPixChargeForBooking(booking.id, clientId)).rejects.toThrow(
      /conexão deste profissional com o Mercado Pago/
    );
    expect(createSpy).not.toHaveBeenCalled();

    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(payment.status).toBe(PaymentStatus.FAILED);
    expect(payment.failureReason).toMatch(/conexão deste profissional com o Mercado Pago/);
  });

  it("booking avulso via cartão: nao gera cobranca sem split — falha alto e claro e o Payment fica FAILED", async () => {
    const createSpy = vi.spyOn(Payment.prototype, "create");
    const booking = await createFutureBooking(PaymentMethod.CREDIT_CARD, 21);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });

    await expect(paymentService.authorizePayment(payment.id)).rejects.toThrow(
      /conexão deste profissional com o Mercado Pago/
    );
    expect(createSpy).not.toHaveBeenCalled();

    const updated = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(updated.status).toBe(PaymentStatus.FAILED);
    expect(updated.failureReason).toMatch(/conexão deste profissional com o Mercado Pago/);
  });

  it("pacote presencial — 1a cobranca (compra): falha antes de tentar cobrar sem split", async () => {
    const createSpy = vi.spyOn(Payment.prototype, "create");
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "PRESENTIAL",
        title: `Pacote ${uid("offer")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 40000,
        presentialPackageMode: PresentialPackageMode.FIXED_RECURRING,
        presentialSessionsPerCycle: 4
      }
    });
    offerIds.push(offer.id);

    const pkg = await prisma.presentialPackage.create({
      data: {
        providerId,
        clientId,
        offerId: offer.id,
        categoryId,
        mode: PresentialPackageMode.FIXED_RECURRING,
        status: PresentialPackageStatus.PENDING_PAYMENT,
        paymentMethod: PaymentMethod.CREDIT_CARD,
        cycleAmountCents: 40000,
        billingCycle: OfferBillingCycle.MONTHLY,
        sessionsPerCycle: 4
      }
    });
    packageIds.push(pkg.id);

    await expect(packageService.chargeCycle(pkg.id, { isFirstCycle: true })).rejects.toThrow(
      /conexão deste profissional com o Mercado Pago/
    );
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("pacote presencial — renovação de ciclo via cron: NÃO tenta cobrar sem split, trata como ciclo falho e avisa o profissional pra reconectar", async () => {
    const createSpy = vi.spyOn(Payment.prototype, "create");
    const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "PRESENTIAL",
        title: `Pacote ${uid("offer")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 40000,
        presentialPackageMode: PresentialPackageMode.FIXED_RECURRING,
        presentialSessionsPerCycle: 4
      }
    });
    offerIds.push(offer.id);

    const pkg = await prisma.presentialPackage.create({
      data: {
        providerId,
        clientId,
        offerId: offer.id,
        categoryId,
        mode: PresentialPackageMode.FIXED_RECURRING,
        status: PresentialPackageStatus.ACTIVE,
        paymentMethod: PaymentMethod.CREDIT_CARD,
        cycleAmountCents: 40000,
        billingCycle: OfferBillingCycle.MONTHLY,
        sessionsPerCycle: 4,
        nextCycleIndex: 2,
        nextBillingAt: new Date(),
        consecutiveFailedCycles: 0
      }
    });
    packageIds.push(pkg.id);

    const result = await packageService.chargeCycle(pkg.id, { isFirstCycle: false });

    expect(result).toEqual({ status: "FAILED" });
    expect(createSpy).not.toHaveBeenCalled();

    const updated = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(updated.lastBillingFailureReason).toMatch(/reconectada/);
    expect(updated.consecutiveFailedCycles).toBe(1);

    const providerNotified = notifySpy.mock.calls.some(
      (call) => (call[0] as string[]).includes(providerUserId) && (call[1] as any).title === "Reconecte sua conta Mercado Pago"
    );
    expect(providerNotified).toBe(true);
  });

  it("cobrança de dívida: falha antes de tentar cobrar sem split", async () => {
    const createSpy = vi.spyOn(Payment.prototype, "create");
    const disputeCase = await prisma.disputeCase.create({
      data: {
        type: "REFUND_FAILED",
        clientId,
        providerId,
        amountCents: 5000,
        contextNote: "Teste de dívida"
      }
    });
    const debt = await prisma.debtRecord.create({
      data: {
        disputeCaseId: disputeCase.id,
        debtorType: "CLIENT",
        clientId,
        providerId,
        amountCents: 5000,
        reason: "Teste de dívida",
        status: "PENDING"
      }
    });

    await expect(debtService.payDebt(clientId, debt.id)).rejects.toThrow(
      /conexão deste profissional com o Mercado Pago/
    );
    expect(createSpy).not.toHaveBeenCalled();

    await prisma.debtRecord.deleteMany({ where: { id: debt.id } });
    await prisma.disputeCase.deleteMany({ where: { id: disputeCase.id } });
  });
});
