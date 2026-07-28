import "dotenv/config";
import { createHmac } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { Payment, PaymentRefund } from "mercadopago";
import { BookingStatus, PaymentMethod, PaymentStatus } from "@prisma/client";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { DisputeCaseService } from "../src/modules/admin/services/dispute-case.service";

// Fase 6: fila unica de disputas (DisputeCase). Cobre as 3 fontes automaticas
// (falta contestada, chargeback, reembolso automatico que falha) e a
// resolucao manual pelo admin (reembolso parcial/total ou negativa).

const disputeCaseService = new DisputeCaseService();

vi.spyOn(PaymentRefund.prototype, "create").mockImplementation(async ({ payment_id, body }: any) => ({
  id: 999,
  payment_id: Number(payment_id),
  amount: body?.amount
} as any));

const PASSWORD = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function sign(secret: string, dataId: string, requestId: string, ts: string) {
  const message = `id:${dataId};request-id:${requestId};ts:${ts};`;
  return createHmac("sha256", secret).update(message).digest("hex");
}

async function sendChargebackWebhook(mpPaymentId: string) {
  const requestId = `req_${mpPaymentId}`;
  const ts = Date.now().toString();
  const v1 = sign(env.MP_WEBHOOK_SECRET!, mpPaymentId, requestId, ts);

  return request(app)
    .post("/api/payments/webhook")
    .set("Content-Type", "application/json")
    .query({ "data.id": mpPaymentId })
    .set("x-request-id", requestId)
    .set("x-signature", `ts=${ts},v1=${v1}`)
    .send(JSON.stringify({ topic: "chargebacks", data: { id: mpPaymentId } }));
}

let clientToken = "";
let providerToken = "";
let clientId = "";
let providerUserId = "";
let providerId = "";
let adminId = "";
let categoryId = "";

async function registerUser(prefix: string, displayName: string, role?: "PROVIDER", email?: string) {
  const reg = await request(app)
    .post("/api/auth/register")
    .send({
      name: displayName,
      email: email ?? `${uid(prefix)}@test.com`,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
      ...(role ? { role } : {}),
      termsVersion: "2026.05",
      consentAccepted: true
    });
  return { token: reg.body.accessToken as string, userId: reg.body.user.id as string };
}

