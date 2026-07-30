import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import { Payment, CardToken } from "mercadopago";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Liberdade de configuracao de ofertas — Frente B: duracao flexivel da
// consultoria + fichas com validade e cobranca a cada renovacao. Cobre
// tambem a correcao de um bug encontrado no caminho: o controller de
// criar/editar oferta nunca repassava presentialPackageMode/combo*/etc pro
// service (so a validacao Zod os aceitava) - nenhum teste HTTP existia pra
// essa rota antes, por isso passou despercebido.

const consultancyService = new ConsultancyService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

const PASSWORD = "Test1234";

async function registerUser(prefix: string, displayName: string, role?: "PROVIDER") {
  const reg = await request(app)
    .post("/api/auth/register")
    .send({
      name: displayName,
      email: `${uid(prefix)}@test.com`,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
      ...(role ? { role } : {}),
      termsVersion: "2026.05",
      consentAccepted: true
    });
  return { token: reg.body.accessToken as string, userId: reg.body.user.id as string };
}

let providerToken = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const offerIds: string[] = [];

describe("Liberdade de ofertas — Frente B (validade de ficha + rota HTTP de ofertas)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `OF_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const provider = await registerUser("of_provider", "Offer Provider", "PROVIDER");
    providerToken = provider.token;
    providerUserId = provider.userId;

    const profile = await request(app)
      .post("/api/providers/profile")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({
        displayName: "Offer Provider",
        bio: "Provider de teste para ofertas",
        experienceYears: 3,
        priceCents: 10000,
        categoryIds: [categoryId]
      });
    if (profile.status !== 201) {
      throw new Error(`Falha ao criar perfil de provider no setup do teste: ${profile.status} ${JSON.stringify(profile.body)}`);
    }
    providerId = profile.body.id;

    // CREF aprovado direto no banco — a aprovacao em si (fluxo do admin) nao
    // e o alvo deste teste, so precisa estar aprovado pra poder salvar oferta.
    await prisma.providerProfile.update({
      where: { id: providerId },
      data: { crefValidationStatus: "APPROVED" }
    });
  });

  afterAll(async () => {
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: providerUserId } });
    await prisma.user.deleteMany({ where: { id: providerUserId } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("criar oferta de pacote presencial via HTTP salva presentialPackageMode de verdade (regressão do bug)", async () => {
    const res = await request(app)
      .post("/api/consultancy/provider/offers")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({
        kind: "PRESENTIAL",
        title: "Pacote de teste",
        billingCycle: "MONTHLY",
        priceCents: 40000,
        presentialPackageMode: "FIXED_RECURRING",
        presentialHasFixedTerm: true,
        presentialTotalCycles: 3,
        presentialSessionsPerCycle: 8
      });

    expect(res.status).toBe(201);
    offerIds.push(res.body.id);
    expect(res.body.presentialPackageMode).toBe("FIXED_RECURRING");
    expect(res.body.presentialHasFixedTerm).toBe(true);
    expect(res.body.presentialTotalCycles).toBe(3);
    expect(res.body.presentialSessionsPerCycle).toBe(8);

    const persisted = await prisma.providerServiceOffer.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(persisted.presentialPackageMode).toBe("FIXED_RECURRING");
  });

  it("criar oferta de combo via HTTP salva os valores de cada metade de verdade (regressão do bug)", async () => {
    const res = await request(app)
      .post("/api/consultancy/provider/offers")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({
        kind: "COMBO",
        title: "Combo",
        billingCycle: "MONTHLY",
        priceCents: 60000,
        comboPresentialDaysPerWeek: 3,
        comboOnlineDaysPerWeek: 2,
        presentialPackageMode: "FLEXIBLE_CREDITS",
        presentialSessionsPerCycle: 4,
        presentialHasFixedTerm: true,
        presentialTotalCycles: 1,
        comboPresentialShareCents: 40000,
        comboConsultancyShareCents: 20000
      });

    expect(res.status).toBe(201);
    offerIds.push(res.body.id);
    expect(res.body.comboPresentialShareCents).toBe(40000);
    expect(res.body.comboConsultancyShareCents).toBe(20000);

    const persisted = await prisma.providerServiceOffer.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(persisted.comboPresentialShareCents).toBe(40000);
    expect(persisted.comboConsultancyShareCents).toBe(20000);
  });

  it("configura validade de ficha numa oferta de consultoria via HTTP e edita depois", async () => {
    const createRes = await request(app)
      .post("/api/consultancy/provider/offers")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({
        kind: "ONLINE_CONSULTANCY",
        title: "Consultoria com ficha renovável",
        billingCycle: "MONTHLY",
        priceCents: 15000,
        fichaValidityDays: 30
      });

    expect(createRes.status).toBe(201);
    offerIds.push(createRes.body.id);
    expect(createRes.body.fichaValidityDays).toBe(30);

    const updateRes = await request(app)
      .patch(`/api/consultancy/provider/offers/${createRes.body.id}`)
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ fichaValidityDays: 45 });

    if (updateRes.status !== 200) {
      throw new Error(`PATCH offer falhou: ${updateRes.status} ${JSON.stringify(updateRes.body)}`);
    }
    expect(updateRes.body.fichaValidityDays).toBe(45);
  });

  it("rejeita validade de ficha numa oferta presencial", async () => {
    const res = await request(app)
      .post("/api/consultancy/provider/offers")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({
        kind: "PRESENTIAL",
        title: "Presencial não deveria aceitar validade de ficha",
        billingCycle: "DAILY",
        priceCents: 10000,
        fichaValidityDays: 30
      });

    expect(res.status).toBe(400);
  });
});

