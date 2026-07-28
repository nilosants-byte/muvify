import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { BookingStatus, PaymentMethod, PaymentStatus, ConsultancyPaymentMethod, OfferBillingCycle } from "@prisma/client";
import { Payment, CardToken } from "mercadopago";
import { prisma } from "../src/config/prisma";
import { FinancialService } from "../src/modules/financial/services/financial.service";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Raio-X de pagamentos, Rodada 3, Lote 4: PARTIALLY_REFUNDED sumia inteiro da
// lista de repasses (getPayouts nunca incluia esse status na query) e o
// relatório anual (getReport) nunca ganhou o conserto de renovação de ficha
// que getDashboard/getPayouts já tinham recebido na Rodada 2, Lote 4.

const financialService = new FinancialService();
const consultancyService = new ConsultancyService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const bookingIds: string[] = [];
const offerIds: string[] = [];
const contractIds: string[] = [];

describe("Financeiro — reembolso parcial nos repasses e renovação de ficha no relatório (Rodada 3, Lote 4)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `FIN_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Financial Test Client",
        email: `${uid("fin_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        mpCustomerId: "cus_test_fin"
      }
    });
    clientId = client.id;

    await prisma.customerPaymentMethod.create({
      data: {
        userId: clientId,
        mpCustomerId: "cus_test_fin",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });

    const provider = await prisma.user.create({
      data: {
        name: "Financial Test Provider",
        email: `${uid("fin_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = provider.id;

    const providerProfile = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Financial Test Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "fin_test_account",
        mpAccessToken: encryptSensitiveText("fake_access_token"),
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = providerProfile.id;
  });

  afterAll(async () => {
    await prisma.consultancyContract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: clientId } });
    await prisma.payment.deleteMany({ where: { booking: { id: { in: bookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [clientId, providerUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("getPayouts inclui um pagamento PARTIALLY_REFUNDED com o líquido reduzido proporcionalmente", async () => {
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        priceCents: 10000,
        status: BookingStatus.COMPLETED
      }
    });
    bookingIds.push(booking.id);

    await prisma.payment.create({
      data: {
        bookingId: booking.id,
        amountCents: 10000,
        providerAmountCents: 9000,
        platformFeeCents: 1000,
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.PARTIALLY_REFUNDED,
        capturedAt: new Date(),
        refundedAt: new Date(),
        refundedAmountCents: 4000,
        mpPaymentId: `mp_${uid("partial")}`
      }
    });

    const payouts = await financialService.getPayouts(providerUserId);
    const tx = payouts.payments.find((p) => p.bookingId === booking.id);
    expect(tx).toBeDefined();
    expect(tx?.status).toBe("PARTIALLY_REFUNDED");
    // (10000 - 4000) / 10000 = 60% restante -> 9000 * 0.6 = 5400
    expect(tx?.providerAmountCents).toBe(5400);
    expect(payouts.availableCents).toBeGreaterThanOrEqual(5400);
  });

  it("getReport soma a renovação de ficha no mês (mesmo conserto que getDashboard/getPayouts já tinham)", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "ONLINE_CONSULTANCY",
        title: `Consultoria ${uid("offer")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 30000,
        fichaValidityDays: 30
      }
    });
    offerIds.push(offer.id);

    const request = await prisma.consultancyRequest.create({
      data: {
        providerId,
        clientId,
        status: "ACCEPTED",
        quotedOfferId: offer.id,
        responseDeadlineAt: new Date(),
        respondedAt: new Date(),
        clientDecisionAt: new Date()
      }
    });
    const contract = await prisma.consultancyContract.create({
      data: {
        requestId: request.id,
        providerId,
        clientId,
        offerId: offer.id,
        status: "ACTIVE",
        paymentMethod: ConsultancyPaymentMethod.CREDIT_CARD,
        paymentStatus: "CAPTURED",
        paymentAmountCents: 30000,
        providerAmountCents: 27000,
        platformAmountCents: 3000,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date()
      }
    });
    contractIds.push(contract.id);

    await consultancyService.deliverContract(providerUserId, contract.id, { title: "Ficha 1", exercises: [] });

    vi.spyOn(CardToken.prototype, "create").mockResolvedValueOnce({ id: "tok_test" } as any);
    vi.spyOn(Payment.prototype, "create").mockResolvedValueOnce({ id: 9301, status: "approved" } as any);
    await consultancyService.deliverContract(providerUserId, contract.id, { title: "Ficha 2 (renovação)", exercises: [] });
    vi.restoreAllMocks();

    const now = new Date();
    const report = await financialService.getReport(providerUserId, 1);
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const currentMonthReport = report.months.find((m) => m.month === currentMonthKey);
    expect(currentMonthReport).toBeDefined();
    // 1ª ficha (na criação do contrato) não conta como renovação — só a 2ª em diante soma aqui.
    expect(currentMonthReport!.appRevenueCents).toBeGreaterThanOrEqual(30000);
  });
});