describe("DisputeCase — fila de disputas (Fase 6)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `DC_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await registerUser("dc_client", "DC Client");
    clientToken = client.token;
    clientId = client.userId;

    const provider = await registerUser("dc_provider", "DC Provider", "PROVIDER");
    providerToken = provider.token;
    providerUserId = provider.userId;

    // Nao precisa de e-mail verificado: DisputeCaseService.ensureAdminAccess
    // so confere se o e-mail esta na allowlist (ADMIN_ALLOWED_EMAILS), nao
    // depende do role efetivo calculado no login/JWT.
    // O e-mail admin e compartilhado com outros arquivos de teste rodando em
    // paralelo (so existe 1 na allowlist) — se outro arquivo ja registrou
    // primeiro, reaproveita a conta existente em vez de falhar.
    const adminReg = await registerUser("dc_admin", "DC Admin", undefined, env.ADMIN_ALLOWED_EMAILS[0]).catch(() => null);
    adminId = adminReg?.userId ?? (await prisma.user.findUniqueOrThrow({ where: { email: env.ADMIN_ALLOWED_EMAILS[0] } })).id;

    const profile = await request(app)
      .post("/api/providers/profile")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({
        displayName: "DC Provider",
        bio: "Provider de teste para disputas",
        experienceYears: 3,
        priceCents: 10000,
        categoryIds: [categoryId]
      });
    providerId = profile.body.id;
  });

  afterAll(async () => {
    await prisma.adminAuditLog.deleteMany({ where: { adminId } });
    await prisma.disputeCase.deleteMany({ where: { clientId } });
    await prisma.noShowReport.deleteMany({ where: { reportedByUserId: clientId } });
    await prisma.payment.deleteMany({ where: { booking: { clientId } } });
    await prisma.booking.deleteMany({ where: { clientId } });
    await prisma.providerCategory.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [clientId, providerUserId] } } });
    // Nao apaga a conta admin: o e-mail e compartilhado com outros arquivos
    // de teste rodando em paralelo — apagar aqui pode derrubar outro arquivo
    // no meio do proprio teste.
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
    vi.restoreAllMocks();
  });

  it("contestar um relato de falta cria um DisputeCase com o motivo de cada lado", async () => {
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 60 * 60 * 1000),
        priceCents: 8000,
        status: BookingStatus.CONFIRMED
      }
    });

    const reportRes = await request(app)
      .post(`/api/bookings/${booking.id}/report-no-show`)
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ reportReason: "O profissional não apareceu no horário combinado." });
    expect(reportRes.status).toBe(200);

    const contestRes = await request(app)
      .post(`/api/bookings/${booking.id}/contest-no-show`)
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ contestReason: "Eu estava no local, o cliente que não veio." });
    expect(contestRes.status).toBe(200);
    expect(contestRes.body.status).toBe("CONTESTED");

    const report = await prisma.noShowReport.findUnique({ where: { bookingId: booking.id } });
    expect(report?.reportReason).toBe("O profissional não apareceu no horário combinado.");
    expect(report?.contestReason).toBe("Eu estava no local, o cliente que não veio.");

    const disputeCase = await prisma.disputeCase.findFirst({ where: { bookingId: booking.id } });
    expect(disputeCase).not.toBeNull();
    expect(disputeCase?.type).toBe("NO_SHOW_CONTESTED");
    expect(disputeCase?.status).toBe("OPEN");
    expect(disputeCase?.clientId).toBe(clientId);
    expect(disputeCase?.providerId).toBe(providerId);
    expect(disputeCase?.amountCents).toBe(8000);
    expect(disputeCase?.noShowReportId).toBe(report?.id);
  });

  it("um chargeback (webhook da MP) cria um DisputeCase de forma idempotente", async () => {
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        priceCents: 15000,
        status: BookingStatus.COMPLETED
      }
    });

    const mpPaymentId = `mp_${uid("cb")}`;
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

    const getSpy = vi.spyOn(Payment.prototype, "get").mockImplementation(async () => ({
      id: mpPaymentId,
      status: "charged_back",
      status_detail: "chargeback"
    } as any));

    const first = await sendChargebackWebhook(mpPaymentId);
    expect(first.status).toBe(204);

    const casesAfterFirst = await prisma.disputeCase.findMany({ where: { mpPaymentId, type: "CHARGEBACK" } });
    expect(casesAfterFirst).toHaveLength(1);
    expect(casesAfterFirst[0]?.clientId).toBe(clientId);
    expect(casesAfterFirst[0]?.providerId).toBe(providerId);
    expect(casesAfterFirst[0]?.amountCents).toBe(15000);
    expect(casesAfterFirst[0]?.bookingId).toBe(booking.id);

    // MP reenvia o mesmo webhook — nao deve duplicar o caso.
    const second = await sendChargebackWebhook(mpPaymentId);
    expect(second.status).toBe(204);
    const casesAfterSecond = await prisma.disputeCase.findMany({ where: { mpPaymentId, type: "CHARGEBACK" } });
    expect(casesAfterSecond).toHaveLength(1);

    getSpy.mockRestore();
  });

  it("admin resolve com reembolso parcial: chama o refund da MP e notifica com o motivo", async () => {
    const disputeCase = await prisma.disputeCase.create({
      data: {
        type: "CHARGEBACK",
        clientId,
        providerId,
        amountCents: 10000,
        mpPaymentId: `mp_${uid("resolve")}`
      }
    });

    const resolved = await disputeCaseService.resolveCase(adminId, disputeCase.id, {
      resolution: "REFUNDED",
      amountCents: 4000,
      note: "Reembolso parcial acordado entre as partes."
    });

    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.resolution).toBe("REFUNDED");
    expect(resolved.resolvedAmountCents).toBe(4000);
    expect(resolved.resolutionNote).toBe("Reembolso parcial acordado entre as partes.");
    expect(resolved.resolvedByAdminId).toBe(adminId);
  });

  it("admin resolve negando o reembolso: não chama o refund da MP", async () => {
    const refundSpy = vi.spyOn(PaymentRefund.prototype, "create");
    refundSpy.mockClear();

    const disputeCase = await prisma.disputeCase.create({
      data: {
        type: "REFUND_FAILED",
        clientId,
        providerId,
        amountCents: 5000
      }
    });

    const resolved = await disputeCaseService.resolveCase(adminId, disputeCase.id, {
      resolution: "DENIED",
      note: "Evidências indicam que o serviço foi prestado normalmente."
    });

    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.resolution).toBe("DENIED");
    expect(resolved.resolvedAmountCents).toBeNull();
    expect(refundSpy).not.toHaveBeenCalled();
  });

  it("rejeita reembolso sem pagamento vinculado (mpPaymentId nulo)", async () => {
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", clientId, providerId, amountCents: 5000 }
    });

    await expect(
      disputeCaseService.resolveCase(adminId, disputeCase.id, { resolution: "REFUNDED", note: "teste" })
    ).rejects.toThrow();
  });

  it("rejeita reembolso maior que o valor original do caso", async () => {
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "CHARGEBACK", clientId, providerId, amountCents: 5000, mpPaymentId: `mp_${uid("cap")}` }
    });

    await expect(
      disputeCaseService.resolveCase(adminId, disputeCase.id, {
        resolution: "REFUNDED",
        amountCents: 9000,
        note: "teste"
      })
    ).rejects.toThrow();
  });

  it("rejeita resolver um caso que já foi resolvido", async () => {
    const disputeCase = await prisma.disputeCase.create({
      data: {
        type: "REFUND_FAILED",
        clientId,
        providerId,
        amountCents: 5000,
        status: "RESOLVED",
        resolution: "DENIED",
        resolutionNote: "já resolvido",
        resolvedAt: new Date()
      }
    });

    await expect(
      disputeCaseService.resolveCase(adminId, disputeCase.id, { resolution: "DENIED", note: "teste" })
    ).rejects.toThrow();
  });

  it("admin resolve um caso de falta contestada: o NoShowReport vinculado também vira RESOLVED", async () => {
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 60 * 60 * 1000),
        priceCents: 8000,
        status: BookingStatus.CONFIRMED
      }
    });

    await request(app)
      .post(`/api/bookings/${booking.id}/report-no-show`)
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ reportReason: "O profissional não apareceu no horário combinado." });

    await request(app)
      .post(`/api/bookings/${booking.id}/contest-no-show`)
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ contestReason: "Eu estava no local, o cliente que não veio." });

    const report = await prisma.noShowReport.findUnique({ where: { bookingId: booking.id } });
    expect(report?.status).toBe("CONTESTED");

    const disputeCase = await prisma.disputeCase.findFirst({ where: { bookingId: booking.id } });
    expect(disputeCase?.noShowReportId).toBe(report?.id);

    await disputeCaseService.resolveCase(adminId, disputeCase!.id, {
      resolution: "DENIED",
      note: "Evidências indicam que o profissional compareceu."
    });

    const reportAfter = await prisma.noShowReport.findUnique({ where: { bookingId: booking.id } });
    expect(reportAfter?.status).toBe("RESOLVED");
    expect(reportAfter?.resolvedAt).not.toBeNull();
  });

  it("nega acesso a quem não está na allowlist de admin", async () => {
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", clientId, providerId, amountCents: 5000 }
    });

    await expect(disputeCaseService.getCaseDetail(clientId, disputeCase.id)).rejects.toThrow();
  });

  it("admin resolve com reembolso total: sincroniza o Payment local pra REFUNDED", async () => {
    // Raio-X de pagamentos, Rodada 2, Lote 2: antes, o Payment local ficava
    // CAPTURED pra sempre mesmo depois do admin estornar de verdade no MP.
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        priceCents: 12000,
        status: BookingStatus.COMPLETED
      }
    });
    const mpPaymentId = `mp_${uid("sync")}`;
    await prisma.payment.create({
      data: {
        bookingId: booking.id,
        amountCents: 12000,
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.CAPTURED,
        mpPaymentId,
        capturedAt: new Date()
      }
    });
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", clientId, providerId, amountCents: 12000, mpPaymentId, bookingId: booking.id }
    });

    await disputeCaseService.resolveCase(adminId, disputeCase.id, {
      resolution: "REFUNDED",
      note: "Estorno manual confirmado."
    });

    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(payment.status).toBe(PaymentStatus.REFUNDED);
    expect(payment.refundedAmountCents).toBe(12000);
    expect(payment.refundedAt).not.toBeNull();
  });

  it("admin resolve com reembolso parcial: sincroniza o Payment local pra PARTIALLY_REFUNDED", async () => {
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
    const mpPaymentId = `mp_${uid("sync2")}`;
    await prisma.payment.create({
      data: {
        bookingId: booking.id,
        amountCents: 10000,
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.CAPTURED,
        mpPaymentId,
        capturedAt: new Date()
      }
    });
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", clientId, providerId, amountCents: 10000, mpPaymentId, bookingId: booking.id }
    });

    await disputeCaseService.resolveCase(adminId, disputeCase.id, {
      resolution: "REFUNDED",
      amountCents: 4000,
      note: "Estorno parcial acordado."
    });

    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(payment.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
    expect(payment.refundedAmountCents).toBe(4000);
  });

  it("RETRY_CAPTURE: tenta capturar de novo um caso CAPTURE_FAILED e resolve como CAPTURED em caso de sucesso", async () => {
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        priceCents: 9000,
        status: BookingStatus.COMPLETED
      }
    });
    const mpPaymentId = `mp_${uid("retry")}`;
    await prisma.payment.create({
      data: {
        bookingId: booking.id,
        amountCents: 9000,
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.AUTHORIZED,
        mpPaymentId,
        authorizedAt: new Date()
      }
    });
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "CAPTURE_FAILED", clientId, providerId, amountCents: 9000, mpPaymentId, bookingId: booking.id }
    });

    vi.spyOn(Payment.prototype, "capture").mockResolvedValueOnce({} as any);

    const resolved = await disputeCaseService.resolveCase(adminId, disputeCase.id, {
      resolution: "RETRY_CAPTURE",
      note: "Cartão do cliente foi regularizado, tentando capturar de novo."
    });

    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.resolution).toBe("CAPTURED");
    expect(resolved.resolvedAmountCents).toBe(9000);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(payment.status).toBe(PaymentStatus.CAPTURED);
  });

  it("RETRY_CAPTURE: se a nova tentativa falhar de novo, o caso continua aberto", async () => {
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        priceCents: 7000,
        status: BookingStatus.COMPLETED
      }
    });
    const mpPaymentId = `mp_${uid("retryfail")}`;
    await prisma.payment.create({
      data: {
        bookingId: booking.id,
        amountCents: 7000,
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.AUTHORIZED,
        mpPaymentId,
        authorizedAt: new Date()
      }
    });
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "CAPTURE_FAILED", clientId, providerId, amountCents: 7000, mpPaymentId, bookingId: booking.id }
    });

    vi.spyOn(Payment.prototype, "capture").mockRejectedValueOnce(new Error("cartão recusado de novo"));

    await expect(
      disputeCaseService.resolveCase(adminId, disputeCase.id, {
        resolution: "RETRY_CAPTURE",
        note: "Tentando de novo."
      })
    ).rejects.toThrow(/também falhou/);

    const stillOpen = await prisma.disputeCase.findUniqueOrThrow({ where: { id: disputeCase.id } });
    expect(stillOpen.status).toBe("OPEN");
    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(payment.status).toBe(PaymentStatus.AUTHORIZED);
  });

  it("RETRY_CAPTURE: rejeita quando o caso não é do tipo CAPTURE_FAILED", async () => {
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", clientId, providerId, amountCents: 5000 }
    });

    await expect(
      disputeCaseService.resolveCase(adminId, disputeCase.id, { resolution: "RETRY_CAPTURE", note: "teste" })
    ).rejects.toThrow(/falha na captura/);
  });

  it("getCaseDetail inclui a ficha de treino em disputa quando o caso é vinculado a uma", async () => {
    const plan = await prisma.trainingPlan.create({
      data: {
        providerId,
        title: "Ficha de teste em disputa",
        isPrebuilt: false
      }
    });
    const disputeCase = await prisma.disputeCase.create({
      data: {
        type: "DELIVERY_CONTESTED",
        clientId,
        providerId,
        amountCents: 5000,
        trainingPlanId: plan.id,
        contextNote: "O treino entregue não corresponde ao combinado."
      }
    });

    const detail = await disputeCaseService.getCaseDetail(adminId, disputeCase.id);
    expect(detail.trainingPlan?.id).toBe(plan.id);
    expect(detail.trainingPlan?.title).toBe("Ficha de teste em disputa");
    expect(detail.contextNote).toBe("O treino entregue não corresponde ao combinado.");

    await prisma.disputeCase.deleteMany({ where: { id: disputeCase.id } });
    await prisma.trainingPlan.deleteMany({ where: { id: plan.id } });
  });

  it("getCaseDetail inclui a ciência de início imediato do agendamento, quando presente (Rodada 4, Lote 5)", async () => {
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 60 * 60 * 1000),
        priceCents: 8000,
        status: BookingStatus.CONFIRMED,
        immediateExecutionAcknowledgedAt: new Date()
      }
    });
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "NO_SHOW_CONTESTED", clientId, providerId, amountCents: 8000, bookingId: booking.id }
    });

    const detail = await disputeCaseService.getCaseDetail(adminId, disputeCase.id);
    expect(detail.booking?.immediateExecutionAcknowledgedAt).not.toBeNull();

    await prisma.disputeCase.deleteMany({ where: { id: disputeCase.id } });
    await prisma.booking.deleteMany({ where: { id: booking.id } });
  });

  it("lista e detalha casos com o contexto do agendamento (evidências, chat e no-show)", async () => {
    const list = await disputeCaseService.listCases(adminId, "OPEN");
    expect(Array.isArray(list)).toBe(true);
    expect(list.every((item) => item.status === "OPEN")).toBe(true);

    const anyCase = await prisma.disputeCase.findFirst({ where: { clientId } });
    const detail = await disputeCaseService.getCaseDetail(adminId, anyCase!.id);
    expect(detail.id).toBe(anyCase!.id);
  });
});
