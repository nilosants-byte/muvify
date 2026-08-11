import "dotenv/config";
import { createHmac, randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import { CardToken, Payment } from "mercadopago";
import { OfferBillingCycle, PresentialPackageMode, PresentialPackageStatus } from "@prisma/client";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";
import { ReviewService } from "../src/modules/reviews/services/review.service";
import { UserService } from "../src/modules/users/services/user.service";
import { encryptSensitiveText } from "../src/shared/utils/encryption";
import { hashValue } from "../src/shared/utils/hash";

// Frente 9 (segunda camada): consistência entre os fluxos irmãos
// presencial (booking avulso + pacote presencial) e online (consultoria).

const PASSWORD = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function registerUser(prefix: string, displayName: string) {
  const reg = await request(app)
    .post("/api/auth/register")
    .send({
      name: displayName,
      email: `${uid(prefix)}@test.com`,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
  return { token: reg.body.accessToken as string, userId: reg.body.user.id as string };
}

describe("Frente 9 (segunda camada), Lote 1 — presential-packages ganha rate limiter próprio", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("21 chamadas de cancelamento (mais que o limite de 20/hora) eventualmente batem em 429", async () => {
    const client = await registerUser("l1_pkg", "Lote Um Pacote");
    createdUserIds.push(client.userId);

    let sawRateLimited = false;
    for (let i = 0; i < 21; i += 1) {
      const response = await request(app)
        .post(`/api/presential-packages/${randomUUID()}/cancel`)
        .set("Authorization", `Bearer ${client.token}`);
      if (response.status === 429) sawRateLimited = true;
    }
    expect(sawRateLimited).toBe(true);
  }, 30000);
});

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

describe("Frente 9 (segunda camada), Lote 2 — chargeback de ciclo de pacote presencial já capturado abre disputa", () => {
  let clientId = "";
  let providerId = "";
  let categoryId = "";
  const packageIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    const category = await prisma.serviceCategory.create({ data: { name: `F9L2_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Nove Lote Dois",
        email: `${Date.now()}_f9l2_client@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;
    userIds.push(clientId);

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Nove Lote Dois",
        email: `${Date.now()}_f9l2_provider@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    userIds.push(providerUser.id);

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUser.id,
        displayName: "Profissional Frente Nove Lote Dois",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.disputeCase.deleteMany({ where: { clientId } });
    await prisma.presentialPackageCycle.deleteMany({ where: { packageId: { in: packageIds } } });
    await prisma.presentialPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("evento de chargeback sobre um ciclo já capturado (mpPaymentId salvo no ciclo, não mais pendente) abre DisputeCase", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "PRESENTIAL",
        title: `Presencial ${Date.now()}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 20000,
        presentialPackageMode: PresentialPackageMode.FIXED_RECURRING,
        presentialSessionsPerCycle: 4
      }
    });

    const pkg = await prisma.presentialPackage.create({
      data: {
        providerId,
        clientId,
        offerId: offer.id,
        categoryId,
        mode: PresentialPackageMode.FIXED_RECURRING,
        status: PresentialPackageStatus.ACTIVE,
        cycleAmountCents: 20000,
        billingCycle: OfferBillingCycle.MONTHLY,
        sessionsPerCycle: 4
      }
    });
    packageIds.push(pkg.id);

    const mpPaymentId = `mp_${Date.now()}_cycle_chargeback`;
    await prisma.presentialPackageCycle.create({
      data: {
        packageId: pkg.id,
        cycleIndex: 1,
        amountCents: 20000,
        sessionsGranted: 4,
        mpPaymentId,
        capturedAt: new Date(),
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 30 * 24 * 3600_000)
      }
    });

    // pendingChargeMpPaymentId já foi limpo há muito tempo (é assim que o
    // ciclo chega a "capturado") - é exatamente esse o cenário que o guard
    // antigo não reconhecia.
    vi.spyOn(Payment.prototype, "get").mockResolvedValue({
      id: mpPaymentId,
      status: "charged_back"
    } as any);

    const res = await sendPaymentWebhook(mpPaymentId);
    expect(res.status).toBe(204);

    const dispute = await prisma.disputeCase.findFirst({
      where: { presentialPackageCycleId: (await prisma.presentialPackageCycle.findFirstOrThrow({ where: { mpPaymentId } })).id }
    });
    expect(dispute).not.toBeNull();
    expect(dispute!.type).toBe("CHARGEBACK");
    expect(dispute!.amountCents).toBe(20000);
    expect(dispute!.clientId).toBe(clientId);
    expect(dispute!.presentialPackageId).toBe(pkg.id);
  });
});

