import "dotenv/config";
import { createHmac } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import { PaymentRefund, Payment } from "mercadopago";
import {
  ConsultancyContractStatus,
  ConsultancyPaymentStatus,
  OfferBillingCycle,
  ServiceOfferKind,
  UserRole
} from "@prisma/client";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { DisputeCaseService } from "../src/modules/admin/services/dispute-case.service";
import { AdminService } from "../src/modules/admin/services/admin.service";
import { FinancialService } from "../src/modules/financial/services/financial.service";

// Épico de Frentes, Frente 12 (Revisão geral do fluxo de pagamentos), Lote 1:
// reembolso PARCIAL de consultoria/renovação de ficha virava REFUNDED igual
// a um reembolso total - o contrato/ficha inteiro sumia da receita (Dashboard,
// Extrato/CSV, painel admin) em vez de só a fração devolvida. Cobre os dois
// caminhos que gravam refund (resolução manual do admin e webhook direto da
// Mercado Pago) e as telas que leem essa receita.

const disputeCaseService = new DisputeCaseService();
const adminService = new AdminService();
const financialService = new FinancialService();

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

let categoryId = "";
let adminId = "";
let clientId = "";

const providerUserIds: string[] = [];
const providerIds: string[] = [];
const offerIds: string[] = [];
const requestIds: string[] = [];
const contractIds: string[] = [];
const trainingPlanIds: string[] = [];

async function makeProvider(name: string) {
  const providerUser = await prisma.user.create({
    data: {
      name,
      email: `${uid("f12l1_provider")}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${providerUserIds.length}`,
      role: UserRole.PROVIDER
    }
  });
  providerUserIds.push(providerUser.id);

  const provider = await prisma.providerProfile.create({
    data: {
      userId: providerUser.id,
      displayName: name,
      bio: "test",
      experienceYears: 3,
      priceCents: 10000,
      mpAccountId: "555666777",
      crefValidationStatus: "APPROVED"
    }
  });
  providerIds.push(provider.id);

  return { providerUserId: providerUser.id, providerId: provider.id };
}