describe("Consultoria — renovação de ficha cobra a cada entrega (Frente B)", () => {
  let clientId = "";
  let clientProviderUserId = "";
  let clientProviderId = "";
  let clientCategoryId = "";
  let clientOfferId = "";

  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `FR_${Date.now()}`, description: "test" }
    });
    clientCategoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Ficha Client",
        email: `${uid("ficha_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        mpCustomerId: "cus_test_ficha",
        emailVerifiedAt: new Date()
      }
    });
    clientId = client.id;

    await prisma.customerPaymentMethod.create({
      data: {
        userId: clientId,
        mpCustomerId: "cus_test_ficha",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });

    await prisma.clientAnamnesis.create({
      data: { clientId, status: "COMPLETED", completedAt: new Date() }
    });

    const providerUser = await prisma.user.create({
      data: {
        name: "Ficha Provider",
        email: `${uid("ficha_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    clientProviderUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: clientProviderUserId,
        displayName: "Ficha Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 15000,
        mpAccountId: "999888777",
        mpAccessToken: encryptSensitiveText("fake_access_token"),
        crefValidationStatus: "APPROVED"
      }
    });
    clientProviderId = provider.id;

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId: clientProviderId,
        kind: "ONLINE_CONSULTANCY",
        title: "Consultoria com ficha renovável",
        billingCycle: "MONTHLY",
        priceCents: 15000,
        fichaValidityDays: 30
      }
    });
    clientOfferId = offer.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.trainingPlan.deleteMany({ where: { providerId: clientProviderId } });
    await prisma.consultancyContract.deleteMany({ where: { clientId } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: clientOfferId } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: clientProviderId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, clientProviderUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: clientCategoryId } });
    await prisma.$disconnect();
  });

  async function makeRespondedRequest() {
    return prisma.consultancyRequest.create({
      data: {
        providerId: clientProviderId,
        clientId,
        status: "RESPONDED",
        quotedOfferId: clientOfferId,
        responseDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        respondedAt: new Date()
      }
    });
  }

  it("2ª ficha entregue cobra de novo (mesmo valor) e calcula a validade a partir de fichaValidityDays", async () => {
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
    const paymentCreateSpy = vi
      .spyOn(Payment.prototype, "create")
      .mockResolvedValue({ id: 5001, status: "approved" } as any);

    const req = await makeRespondedRequest();
    const { contract } = await consultancyService.decideRequest(clientId, req.id, {
      decision: "ACCEPT",
      paymentMethod: "CREDIT_CARD" as any,
      acknowledgedImmediateExecution: true
    });

    const { contract: afterFirst } = await consultancyService.deliverContract(clientProviderUserId, contract!.id, {
      title: "Ficha 1",
      exercises: [{ name: "Agachamento", repetitionsSets: "4x10", load: "40kg" }]
    });
    expect(afterFirst.status).toBe("DELIVERED");

    paymentCreateSpy.mockClear();
    paymentCreateSpy.mockResolvedValue({ id: 5002, status: "approved" } as any);

    const { plan: plan2 } = await consultancyService.deliverContract(clientProviderUserId, contract!.id, {
      title: "Ficha 2 - progressão",
      exercises: [{ name: "Agachamento", repetitionsSets: "4x12", load: "50kg" }]
    });

    expect(paymentCreateSpy).toHaveBeenCalledTimes(1);
    expect(plan2.title).toBe("Ficha 2 - progressão");
    expect(plan2.validUntil).not.toBeNull();
    const daysUntilExpiry = Math.round(
      (new Date(plan2.validUntil!).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
    );
    expect(daysUntilExpiry).toBeGreaterThanOrEqual(29);
    expect(daysUntilExpiry).toBeLessThanOrEqual(30);

    const plansCount = await prisma.trainingPlan.count({ where: { contractId: contract!.id } });
    expect(plansCount).toBe(2);
  });

  it("se a cobrança da renovação falhar, a ficha nova não é salva", async () => {
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
    const paymentCreateSpy = vi
      .spyOn(Payment.prototype, "create")
      .mockResolvedValue({ id: 6001, status: "approved" } as any);

    const req = await makeRespondedRequest();
    const { contract } = await consultancyService.decideRequest(clientId, req.id, {
      decision: "ACCEPT",
      paymentMethod: "CREDIT_CARD" as any,
      acknowledgedImmediateExecution: true
    });
    await consultancyService.deliverContract(clientProviderUserId, contract!.id, {
      title: "Ficha 1",
      exercises: [{ name: "Agachamento", repetitionsSets: "4x10", load: "40kg" }]
    });

    paymentCreateSpy.mockResolvedValue({ id: 6002, status: "rejected", status_detail: "cc_rejected_other_reason" } as any);

    await expect(
      consultancyService.deliverContract(clientProviderUserId, contract!.id, {
        title: "Ficha 2 que não deve salvar",
        exercises: [{ name: "Agachamento", repetitionsSets: "4x12", load: "50kg" }]
      })
    ).rejects.toThrow();

    const plansCount = await prisma.trainingPlan.count({ where: { contractId: contract!.id } });
    expect(plansCount).toBe(1);
  });

  it("consultoria paga por Pix não permite renovação automática de ficha", async () => {
    vi.spyOn(Payment.prototype, "create").mockResolvedValue({
      id: 7001,
      status: "pending",
      point_of_interaction: { transaction_data: { qr_code_base64: null, qr_code: null, ticket_url: null } }
    } as any);

    const req = await makeRespondedRequest();
    const { contract } = await consultancyService.decideRequest(clientId, req.id, {
      decision: "ACCEPT",
      paymentMethod: "PIX" as any,
      acknowledgedImmediateExecution: true
    });

    // Simula confirmação do Pix (capturado) pra poder entregar a primeira ficha.
    await prisma.consultancyContract.update({
      where: { id: contract!.id },
      data: { status: "ACTIVE", paymentStatus: "CAPTURED", paymentCapturedAt: new Date() }
    });
    await consultancyService.deliverContract(clientProviderUserId, contract!.id, {
      title: "Ficha 1",
      exercises: [{ name: "Agachamento", repetitionsSets: "4x10", load: "40kg" }]
    });

    await expect(
      consultancyService.deliverContract(clientProviderUserId, contract!.id, {
        title: "Ficha 2 via Pix",
        exercises: [{ name: "Agachamento", repetitionsSets: "4x12", load: "50kg" }]
      })
    ).rejects.toThrow(/Pix/);
  });

  it("aluno pode encerrar a consultoria depois de já ter recebido fichas, sem nenhum reembolso", async () => {
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
    const refundSpy = vi.spyOn(Payment.prototype, "cancel");
    vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 8001, status: "approved" } as any);

    const req = await makeRespondedRequest();
    const { contract } = await consultancyService.decideRequest(clientId, req.id, {
      decision: "ACCEPT",
      paymentMethod: "CREDIT_CARD" as any,
      acknowledgedImmediateExecution: true
    });
    await consultancyService.deliverContract(clientProviderUserId, contract!.id, {
      title: "Ficha 1",
      exercises: [{ name: "Agachamento", repetitionsSets: "4x10", load: "40kg" }]
    });

    const ended = await consultancyService.cancelContract(clientId, contract!.id);

    expect(ended.status).toBe("CANCELLED");
    expect(refundSpy).not.toHaveBeenCalled();
  });
});