describe("Frente 9 (segunda camada), Lote 3 — Pix pendente de consultoria persiste e aparece pro cliente", () => {
  const consultancyService = new ConsultancyService();
  let clientId = "";
  let providerUserId = "";
  let providerId = "";
  let categoryId = "";
  let offerId = "";

  beforeAll(async () => {
    const category = await prisma.serviceCategory.create({ data: { name: `F9L3_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Nove Lote Tres",
        email: `${Date.now()}_f9l3_client@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        emailVerifiedAt: new Date(),
        mpCustomerId: "cus_test_f9l3"
      }
    });
    clientId = client.id;

    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Nove Lote Tres",
        email: `${Date.now()}_f9l3_provider@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Nove Lote Tres",
        bio: "test",
        experienceYears: 3,
        priceCents: 20000,
        mpAccountId: "555444333",
        mpAccessToken: encryptSensitiveText("fake_access_token"),
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "ONLINE_CONSULTANCY",
        title: "Consultoria Pix",
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
    await prisma.trainingPlan.deleteMany({ where: { providerId } });
    await prisma.consultancyContract.deleteMany({ where: { clientId } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: offerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
  });

  it("aceitar proposta com Pix persiste QR/copia-e-cola no contrato e aparece em getMyTraining", async () => {
    vi.spyOn(Payment.prototype, "create").mockResolvedValue({
      id: 777,
      status: "pending",
      point_of_interaction: {
        transaction_data: {
          qr_code_base64: "data:image/png;base64,fake",
          qr_code: "00020126fakepixcode",
          ticket_url: "https://mp.example/ticket"
        }
      }
    } as any);

    const requestRow = await prisma.consultancyRequest.create({
      data: {
        providerId,
        clientId,
        status: "RESPONDED",
        quotedOfferId: offerId,
        responseDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        respondedAt: new Date()
      }
    });

    const { contract } = await consultancyService.decideRequest(clientId, requestRow.id, {
      decision: "ACCEPT",
      paymentMethod: "PIX" as any,
      acknowledgedImmediateExecution: true
    });

    expect(contract!.status).toBe("PENDING_PAYMENT");

    const persisted = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract!.id } });
    expect(persisted.pixQrCodeUrl).toBe("data:image/png;base64,fake");
    expect(persisted.pixCopyPasteCode).toBe("00020126fakepixcode");
    expect(persisted.pixExpiresAt).not.toBeNull();

    const training = await consultancyService.getMyTraining(clientId);
    const waiting = training.waitingDelivery.find((w) => w.contractId === contract!.id);
    expect(waiting).toBeTruthy();
    expect(waiting!.pix).not.toBeNull();
    expect(waiting!.pix!.copyAndPasteCode).toBe("00020126fakepixcode");
  });
});

describe("Frente 9 (segunda camada), Lote 4 — avaliação de consultoria online", () => {
  const reviewService = new ReviewService();
  let clientId = "";
  let providerUserId = "";
  let providerId = "";
  let categoryId = "";
  let offerId = "";
  const contractIds: string[] = [];

  beforeAll(async () => {
    const category = await prisma.serviceCategory.create({ data: { name: `F9L4_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Nove Lote Quatro",
        email: `${Date.now()}_f9l4_client@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Nove Lote Quatro",
        email: `${Date.now()}_f9l4_provider@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Nove Lote Quatro",
        bio: "test",
        experienceYears: 3,
        priceCents: 20000,
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "ONLINE_CONSULTANCY",
        title: "Consultoria Avaliável",
        billingCycle: "MONTHLY",
        priceCents: 20000
      }
    });
    offerId = offer.id;
  });

  afterAll(async () => {
    await prisma.review.deleteMany({ where: { providerId } });
    await prisma.consultancyContract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: offerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
  });

  async function makeDeliveredContract() {
    const req = await prisma.consultancyRequest.create({
      data: {
        providerId,
        clientId,
        status: "ACCEPTED",
        quotedOfferId: offerId,
        responseDeadlineAt: new Date(),
        respondedAt: new Date(),
        clientDecisionAt: new Date()
      }
    });
    const contract = await prisma.consultancyContract.create({
      data: {
        requestId: req.id,
        providerId,
        clientId,
        offerId,
        status: "DELIVERED",
        paymentMethod: "CREDIT_CARD",
        paymentStatus: "CAPTURED",
        paymentAmountCents: 20000,
        providerAmountCents: 18000,
        platformAmountCents: 2000,
        billingCycle: "MONTHLY",
        kind: "ONLINE_CONSULTANCY",
        mpPaymentId: `mp_${Date.now()}_review_${Math.random().toString(36).slice(2, 6)}`,
        paymentCapturedAt: new Date(),
        deliveredAt: new Date(),
        deliveryDeadlineAt: new Date(Date.now() + 30 * 24 * 3600_000),
        immediateExecutionAcknowledgedAt: new Date()
      }
    });
    contractIds.push(contract.id);
    return contract;
  }

  it("cliente avalia consultoria entregue — providerProfile.averageRating/totalReviews atualizam", async () => {
    const contract = await makeDeliveredContract();

    const review = await reviewService.create(clientId, { contractId: contract.id }, 5, "Excelente consultoria!");
    expect(review.consultancyContractId).toBe(contract.id);
    expect(review.bookingId).toBeNull();

    const providerAfter = await prisma.providerProfile.findUniqueOrThrow({ where: { id: providerId } });
    expect(providerAfter.totalReviews).toBeGreaterThanOrEqual(1);
    expect(providerAfter.averageRating).toBeGreaterThan(0);
  });

  it("não deixa avaliar a mesma consultoria duas vezes", async () => {
    const contract = await makeDeliveredContract();
    await reviewService.create(clientId, { contractId: contract.id }, 4, "Boa.");

    await expect(reviewService.create(clientId, { contractId: contract.id }, 5, "De novo")).rejects.toThrow(
      "Esta consultoria já foi avaliada."
    );
  });

  it("não deixa avaliar consultoria que ainda não foi entregue (status diferente de DELIVERED)", async () => {
    const req = await prisma.consultancyRequest.create({
      data: {
        providerId,
        clientId,
        status: "ACCEPTED",
        quotedOfferId: offerId,
        responseDeadlineAt: new Date(),
        respondedAt: new Date(),
        clientDecisionAt: new Date()
      }
    });
    const contract = await prisma.consultancyContract.create({
      data: {
        requestId: req.id,
        providerId,
        clientId,
        offerId,
        status: "ACTIVE",
        paymentMethod: "CREDIT_CARD",
        paymentStatus: "AUTHORIZED",
        paymentAmountCents: 20000,
        providerAmountCents: 18000,
        platformAmountCents: 2000,
        billingCycle: "MONTHLY",
        kind: "ONLINE_CONSULTANCY",
        deliveryDeadlineAt: new Date(Date.now() + 30 * 24 * 3600_000),
        immediateExecutionAcknowledgedAt: new Date()
      }
    });
    contractIds.push(contract.id);

    await expect(reviewService.create(clientId, { contractId: contract.id }, 5, "Ainda não")).rejects.toThrow(
      "A avaliação só pode ser enviada após a entrega da consultoria."
    );
  });

  it("recalcular o rating após reembolso de um booking não derruba as avaliações de consultoria do mesmo profissional", async () => {
    const { recalculateProviderRatingAfterRefund } = await import("../src/shared/utils/provider-rating");

    const providerBefore = await prisma.providerProfile.findUniqueOrThrow({ where: { id: providerId } });

    // Avaliação de consultoria (sem bookingId).
    const contract = await makeDeliveredContract();
    await reviewService.create(clientId, { contractId: contract.id }, 5, "Ótimo");

    // Avaliação de booking presencial, sem Payment vinculado — dispara o
    // mesmo recálculo que roda de verdade após um reembolso de booking.
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 24 * 3600_000),
        priceCents: 10000,
        status: "COMPLETED",
        completedAt: new Date()
      }
    });
    await prisma.review.create({
      data: { bookingId: booking.id, userId: clientId, providerId, rating: 4, comment: "Bom" }
    });

    await recalculateProviderRatingAfterRefund(booking.id);

    // Frente 9 (segunda camada), Lote 4: antes da correção em
    // provider-rating.ts, a review de consultoria (bookingId null) sumia
    // do agregado assim que esta função rodava pra qualquer booking do
    // mesmo profissional — o filtro "booking: {...}" tem semântica de
    // INNER JOIN pra relação opcional.
    const providerAfter = await prisma.providerProfile.findUniqueOrThrow({ where: { id: providerId } });
    expect(providerAfter.totalReviews).toBe(providerBefore.totalReviews + 2);

    await prisma.review.deleteMany({ where: { bookingId: booking.id } });
    await prisma.booking.delete({ where: { id: booking.id } });
  });
});

