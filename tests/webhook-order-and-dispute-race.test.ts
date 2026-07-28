import "dotenv/config";
import { createHmac } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import { Payment, PaymentRefund } from "mercadopago";
import { BookingStatus, PaymentMethod, PaymentStatus, ConsultancyContractStatus, ConsultancyPaymentStatus, ConsultancyRequestStatus } from "@prisma/client";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { DisputeCaseService } from "../src/modules/admin/services/dispute-case.service";

// Raio-X de pagamentos, Rodada 3, Lote 1: um webhook de recusa/cancelamento
// ATRASADO (a MP reenvia eventos fora de ordem) não pode reverter um
// pagamento/contrato que já foi resolvido de verdade por um evento mais
// novo. E dois admins resolvendo o mesmo caso de disputa ao mesmo tempo não
// podem gerar reembolso ou dívida duplicados.

const disputeCaseService = new DisputeCaseService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function sign(secret: string, dataId: string, requestId: string, ts: string) {
  const message = `id:${dataId};request-id:${requestId};ts:${ts};`;
  return createHmac("sha256", secret).update(message).digest("hex");
}

async function sendPaymentWebhook(mpPaymentId: string) {
  const requestId = `req_${mpPaymentId}_${Math.random().toString(36).slice(2, 6)}`;
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
let adminId = "";
const offerIds: string[] = [];
const bookingIds: string[] = [];
const contractIds: string[] = [];

async function registerUser(prefix: string, displayName: string, role?: "PROVIDER", email?: string) {
  const reg = await request(app)
    .post("/api/auth/register")
    .send({
      name: displayName,
      email: email ?? `${uid(prefix)}@test.com`,
      password: "Test1234",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
      ...(role ? { role } : {}),
      termsVersion: "2026.05",
      consentAccepted: true
    });
  return { userId: reg.body.user.id as string };
}

describe("Webhook fora de ordem e corrida em resolveCase (Rodada 3, Lote 1)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `WO_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await registerUser("wo_client", "WO Client");
    clientId = client.userId;

    const provider = await registerUser("wo_provider", "WO Provider", "PROVIDER");
    providerUserId = provider.userId;

    // O e-mail admin e compartilhado com outros arquivos de teste rodando em
    // paralelo (so existe 1 na allowlist) — se outro arquivo ja registrou
    // primeiro, reaproveita a conta existente em vez de falhar.
    const adminReg = await registerUser("wo_admin", "WO Admin", undefined, env.ADMIN_ALLOWED_EMAILS[0]).catch(() => null);
    adminId = adminReg?.userId ?? (await prisma.user.findUniqueOrThrow({ where: { email: env.ADMIN_ALLOWED_EMAILS[0] } })).id;

    const providerProfile = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "WO Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 15000,
        mpAccountId: "777888999",
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = providerProfile.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.disputeCase.deleteMany({ where: { clientId } });
    await prisma.consultancyContract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.payment.deleteMany({ where: { booking: { id: { in: bookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [clientId, providerUserId] } } });
    // writeAdminAuditLog é fire-and-forget (void) em resolveCase — a escrita
    // pode ainda estar em andamento quando os testes terminam, então limpa
    // por último (não no início) e ignora se ainda não houver nada a apagar.
    await prisma.adminAuditLog.deleteMany({ where: { adminId } });
    // Não apaga a conta admin: o e-mail é compartilhado com outros arquivos
    // de teste rodando em paralelo — apagar aqui pode derrubar outro arquivo
    // no meio do próprio teste.
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("webhook de recusa atrasado não rebaixa um pagamento de booking já CAPTURED", async () => {
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        priceCents: 15000,
        status: BookingStatus.CONFIRMED
      }
    });
    bookingIds.push(booking.id);

    const mpPaymentId = `mp_${uid("late")}`;
    await prisma.payment.create({
      data: {
        bookingId: booking.id,
        amountCents: 15000,
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.CAPTURED,
        mpPaymentId,
        capturedAt: new Date()
      }
    });

    // Simula um evento antigo de "recusado" chegando DEPOIS que o pagamento
    // já foi confirmado (reenvio fora de ordem, comportamento real da MP).
    vi.spyOn(Payment.prototype, "get").mockResolvedValue({
      id: mpPaymentId,
      status: "rejected",
      status_detail: "cc_rejected_other_reason"
    } as any);

    const res = await sendPaymentWebhook(mpPaymentId);
    expect(res.status).toBe(204);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(payment.status).toBe(PaymentStatus.CAPTURED);
  });

  it("webhook de recusa atrasado não reabre um contrato de consultoria já CAPTURED", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "ONLINE_CONSULTANCY",
        title: `Consultoria ${uid("offer")}`,
        billingCycle: "MONTHLY",
        priceCents: 20000
      }
    });
    offerIds.push(offer.id);

    const consultancyRequest = await prisma.consultancyRequest.create({
      data: {
        providerId,
        clientId,
        status: ConsultancyRequestStatus.ACCEPTED,
        quotedOfferId: offer.id,
        responseDeadlineAt: new Date(),
        respondedAt: new Date(),
        clientDecisionAt: new Date()
      }
    });

    const mpPaymentId = `mp_${uid("latecontract")}`;
    const contract = await prisma.consultancyContract.create({
      data: {
        requestId: consultancyRequest.id,
        providerId,
        clientId,
        offerId: offer.id,
        status: ConsultancyContractStatus.ACTIVE,
        paymentMethod: "CREDIT_CARD",
        paymentStatus: ConsultancyPaymentStatus.CAPTURED,
        paymentAmountCents: 20000,
        providerAmountCents: 18000,
        platformAmountCents: 2000,
        mpPaymentId,
        paymentCapturedAt: new Date(),
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date()
      }
    });
    contractIds.push(contract.id);

    vi.spyOn(Payment.prototype, "get").mockResolvedValue({
      id: mpPaymentId,
      status: "cancelled",
      status_detail: "by_collector"
    } as any);

    const res = await sendPaymentWebhook(mpPaymentId);
    expect(res.status).toBe(204);

    const afterWebhook = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(afterWebhook.status).toBe(ConsultancyContractStatus.ACTIVE);
    expect(afterWebhook.paymentStatus).toBe(ConsultancyPaymentStatus.CAPTURED);

    const afterWebhookRequest = await prisma.consultancyRequest.findUniqueOrThrow({ where: { id: consultancyRequest.id } });
    expect(afterWebhookRequest.status).toBe(ConsultancyRequestStatus.ACCEPTED);
  });

  it("duas resoluções concorrentes do mesmo caso: só uma vence, sem reembolso duplicado", async () => {
    const refundSpy = vi.spyOn(PaymentRefund.prototype, "create").mockResolvedValue({ id: 999 } as any);

    const disputeCase = await prisma.disputeCase.create({
      data: {
        type: "REFUND_FAILED",
        clientId,
        providerId,
        amountCents: 10000,
        mpPaymentId: `mp_${uid("race")}`
      }
    });

    const [r1, r2] = await Promise.allSettled([
      disputeCaseService.resolveCase(adminId, disputeCase.id, { resolution: "REFUNDED", note: "Resolução A" }),
      disputeCaseService.resolveCase(adminId, disputeCase.id, { resolution: "REFUNDED", note: "Resolução B" })
    ]);

    const statuses = [r1.status, r2.status];
    expect(statuses.filter((s) => s === "fulfilled")).toHaveLength(1);
    expect(statuses.filter((s) => s === "rejected")).toHaveLength(1);
    expect(refundSpy).toHaveBeenCalledTimes(1);

    const debts = await prisma.debtRecord.findMany({ where: { disputeCaseId: disputeCase.id } });
    expect(debts).toHaveLength(1);

    const finalCase = await prisma.disputeCase.findUniqueOrThrow({ where: { id: disputeCase.id } });
    expect(finalCase.status).toBe("RESOLVED");

    await prisma.debtRecord.deleteMany({ where: { disputeCaseId: disputeCase.id } });
  });

  it("se a resolução falha no meio (ex: reembolso rejeitado pela MP), a trava é liberada e uma nova tentativa funciona", async () => {
    const disputeCase = await prisma.disputeCase.create({
      data: {
        type: "REFUND_FAILED",
        clientId,
        providerId,
        amountCents: 5000,
        mpPaymentId: `mp_${uid("retry")}`
      }
    });

    vi.spyOn(PaymentRefund.prototype, "create").mockRejectedValueOnce(new Error("MP indisponível"));

    await expect(
      disputeCaseService.resolveCase(adminId, disputeCase.id, { resolution: "REFUNDED", note: "primeira tentativa" })
    ).rejects.toThrow();

    const afterFailure = await prisma.disputeCase.findUniqueOrThrow({ where: { id: disputeCase.id } });
    expect(afterFailure.status).toBe("OPEN");

    vi.spyOn(PaymentRefund.prototype, "create").mockResolvedValueOnce({ id: 1234 } as any);
    const resolved = await disputeCaseService.resolveCase(adminId, disputeCase.id, {
      resolution: "REFUNDED",
      note: "segunda tentativa, funcionou"
    });
    expect(resolved.status).toBe("RESOLVED");

    await prisma.debtRecord.deleteMany({ where: { disputeCaseId: disputeCase.id } });
  });
});
