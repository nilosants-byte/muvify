import "dotenv/config";
import { createHmac } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import { Payment, CardToken } from "mercadopago";
import { BookingStatus, PaymentMethod, PaymentStatus } from "@prisma/client";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";
import { NotificationService } from "../src/modules/notifications/services/notification.service";

// Raio-X de pagamentos (27/07/2026) — Lote 6: parcelamento real no pacote
// presencial (só ciclos elegíveis) e notificação de webhook não duplicada em
// reenvio (recusado/cancelado e chargeback).

const packageService = new PresentialPackageService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function sign(secret: string, dataId: string, requestId: string, ts: string) {
  const message = `id:${dataId};request-id:${requestId};ts:${ts};`;
  return createHmac("sha256", secret).update(message).digest("hex");
}

async function sendPaymentWebhook(mpPaymentId: string) {
  const requestId = `req_${mpPaymentId}`;
  const ts = Date.now().toString();
  const v1 = sign(env.MP_WEBHOOK_SECRET!, mpPaymentId, requestId, ts);
  return request(app)
    .post("/api/payments/webhook")
    .set("Content-Type", "application/json")
    .query({ "data.id": mpPaymentId })
    .set("x-request-id", requestId)
    .set("x-signature", `ts=${ts},v1=${v1}`)
    .send(JSON.stringify({ topic: "payment", data: { id: mpPaymentId } }));
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const offerIds: string[] = [];
const packageIds: string[] = [];
const bookingIds: string[] = [];

describe("Parcelamento real do pacote presencial e dedup de webhook (Lote 6 do raio-x)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `IW_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Installments Webhook Client",
        email: `${uid("iw_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        mpCustomerId: "cus_test_iw"
      }
    });
    clientId = client.id;

    await prisma.customerPaymentMethod.create({
      data: {
        userId: clientId,
        mpCustomerId: "cus_test_iw",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });

    const providerUser = await prisma.user.create({
      data: {
        name: "Installments Webhook Provider",
        email: `${uid("iw_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Installments Webhook Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 15000,
        mpAccountId: "444333222",
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
  });

  afterAll(async () => {
    await prisma.disputeCase.deleteMany({ where: { clientId } });
    await prisma.payment.deleteMany({ where: { booking: { id: { in: bookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.presentialPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.consultancyContract.deleteMany({ where: { clientId } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  // Parcelamento real só se aplica quando a cobrança é "de uma vez só"
  // (chargeCycle) — a compra avulsa de um pacote FIXED_RECURRING em cartão
  // cobra por sessão (activateCardFixedPeriod), então quem realmente
  // exercita esse caminho é a metade presencial do COMBO, que sempre usa
  // chargeCycle independente da forma de pagamento.
  async function makeComboOffer(billingCycle: "MONTHLY" | "QUARTERLY" | "SEMIANNUAL", maxCreditInstallments: number) {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "COMBO",
        title: `Combo ${uid("offer")}`,
        billingCycle,
        priceCents: 90000,
        presentialPackageMode: "FIXED_RECURRING",
        presentialSessionsPerCycle: 4,
        acceptsCreditCard: true,
        maxCreditInstallments,
        comboPresentialShareCents: 60000,
        comboConsultancyShareCents: 30000,
        comboPresentialDaysPerWeek: 2,
        comboOnlineDaysPerWeek: 3
      }
    });
    offerIds.push(offer.id);
    return offer;
  }

  async function makeStandalonePackage(billingCycle: "MONTHLY" | "QUARTERLY" | "SEMIANNUAL", paymentInstallments: number) {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "PRESENTIAL",
        title: `Pacote ${uid("offer")}`,
        billingCycle,
        priceCents: 90000,
        presentialPackageMode: "FIXED_RECURRING",
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
        mode: "FIXED_RECURRING",
        status: "PENDING_PAYMENT",
        paymentMethod: "CREDIT_CARD",
        cycleAmountCents: 90000,
        billingCycle,
        sessionsPerCycle: 4,
        paymentInstallments
      }
    });
    packageIds.push(pkg.id);
    return pkg;
  }

  it("chargeCycle aplica o parcelamento persistido no pacote na cobrança real", async () => {
    vi.spyOn(Payment.prototype, "create").mockResolvedValueOnce({ id: 9101, status: "approved" } as any);

    const pkg = await makeStandalonePackage("QUARTERLY", 3);
    await packageService.chargeCycle(pkg.id, { isFirstCycle: true });

    expect(Payment.prototype.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ installments: 3 }) })
    );
  });

  it("rejeita parcelamento acima do máximo configurado pela oferta", async () => {
    const offer = await makeComboOffer("QUARTERLY", 3);
    await expect(
      packageService.purchaseCombo(clientId, {
        offerId: offer.id,
        categoryId,
        paymentMethod: "CREDIT_CARD" as any,
        weeklySchedule: [{ weekday: 1, time: "08:00" }],
        acknowledgedImmediateExecution: true,
        installments: 6
      })
    ).rejects.toThrow(/[Mm]áximo/);
  });

  it("rejeita parcelamento acima de 1x em ciclo não elegível (mensal), mesmo com maxCreditInstallments configurado", async () => {
    const offer = await makeComboOffer("MONTHLY", 12);
    await expect(
      packageService.purchaseCombo(clientId, {
        offerId: offer.id,
        categoryId,
        paymentMethod: "CREDIT_CARD" as any,
        weeklySchedule: [{ weekday: 1, time: "08:00" }],
        acknowledgedImmediateExecution: true,
        installments: 2
      })
    ).rejects.toThrow(/[Mm]áximo/);
  });

  it("uma segunda cobrança de ciclo (renovação) reaplica o mesmo parcelamento persistido no pacote", async () => {
    const createSpy = vi.spyOn(Payment.prototype, "create")
      .mockResolvedValueOnce({ id: 9201, status: "approved" } as any)
      .mockResolvedValueOnce({ id: 9202, status: "approved" } as any);

    const pkg = await makeStandalonePackage("SEMIANNUAL", 4);
    await packageService.chargeCycle(pkg.id, { isFirstCycle: true });
    await packageService.chargeCycle(pkg.id, { isFirstCycle: false });

    expect(createSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ installments: 4 }) })
    );
  });

  it("webhook de pagamento recusado reenviado pela MP não notifica duas vezes", async () => {
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        priceCents: 15000,
        status: BookingStatus.PENDING
      }
    });
    bookingIds.push(booking.id);

    const mpPaymentId = `mp_${uid("rej")}`;
    await prisma.payment.create({
      data: {
        bookingId: booking.id,
        amountCents: 15000,
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.AUTHORIZING,
        mpPaymentId
      }
    });

    vi.spyOn(Payment.prototype, "get").mockResolvedValue({
      id: mpPaymentId,
      status: "rejected",
      status_detail: "cc_rejected_other_reason"
    } as any);
    const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);

    const first = await sendPaymentWebhook(mpPaymentId);
    expect(first.status).toBe(204);
    const callsAfterFirst = notifySpy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const second = await sendPaymentWebhook(mpPaymentId);
    expect(second.status).toBe(204);
    expect(notifySpy.mock.calls.length).toBe(callsAfterFirst);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(payment.status).toBe(PaymentStatus.FAILED);
  });
});