describe("Frente 9 (segunda camada), Lotes 5 e 6 — 404 em vez de 403 pra recurso de terceiro", () => {
  const presentialPackageService = new PresentialPackageService();
  const consultancyService = new ConsultancyService();
  let clientId = "";
  let strangerId = "";
  let providerUserId = "";
  let providerId = "";
  let categoryId = "";
  const packageIds: string[] = [];
  const contractIds: string[] = [];

  beforeAll(async () => {
    const category = await prisma.serviceCategory.create({ data: { name: `F9L56_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Nove Lotes Cinco Seis",
        email: `${Date.now()}_f9l56_client@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;

    const stranger = await prisma.user.create({
      data: {
        name: "Estranho Frente Nove Lotes Cinco Seis",
        email: `${Date.now()}_f9l56_stranger@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}9`,
        role: "CLIENT"
      }
    });
    strangerId = stranger.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Nove Lotes Cinco Seis",
        email: `${Date.now()}_f9l56_provider@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Nove Lotes Cinco Seis",
        bio: "test",
        experienceYears: 3,
        priceCents: 20000,
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;
  });

  afterAll(async () => {
    await prisma.trainingPlan.deleteMany({ where: { providerId } });
    await prisma.consultancyContract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId } });
    await prisma.presentialPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, strangerId, providerUserId] } } });
  });

  it("cancelPackage/getPackageById devolvem 404 (não 403) pra quem não é dono do pacote", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "PRESENTIAL",
        title: `Pacote L56 ${Date.now()}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 20000,
        presentialPackageMode: PresentialPackageMode.FIXED_RECURRING,
        presentialSessionsPerCycle: 4
      }
    });
    const pkg = await prisma.presentialPackage.create({
      data: {
        providerId,
        clientId,
        offerId: offer.id,
        categoryId,
        mode: PresentialPackageMode.FIXED_RECURRING,
        status: PresentialPackageStatus.ACTIVE,
        cycleAmountCents: 20000,
        billingCycle: OfferBillingCycle.MONTHLY,
        sessionsPerCycle: 4
      }
    });
    packageIds.push(pkg.id);

    await expect(presentialPackageService.getPackageById(strangerId, pkg.id)).rejects.toMatchObject({
      statusCode: 404
    });
    await expect(presentialPackageService.cancelPackage(strangerId, pkg.id)).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it("completeTrainingPlan devolve 404 (não 403) pra ficha de contrato de outro cliente", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "ONLINE_CONSULTANCY",
        title: "Consultoria L56",
        billingCycle: "MONTHLY",
        priceCents: 20000
      }
    });
    const req = await prisma.consultancyRequest.create({
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
        requestId: req.id,
        providerId,
        clientId,
        offerId: offer.id,
        status: "ACTIVE",
        paymentMethod: "CREDIT_CARD",
        paymentStatus: "CAPTURED",
        paymentAmountCents: 20000,
        providerAmountCents: 18000,
        platformAmountCents: 2000,
        billingCycle: "MONTHLY",
        kind: "ONLINE_CONSULTANCY",
        paymentCapturedAt: new Date(),
        deliveryDeadlineAt: new Date(Date.now() + 30 * 24 * 3600_000),
        immediateExecutionAcknowledgedAt: new Date()
      }
    });
    contractIds.push(contract.id);
    const plan = await prisma.trainingPlan.create({
      data: { providerId, contractId: contract.id, title: "Ficha L56", isPrebuilt: false }
    });

    await expect(consultancyService.completeTrainingPlan(strangerId, plan.id)).rejects.toMatchObject({
      statusCode: 404
    });
  });
});

