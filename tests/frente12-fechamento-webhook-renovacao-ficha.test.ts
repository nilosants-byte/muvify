import "dotenv/config";
import { createHmac } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import { Payment } from "mercadopago";
import { ConsultancyContractStatus, ConsultancyPaymentStatus, ConsultancyRequestStatus } from "@prisma/client";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";

// Épico de Frentes (fechamento pós-Frente 12, verificação de completude):
// achado que o webhook de reembolso/chargeback direto no Mercado Pago nunca
// buscava TrainingPlan.renewalMpPaymentId - um estorno/contestação de uma
// RENOVAÇÃO de ficha (cobrança separada da inicial do contrato) caía no
// "não encontrado" e era silenciosamente ignorado. Também corrigido no mesmo
// lote: reembolso parcial->total sucessivo de ConsultancyContract via
// webhook, que travava no primeiro parcial (guard por status em vez de valor).

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
let offerId = "";

async function registerUser(prefix: string, displayName: string, role?: "PROVIDER") {
  const reg = await request(app)
    .post("/api/auth/register")
    .send({
      name: displayName,
      email: `${uid(prefix)}@test.com`,
      password: "Test1234",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
      ...(role ? { role } : {}),
      termsVersion: "2026.05",
      consentAccepted: true
    });
  return { userId: reg.body.user.id as string };
}

async function makeContract(paymentAmountCents: number, mpPaymentId: string) {
  const request2 = await prisma.consultancyRequest.create({
    data: {
      providerId,
      clientId,
      status: ConsultancyRequestStatus.ACCEPTED,
      quotedOfferId: offerId,
      responseDeadlineAt: new Date(),
      respondedAt: new Date(),
      clientDecisionAt: new Date()
    }
  });
  return prisma.consultancyContract.create({
    data: {
      requestId: request2.id,
      providerId,
      clientId,
      offerId,
      status: ConsultancyContractStatus.ACTIVE,
      paymentMethod: "CREDIT_CARD",
      paymentStatus: ConsultancyPaymentStatus.CAPTURED,
      paymentAmountCents,
      providerAmountCents: paymentAmountCents - 2000,
      platformAmountCents: 2000,
      billingCycle: "MONTHLY",
      kind: "ONLINE_CONSULTANCY",
      mpPaymentId: `mp_original_${uid("c")}`,
      paymentCapturedAt: new Date(),
      deliveryDeadlineAt: new Date(Date.now() + 30 * 24 * 3600_000),
      immediateExecutionAcknowledgedAt: new Date()
    }
  });
}

describe("Fechamento pós-Frente 12 — webhook de reembolso/chargeback alcança renovação de ficha", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const client = await registerUser("f12fx_client", "Fechamento Client");
    clientId = client.userId;
    const provider = await registerUser("f12fx_provider", "Fechamento Provider", "PROVIDER");
    providerUserId = provider.userId;

    const providerProfile = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Fechamento Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 15000,
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = providerProfile.id;

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "ONLINE_CONSULTANCY",
        title: `Consultoria ${uid("offer")}`,
        billingCycle: "MONTHLY",
        priceCents: 20000
      }
    });
    offerId = offer.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.disputeCase.deleteMany({ where: { clientId } });
    await prisma.trainingPlan.deleteMany({ where: { providerId } });
    await prisma.consultancyContract.deleteMany({ where: { clientId } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: offerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [clientId, providerUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.$disconnect();
  });

  it("reembolso total via webhook sobre renovação de ficha atualiza refundedAmountCents (antes era ignorado)", async () => {
    const contract = await makeContract(20000, `mp_orig_${uid("a")}`);
    const mpPaymentId = `mp_renewal_${uid("refund")}`;
    const plan = await prisma.trainingPlan.create({
      data: {
        providerId,
        contractId: contract.id,
        title: "Ficha renovada",
        isPrebuilt: false,
        renewalMpPaymentId: mpPaymentId
      }
    });

    vi.spyOn(Payment.prototype, "get").mockResolvedValue({
      id: mpPaymentId,
      status: "refunded",
      transaction_amount_refunded: 200
    } as any);

    const res = await sendPaymentWebhook(mpPaymentId);
    expect(res.status).toBe(204);

    const after = await prisma.trainingPlan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(after.refundedAmountCents).toBe(20000);
    expect(after.refundedAt).not.toBeNull();
  });

  it("chargeback via webhook sobre renovação de ficha abre DisputeCase (antes era silenciosamente ignorado)", async () => {
    const contract = await makeContract(15000, `mp_orig_${uid("b")}`);
    const mpPaymentId = `mp_renewal_${uid("chargeback")}`;
    const plan = await prisma.trainingPlan.create({
      data: {
        providerId,
        contractId: contract.id,
        title: "Ficha renovada 2",
        isPrebuilt: false,
        renewalMpPaymentId: mpPaymentId
      }
    });

    vi.spyOn(Payment.prototype, "get").mockResolvedValue({
      id: mpPaymentId,
      status: "charged_back"
    } as any);

    const res = await sendPaymentWebhook(mpPaymentId);
    expect(res.status).toBe(204);

    const dispute = await prisma.disputeCase.findFirst({ where: { trainingPlanId: plan.id, type: "CHARGEBACK" } });
    expect(dispute).not.toBeNull();
    expect(dispute!.amountCents).toBe(15000);
    expect(dispute!.clientId).toBe(clientId);
  });

  it("reembolso parcial seguido de complemento até 100% não trava mais no primeiro parcial (ConsultancyContract)", async () => {
    const mpPaymentId = `mp_seq_${uid("partial")}`;
    const contract = await makeContract(30000, mpPaymentId);
    await prisma.consultancyContract.update({ where: { id: contract.id }, data: { mpPaymentId } });

    vi.spyOn(Payment.prototype, "get").mockResolvedValue({
      id: mpPaymentId,
      status: "refunded",
      transaction_amount_refunded: 100 // parcial: 10000 de 30000
    } as any);
    let res = await sendPaymentWebhook(mpPaymentId);
    expect(res.status).toBe(204);

    let after = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(after.paymentStatus).toBe(ConsultancyPaymentStatus.PARTIALLY_REFUNDED);
    expect(after.refundedAmountCents).toBe(10000);

    // Segunda notificação: reembolso complementar fecha em 100%. Antes da
    // correção, o guard "paymentStatus: notIn [REFUNDED, PARTIALLY_REFUNDED]"
    // já excluía este contrato (que virou PARTIALLY_REFUNDED acima) e essa
    // segunda notificação era descartada silenciosamente.
    vi.spyOn(Payment.prototype, "get").mockResolvedValue({
      id: mpPaymentId,
      status: "refunded",
      transaction_amount_refunded: 300 // total: 30000 de 30000
    } as any);
    res = await sendPaymentWebhook(mpPaymentId);
    expect(res.status).toBe(204);

    after = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(after.paymentStatus).toBe(ConsultancyPaymentStatus.REFUNDED);
    expect(after.refundedAmountCents).toBe(30000);
  });
});
