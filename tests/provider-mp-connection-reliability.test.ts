import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { CardToken } from "mercadopago";
import { prisma } from "../src/config/prisma";
import { PaymentService } from "../src/modules/payments/services/payment.service";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Raio-X de pagamentos (27/07/2026) — Lote 5: confiabilidade da conexão do
// profissional com o Mercado Pago. Antes, uma falha na renovação do token
// só ficava registrada num log interno — o profissional nunca era avisado,
// getProviderConnectStatus continuava mostrando "Ativo", e uma cobrança que
// dependesse desse token culpava o cartão do cliente.

const paymentService = new PaymentService();
const consultancyService = new ConsultancyService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";

describe("Confiabilidade da conexão MP do profissional (Lote 5 do raio-x)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `MC_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "MP Conn Client",
        email: `${uid("mc_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        mpCustomerId: "cus_test_mc"
      }
    });
    clientId = client.id;

    await prisma.customerPaymentMethod.create({
      data: {
        userId: clientId,
        mpCustomerId: "cus_test_mc",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });

    const providerUser = await prisma.user.create({
      data: {
        name: "MP Conn Provider",
        email: `${uid("mc_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "MP Conn Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 15000,
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.providerProfile.update({
      where: { id: providerId },
      data: {
        mpAccountId: null,
        mpAccessToken: null,
        mpRefreshToken: null,
        mpTokenExpiresAt: null,
        mpTokenInvalidatedAt: null
      }
    });
  });

  afterAll(async () => {
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("refreshProviderMpTokens: token de renovação inválido (400) marca mpTokenInvalidatedAt e avisa o profissional", async () => {
    await prisma.providerProfile.update({
      where: { id: providerId },
      data: {
        mpAccountId: "111222333",
        mpRefreshToken: encryptSensitiveText("refresh_invalido"),
        mpTokenExpiresAt: new Date(Date.now() + 1000)
      }
    });

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "invalid_grant" })
    } as any);

    await paymentService.refreshProviderMpTokens();

    const after = await prisma.providerProfile.findUniqueOrThrow({ where: { id: providerId } });
    expect(after.mpTokenInvalidatedAt).not.toBeNull();
  });

  it("refreshProviderMpTokens: renovação bem-sucedida limpa mpTokenInvalidatedAt caso estivesse marcado", async () => {
    await prisma.providerProfile.update({
      where: { id: providerId },
      data: {
        mpAccountId: "111222333",
        mpRefreshToken: encryptSensitiveText("refresh_valido"),
        mpTokenExpiresAt: new Date(Date.now() + 1000),
        mpTokenInvalidatedAt: new Date()
      }
    });

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "novo_token", refresh_token: "novo_refresh", expires_in: 15552000 })
    } as any);

    await paymentService.refreshProviderMpTokens();

    const after = await prisma.providerProfile.findUniqueOrThrow({ where: { id: providerId } });
    expect(after.mpTokenInvalidatedAt).toBeNull();
  });

  it("getProviderConnectStatus: reflete needsReconnect e desliga charges/payoutsEnabled quando o token foi invalidado", async () => {
    await prisma.providerProfile.update({
      where: { id: providerId },
      data: { mpAccountId: "111222333", mpTokenInvalidatedAt: new Date() }
    });

    const status = await paymentService.getProviderConnectStatus(providerUserId);
    expect(status.hasAccount).toBe(true);
    expect(status.needsReconnect).toBe(true);
    expect(status.chargesEnabled).toBe(false);
    expect(status.payoutsEnabled).toBe(false);
  });

  it("getProviderConnectStatus: conta conectada e sem invalidação continua Ativo normalmente", async () => {
    await prisma.providerProfile.update({
      where: { id: providerId },
      data: { mpAccountId: "111222333" }
    });

    const status = await paymentService.getProviderConnectStatus(providerUserId);
    expect(status.needsReconnect).toBe(false);
    expect(status.chargesEnabled).toBe(true);
    expect(status.payoutsEnabled).toBe(true);
  });

  it("renovação de ficha com conexão MP marcada como invalidada falha com mensagem correta (não culpa o cartão do aluno)", async () => {
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);

    // Profissional cuja conexão já foi marcada como quebrada por
    // refreshProviderMpTokens (não é só "nunca conectou").
    await prisma.providerProfile.update({
      where: { id: providerId },
      data: { mpAccountId: "111222333", mpTokenInvalidatedAt: new Date() }
    });

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "ONLINE_CONSULTANCY",
        title: `Consultoria ${uid("offer")}`,
        billingCycle: "MONTHLY",
        priceCents: 15000,
        fichaValidityDays: 30
      }
    });
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
        paymentMethod: "CREDIT_CARD",
        paymentStatus: "CAPTURED",
        paymentAmountCents: 15000,
        providerAmountCents: 13500,
        platformAmountCents: 1500,
        billingCycle: "MONTHLY",
        kind: "ONLINE_CONSULTANCY",
        fichaValidityDays: 30,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date()
      }
    });

    await consultancyService.deliverContract(providerUserId, contract.id, { title: "Ficha 1", exercises: [] });

    await expect(
      consultancyService.deliverContract(providerUserId, contract.id, { title: "Ficha 2", exercises: [] })
    ).rejects.toThrow(/conexão deste profissional com o Mercado Pago/);

    await prisma.trainingPlan.deleteMany({ where: { contractId: contract.id } });
    await prisma.consultancyContract.deleteMany({ where: { id: contract.id } });
    await prisma.consultancyRequest.deleteMany({ where: { id: request.id } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: offer.id } });
  });
});