describe("Frente 9 (segunda camada), Lote 7 — profissional suspenso não recebe nova solicitação de consultoria", () => {
  const consultancyService = new ConsultancyService();
  let clientId = "";
  let providerUserId = "";
  let providerId = "";
  let offerId = "";

  beforeAll(async () => {
    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Nove Lote Sete",
        email: `${Date.now()}_f9l7_client@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Nove Lote Sete",
        email: `${Date.now()}_f9l7_provider@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER",
        suspendedAt: new Date(),
        suspensionReason: "teste"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Nove Lote Sete",
        bio: "test",
        experienceYears: 3,
        priceCents: 20000,
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    await prisma.onlineConsultancySetting.create({ data: { providerId, enabled: true } });

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "ONLINE_CONSULTANCY",
        title: "Consultoria L7",
        billingCycle: "MONTHLY",
        priceCents: 20000
      }
    });
    offerId = offer.id;
  });

  afterAll(async () => {
    await prisma.consultancyRequest.deleteMany({ where: { clientId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: offerId } });
    await prisma.onlineConsultancySetting.deleteMany({ where: { providerId } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
  });

  it("criar solicitação pra profissional suspenso é bloqueado na hora (não só no aceite depois)", async () => {
    await expect(
      consultancyService.createConsultancyRequest(clientId, { providerId, quotedOfferId: offerId })
    ).rejects.toThrow("Este profissional não está disponível para novas contratações no momento.");

    const count = await prisma.consultancyRequest.count({ where: { clientId, providerId } });
    expect(count).toBe(0);
  });
});