async function makeConsultancyContract(providerId: string, opts: { paymentAmountCents: number; mpPaymentId: string }) {
  const offer = await prisma.providerServiceOffer.create({
    data: {
      providerId,
      kind: ServiceOfferKind.ONLINE_CONSULTANCY,
      title: `Consultoria ${uid("offer")}`,
      billingCycle: OfferBillingCycle.MONTHLY,
      priceCents: opts.paymentAmountCents
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
  requestIds.push(request.id);

  const providerAmountCents = Math.round(opts.paymentAmountCents * 0.9);
  const platformAmountCents = opts.paymentAmountCents - providerAmountCents;

  const contract = await prisma.consultancyContract.create({
    data: {
      requestId: request.id,
      providerId,
      clientId,
      offerId: offer.id,
      status: ConsultancyContractStatus.ACTIVE,
      paymentStatus: ConsultancyPaymentStatus.CAPTURED,
      paymentAmountCents: opts.paymentAmountCents,
      providerAmountCents,
      platformAmountCents,
      billingCycle: offer.billingCycle,
      kind: offer.kind,
      mpPaymentId: opts.mpPaymentId,
      deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      immediateExecutionAcknowledgedAt: new Date(),
      paymentCapturedAt: new Date()
    }
  });
  contractIds.push(contract.id);
  return { contract, providerAmountCents, platformAmountCents };
}

describe("Frente 12, Lote 1 — reembolso parcial de consultoria/renovação não zera a receita inteira", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `F12L1_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Doze Lote Um",
        email: `${uid("f12l1_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}9`,
        role: UserRole.CLIENT
      }
    });
    clientId = client.id;

    const adminEmail = env.ADMIN_ALLOWED_EMAILS[0];
    let admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!admin) {
      admin = await prisma.user.create({
        data: {
          name: "Frente Doze Lote Um Admin",
          email: adminEmail,
          password: "x",
          phone: `11${Date.now().toString().slice(-9)}8`,
          role: "CLIENT"
        }
      });
    }
    adminId = admin.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.disputeCase.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.trainingPlan.deleteMany({ where: { id: { in: trainingPlanIds } } });
    await prisma.consultancyContract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: [...providerUserIds, clientId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [...providerUserIds, clientId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("disputa de consultoria resolvida com reembolso PARCIAL vira PARTIALLY_REFUNDED e desconta só a fração", async () => {
    const { providerUserId, providerId } = await makeProvider("Profissional Consultoria Parcial");
    const mpPaymentId = `mp_${uid("contract")}`;
    const { contract, providerAmountCents, platformAmountCents } = await makeConsultancyContract(providerId, {
      paymentAmountCents: 20000,
      mpPaymentId
    });

    const before = await financialService.getDashboard(providerUserId);
    expect(before.appRevenueCents).toBe(20000);

    vi.spyOn(PaymentRefund.prototype, "create").mockResolvedValue({ id: 10 } as any);
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "DELIVERY_CONTESTED", clientId, providerId, consultancyContractId: contract.id, amountCents: 20000, mpPaymentId }
    });
    await disputeCaseService.resolveCase(adminId, disputeCase.id, {
      resolution: "REFUNDED",
      amountCents: 8000,
      note: "Reembolso parcial da consultoria."
    });

    const contractAfter = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(contractAfter.paymentStatus).toBe(ConsultancyPaymentStatus.PARTIALLY_REFUNDED);
    expect(contractAfter.refundedAmountCents).toBe(8000);

    // Continua contando os 12000 restantes, não sumiu inteiro nem ficou intacto.
    const after = await financialService.getDashboard(providerUserId);
    expect(after.appRevenueCents).toBe(12000);

    // Extrato/CSV (buildPayoutsData): a linha continua aparecendo, com
    // líquido/comissão proporcionais e o valor estornado explícito.
    const payouts = await financialService.getPayouts(providerUserId);
    const row = payouts.payments.find((p) => p.id === contract.id);
    expect(row).toBeTruthy();
    expect(row!.refundedAmountCents).toBe(8000);
    expect(row!.providerAmountCents).toBe(Math.round(providerAmountCents * 0.6));
    expect(row!.platformFeeCents).toBe(Math.round(platformAmountCents * 0.6));
    expect(row!.status).toBe(ConsultancyPaymentStatus.PARTIALLY_REFUNDED);
  });

  it("disputa de renovação de ficha resolvida com reembolso PARCIAL desconta só a fração devolvida", async () => {
    const { providerUserId, providerId } = await makeProvider("Profissional Renovacao Parcial");
    const originalMpPaymentId = `mp_${uid("contract")}`;
    const { contract } = await makeConsultancyContract(providerId, { paymentAmountCents: 15000, mpPaymentId: originalMpPaymentId });
    // 1ª cobrança fora do mês corrente - só a renovação abaixo deve entrar na
    // receita testada.
    await prisma.consultancyContract.update({
      where: { id: contract.id },
      data: { paymentCapturedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) }
    });

    const renewalMpPaymentId = `mp_${uid("renewal")}`;
    const plan = await prisma.trainingPlan.create({
      data: { providerId, contractId: contract.id, title: "Ficha renovada", renewalMpPaymentId }
    });
    trainingPlanIds.push(plan.id);

    const before = await financialService.getDashboard(providerUserId);
    expect(before.appRevenueCents).toBe(15000);

    vi.spyOn(PaymentRefund.prototype, "create").mockResolvedValue({ id: 11 } as any);
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "DELIVERY_CONTESTED", clientId, providerId, trainingPlanId: plan.id, amountCents: 15000, mpPaymentId: renewalMpPaymentId }
    });
    await disputeCaseService.resolveCase(adminId, disputeCase.id, {
      resolution: "REFUNDED",
      amountCents: 5000,
      note: "Entrega contestada, reembolso parcial."
    });

    const planAfter = await prisma.trainingPlan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(planAfter.refundedAt).toBeTruthy();
    expect(planAfter.refundedAmountCents).toBe(5000);

    const after = await financialService.getDashboard(providerUserId);
    expect(after.appRevenueCents).toBe(10000);
  });

  it("webhook de reembolso parcial da consultoria (chargeback direto na MP) marca PARTIALLY_REFUNDED com o valor real", async () => {
    const { providerId } = await makeProvider("Profissional Consultoria Webhook Parcial");
    const mpPaymentId = `mp_${uid("contract")}`;
    const { contract } = await makeConsultancyContract(providerId, { paymentAmountCents: 10000, mpPaymentId });

    vi.spyOn(Payment.prototype, "get").mockResolvedValue({
      id: mpPaymentId,
      status: "refunded",
      status_detail: "partially_refunded",
      transaction_amount_refunded: 40
    } as any);

    const res = await sendPaymentWebhook(mpPaymentId);
    expect(res.status).toBe(204);

    const contractAfter = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(contractAfter.paymentStatus).toBe(ConsultancyPaymentStatus.PARTIALLY_REFUNDED);
    expect(contractAfter.refundedAmountCents).toBe(4000);
  });

  it("webhook de reembolso TOTAL da consultoria continua marcando REFUNDED (regressão)", async () => {
    const { providerId } = await makeProvider("Profissional Consultoria Webhook Total");
    const mpPaymentId = `mp_${uid("contract")}`;
    const { contract } = await makeConsultancyContract(providerId, { paymentAmountCents: 10000, mpPaymentId });

    vi.spyOn(Payment.prototype, "get").mockResolvedValue({
      id: mpPaymentId,
      status: "refunded",
      status_detail: "refunded",
      transaction_amount_refunded: 100
    } as any);

    const res = await sendPaymentWebhook(mpPaymentId);
    expect(res.status).toBe(204);

    const contractAfter = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(contractAfter.paymentStatus).toBe(ConsultancyPaymentStatus.REFUNDED);
    expect(contractAfter.refundedAmountCents).toBe(10000);
  });

  it("painel geral do admin também desconta o reembolso parcial da receita/comissão da plataforma", async () => {
    const { providerId } = await makeProvider("Profissional Consultoria Admin Dashboard");
    const mpPaymentId = `mp_${uid("contract")}`;
    const { contract, platformAmountCents } = await makeConsultancyContract(providerId, {
      paymentAmountCents: 10000,
      mpPaymentId
    });

    const before = await adminService.getDashboardOverview(adminId, {});
    const revenueBefore = before.attentionNeeded.revenueThisMonthCents;

    vi.spyOn(PaymentRefund.prototype, "create").mockResolvedValue({ id: 12 } as any);
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "DELIVERY_CONTESTED", clientId, providerId, consultancyContractId: contract.id, amountCents: 10000, mpPaymentId }
    });
    await disputeCaseService.resolveCase(adminId, disputeCase.id, {
      resolution: "REFUNDED",
      amountCents: 4000,
      note: "Reembolso parcial."
    });

    const after = await adminService.getDashboardOverview(adminId, {});
    // Receita cai só o valor reembolsado (6000 continuam contando), não os
    // 10000 inteiros.
    expect(revenueBefore - after.attentionNeeded.revenueThisMonthCents).toBe(4000);
    // Comissão cai proporcionalmente (60% do valor original), não o valor
    // cheio nem fica intacta.
    const commissionDrop = before.attentionNeeded.commissionThisMonthCents - after.attentionNeeded.commissionThisMonthCents;
    expect(commissionDrop).toBeGreaterThan(0);
    expect(commissionDrop).toBeLessThan(platformAmountCents);
  });
});
