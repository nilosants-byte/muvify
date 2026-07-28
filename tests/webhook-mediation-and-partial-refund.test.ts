import "dotenv/config";
import { createHmac } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import { Payment } from "mercadopago";
import { BookingStatus, PaymentMethod, PaymentStatus } from "@prisma/client";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";

// Raio-X de pagamentos, Rodada 2, Lote 2: dois status do webhook do Mercado
// Pago que antes caíam no vazio — "in_mediation" (fase anterior a um
// chargeback definitivo, que sumia sem log nem aviso) e reembolso parcial
// (que era tratado igual a reembolso total, perdendo o valor real devolvido).

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
let providerId = "";
let providerUserId = "";
let categoryId = "";
const bookingIds: string[] = [];
const paymentIds: string[] = [];

describe("Webhook: mediação e reembolso parcial (Rodada 2, Lote 2 do raio-x)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `WM_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Webhook Mediation Client",
        email: `${uid("wm_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Webhook Mediation Provider",
        email: `${uid("wm_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Webhook Mediation Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "333222111",
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.paymentAuditLog.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await prisma.payment.deleteMany({ where: { booking: { id: { in: bookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  async function createCapturedBooking(amountCents: number) {
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        priceCents: amountCents,
        status: BookingStatus.COMPLETED
      }
    });
    bookingIds.push(booking.id);
    const mpPaymentId = `mp_${uid("pay")}`;
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        amountCents,
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.CAPTURED,
        mpPaymentId,
        capturedAt: new Date()
      }
    });
    paymentIds.push(payment.id);
    return { booking, mpPaymentId };
  }

  it("in_mediation: registra em audit log e avisa as partes, sem mudar o status do pagamento", async () => {
    const { booking, mpPaymentId } = await createCapturedBooking(15000);

    vi.spyOn(Payment.prototype, "get").mockResolvedValue({
      id: mpPaymentId,
      status: "in_mediation",
      status_detail: "mediation_opened"
    } as any);

    const res = await sendPaymentWebhook(mpPaymentId);
    expect(res.status).toBe(204);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(payment.status).toBe(PaymentStatus.CAPTURED);

    const auditLog = await prisma.paymentAuditLog.findFirst({
      where: { paymentId: payment.id, toStatus: "IN_MEDIATION" }
    });
    expect(auditLog).not.toBeNull();
  });

  it("reembolso parcial: marca PARTIALLY_REFUNDED com o valor real devolvido, não o total", async () => {
    const { booking, mpPaymentId } = await createCapturedBooking(20000);

    vi.spyOn(Payment.prototype, "get").mockResolvedValue({
      id: mpPaymentId,
      status: "refunded",
      status_detail: "partially_refunded",
      transaction_amount_refunded: 80
    } as any);

    const res = await sendPaymentWebhook(mpPaymentId);
    expect(res.status).toBe(204);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(payment.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
    expect(payment.refundedAmountCents).toBe(8000);
  });

  it("reembolso total: continua marcando REFUNDED com o valor cheio", async () => {
    const { booking, mpPaymentId } = await createCapturedBooking(12000);

    vi.spyOn(Payment.prototype, "get").mockResolvedValue({
      id: mpPaymentId,
      status: "refunded",
      status_detail: "refunded",
      transaction_amount_refunded: 120
    } as any);

    const res = await sendPaymentWebhook(mpPaymentId);
    expect(res.status).toBe(204);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(payment.status).toBe(PaymentStatus.REFUNDED);
    expect(payment.refundedAmountCents).toBe(12000);
  });

  it("reembolso parcial seguido de reembolso total (2 webhooks): processa os dois, sem ficar preso no parcial", async () => {
    const { booking, mpPaymentId } = await createCapturedBooking(10000);

    const getSpy = vi.spyOn(Payment.prototype, "get");
    getSpy.mockResolvedValueOnce({
      id: mpPaymentId,
      status: "refunded",
      status_detail: "partially_refunded",
      transaction_amount_refunded: 30
    } as any);

    const first = await sendPaymentWebhook(mpPaymentId);
    expect(first.status).toBe(204);
    const afterFirst = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(afterFirst.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
    expect(afterFirst.refundedAmountCents).toBe(3000);

    getSpy.mockResolvedValueOnce({
      id: mpPaymentId,
      status: "refunded",
      status_detail: "refunded",
      transaction_amount_refunded: 100
    } as any);

    const second = await sendPaymentWebhook(mpPaymentId);
    expect(second.status).toBe(204);
    const afterSecond = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(afterSecond.status).toBe(PaymentStatus.REFUNDED);
    expect(afterSecond.refundedAmountCents).toBe(10000);
  });
});