describe("Frente 9 (segunda camada), Lote 8 — chat de consultoria ganha mensagem de boas-vindas", () => {
  const consultancyService = new ConsultancyService();
  let clientId = "";
  let providerUserId = "";
  let providerId = "";
  let offerId = "";
  const contractIds: string[] = [];

  beforeAll(async () => {
    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Nove Lote Oito",
        email: `${Date.now()}_f9l8_client@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        emailVerifiedAt: new Date(),
        mpCustomerId: "cus_test_f9l8"
      }
    });
    clientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Nove Lote Oito",
        email: `${Date.now()}_f9l8_provider@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Nove Lote Oito",
        bio: "test",
        experienceYears: 3,
        priceCents: 20000,
        mpAccountId: "111333555",
        mpAccessToken: encryptSensitiveText("fake_access_token"),
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "ONLINE_CONSULTANCY",
        title: "Consultoria L8",
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
    await prisma.consultancyMessage.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.consultancyContract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: offerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
  });

  it("aceitar proposta cria mensagem de sistema de boas-vindas no chat da consultoria", async () => {
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test_f9l8" } as any);
    vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 888, status: "authorized" } as any);

    await prisma.customerPaymentMethod.create({
      data: {
        userId: clientId,
        mpCustomerId: "cus_test_f9l8",
        mpCardId: `card_${Date.now()}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });

    const req = await prisma.consultancyRequest.create({
      data: {
        providerId,
        clientId,
        status: "RESPONDED",
        quotedOfferId: offerId,
        responseDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        respondedAt: new Date()
      }
    });

    const { contract } = await consultancyService.decideRequest(clientId, req.id, {
      decision: "ACCEPT",
      paymentMethod: "CREDIT_CARD" as any,
      acknowledgedImmediateExecution: true
    });
    contractIds.push(contract!.id);

    // A mensagem de boas-vindas é criada "fire and forget" (void ...catch),
    // mesmo padrão já usado pro equivalente de booking - poll curto em vez
    // de sleep fixo.
    let welcomeMessage: Awaited<ReturnType<typeof prisma.consultancyMessage.findFirst>> = null;
    for (let attempt = 0; attempt < 20 && !welcomeMessage; attempt += 1) {
      welcomeMessage = await prisma.consultancyMessage.findFirst({
        where: { contractId: contract!.id, isSystem: true }
      });
      if (!welcomeMessage) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(welcomeMessage).not.toBeNull();
    expect(welcomeMessage!.content).toContain("Profissional Frente Nove Lote Oito");
  });
});

describe("Frente 9 (segunda camada), Lote 9 — e-mail de confirmação de compra em pacote e consultoria", () => {
  const presentialPackageService = new PresentialPackageService();
  const consultancyService = new ConsultancyService();
  let clientId = "";
  let providerUserId = "";
  let providerId = "";
  let categoryId = "";
  const packageIds: string[] = [];
  const contractIds: string[] = [];
  const offerIds: string[] = [];

  beforeAll(async () => {
    const category = await prisma.serviceCategory.create({ data: { name: `F9L9_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Nove Lote Nove",
        email: `${Date.now()}_f9l9_client@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        emailVerifiedAt: new Date(),
        mpCustomerId: "cus_test_f9l9"
      }
    });
    clientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Nove Lote Nove",
        email: `${Date.now()}_f9l9_provider@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Nove Lote Nove",
        bio: "test",
        experienceYears: 3,
        priceCents: 15000,
        mpAccountId: "222444666",
        mpAccessToken: encryptSensitiveText("fake_access_token"),
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.emailDeliveryQueue.deleteMany({
      where: { template: { in: ["PURCHASE_CONFIRMATION_CLIENT", "PURCHASE_CONFIRMATION_PROVIDER"] } }
    });
    await prisma.consultancyMessage.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.consultancyContract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId } });
    await prisma.presentialPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
  });

  it("comprar pacote presencial (sessões avulsas) enfileira e-mail de confirmação pro cliente e pro profissional", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "PRESENTIAL",
        title: `Pacote L9 ${Date.now()}`,
        billingCycle: "MONTHLY",
        priceCents: 8000,
        presentialPackageMode: "FLEXIBLE_CREDITS",
        presentialSessionsPerCycle: 2,
        presentialHasFixedTerm: true,
        presentialTotalCycles: 1
      }
    });
    offerIds.push(offer.id);

    const { package: pkg } = await presentialPackageService.purchasePackage(clientId, {
      offerId: offer.id,
      categoryId,
      paymentMethod: "CREDIT_CARD" as any
    });
    packageIds.push(pkg.id);

    let clientEmail = null;
    let providerEmail = null;
    for (let attempt = 0; attempt < 20 && (!clientEmail || !providerEmail); attempt += 1) {
      clientEmail = await prisma.emailDeliveryQueue.findFirst({
        where: { template: "PURCHASE_CONFIRMATION_CLIENT", payload: { path: ["clientName"], equals: "Cliente Frente Nove Lote Nove" } }
      });
      providerEmail = await prisma.emailDeliveryQueue.findFirst({
        where: { template: "PURCHASE_CONFIRMATION_PROVIDER", payload: { path: ["providerName"], equals: "Profissional Frente Nove Lote Nove" } }
      });
      if (!clientEmail || !providerEmail) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(clientEmail).not.toBeNull();
    expect(providerEmail).not.toBeNull();
  });

  it("aceitar proposta de consultoria enfileira e-mail de confirmação pro cliente e pro profissional", async () => {
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test_f9l9" } as any);
    vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 999, status: "authorized" } as any);

    await prisma.customerPaymentMethod.create({
      data: {
        userId: clientId,
        mpCustomerId: "cus_test_f9l9",
        mpCardId: `card_${Date.now()}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "ONLINE_CONSULTANCY",
        title: "Consultoria L9",
        billingCycle: "MONTHLY",
        priceCents: 20000
      }
    });
    offerIds.push(offer.id);

    const req = await prisma.consultancyRequest.create({
      data: {
        providerId,
        clientId,
        status: "RESPONDED",
        quotedOfferId: offer.id,
        responseDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        respondedAt: new Date()
      }
    });

    const { contract } = await consultancyService.decideRequest(clientId, req.id, {
      decision: "ACCEPT",
      paymentMethod: "CREDIT_CARD" as any,
      acknowledgedImmediateExecution: true
    });
    contractIds.push(contract!.id);

    let clientEmail = null;
    let providerEmail = null;
    for (let attempt = 0; attempt < 20 && (!clientEmail || !providerEmail); attempt += 1) {
      clientEmail = await prisma.emailDeliveryQueue.findFirst({
        where: { template: "PURCHASE_CONFIRMATION_CLIENT", payload: { path: ["serviceName"], string_contains: "Consultoria L9" } }
      });
      providerEmail = await prisma.emailDeliveryQueue.findFirst({
        where: { template: "PURCHASE_CONFIRMATION_PROVIDER", payload: { path: ["serviceName"], string_contains: "Consultoria L9" } }
      });
      if (!clientEmail || !providerEmail) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(clientEmail).not.toBeNull();
    expect(providerEmail).not.toBeNull();
  });
});

describe("Frente 9 (segunda camada), Lote 10 — XP de compra de pacote presencial", () => {
  const presentialPackageService = new PresentialPackageService();
  let clientId = "";
  let providerUserId = "";
  let providerId = "";
  let categoryId = "";
  const packageIds: string[] = [];
  const offerIds: string[] = [];

  beforeAll(async () => {
    const category = await prisma.serviceCategory.create({ data: { name: `F9L10_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Nove Lote Dez",
        email: `${Date.now()}_f9l10_client@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        emailVerifiedAt: new Date(),
        mpCustomerId: "cus_test_f9l10"
      }
    });
    clientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Nove Lote Dez",
        email: `${Date.now()}_f9l10_provider@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Nove Lote Dez",
        bio: "test",
        experienceYears: 3,
        priceCents: 15000,
        mpAccountId: "333555777",
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;
  });

  afterAll(async () => {
    await prisma.userXpTransaction.deleteMany({ where: { userId: clientId } });
    await prisma.presentialPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
  });

  it("comprar pacote presencial (sessões avulsas) concede XP de serviço contratado", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "PRESENTIAL",
        title: `Pacote L10 ${Date.now()}`,
        billingCycle: "MONTHLY",
        priceCents: 8000,
        presentialPackageMode: "FLEXIBLE_CREDITS",
        presentialSessionsPerCycle: 2,
        presentialHasFixedTerm: true,
        presentialTotalCycles: 1
      }
    });
    offerIds.push(offer.id);

    const { package: pkg } = await presentialPackageService.purchasePackage(clientId, {
      offerId: offer.id,
      categoryId,
      paymentMethod: "CREDIT_CARD" as any
    });
    packageIds.push(pkg.id);

    let xp: Awaited<ReturnType<typeof prisma.userXpTransaction.findFirst>> = null;
    for (let attempt = 0; attempt < 20 && !xp; attempt += 1) {
      xp = await prisma.userXpTransaction.findFirst({
        where: { userId: clientId, referenceId: pkg.id, reason: "SERVICE_PURCHASED" }
      });
      if (!xp) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(xp).not.toBeNull();
    expect(xp!.amount).toBe(25);
  });
});

describe("Frente 9 (segunda camada), Lote 11 — deleteMe zera campos MP de PresentialPackage", () => {
  const userService = new UserService();
  const PASSWORD = "Test1234";
  let clientId = "";
  let providerUserId = "";
  let providerId = "";
  let categoryId = "";
  let offerId = "";
  let packageId = "";

  beforeAll(async () => {
    const category = await prisma.serviceCategory.create({ data: { name: `F9L11_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const hashed = await hashValue(PASSWORD);
    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Nove Lote Onze",
        email: `${Date.now()}_f9l11_client@test.com`,
        password: hashed,
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Nove Lote Onze",
        email: `${Date.now()}_f9l11_provider@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Nove Lote Onze",
        bio: "test",
        experienceYears: 3,
        priceCents: 20000,
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "PRESENTIAL",
        title: `Pacote L11 ${Date.now()}`,
        billingCycle: "MONTHLY",
        priceCents: 20000,
        presentialPackageMode: "FIXED_RECURRING",
        presentialSessionsPerCycle: 4
      }
    });
    offerId = offer.id;

    // Pacote já CANCELLED antes da exclusão da conta - fora de
    // ACTIVE_PACKAGE_STATUSES, então cancelPackage nunca roda nele como
    // efeito colateral do cancelamento (é exatamente esse o cenário do bug).
    const pkg = await prisma.presentialPackage.create({
      data: {
        providerId,
        clientId,
        offerId,
        categoryId,
        mode: "FIXED_RECURRING",
        status: "CANCELLED",
        cancelledAt: new Date(),
        cycleAmountCents: 20000,
        billingCycle: "MONTHLY",
        sessionsPerCycle: 4,
        billingCardId: `card_${Date.now()}`,
        pendingChargeMpPaymentId: `mp_pending_${Date.now()}`,
        pendingChargePixQrCodeUrl: "data:image/png;base64,fake",
        pendingChargePixCopyPasteCode: "00020126fakepix",
        pendingChargePixExpiresAt: new Date(Date.now() + 3600_000)
      }
    });
    packageId = pkg.id;
  });

  afterAll(async () => {
    await prisma.presentialPackage.deleteMany({ where: { id: packageId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: offerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
  });

  it("excluir a conta zera billingCardId/pendingChargeMpPaymentId/Pix de um pacote já cancelado", async () => {
    await userService.deleteMe(clientId, PASSWORD);

    const pkgAfter = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: packageId } });
    expect(pkgAfter.billingCardId).toBeNull();
    expect(pkgAfter.pendingChargeMpPaymentId).toBeNull();
    expect(pkgAfter.pendingChargePixQrCodeUrl).toBeNull();
    expect(pkgAfter.pendingChargePixCopyPasteCode).toBeNull();
    expect(pkgAfter.pendingChargePixExpiresAt).toBeNull();
  });
});
