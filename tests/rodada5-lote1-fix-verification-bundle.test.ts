import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { Payment, CardToken } from "mercadopago";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { encryptSensitiveText } from "../src/shared/utils/encryption";
import { signToken } from "../src/shared/utils/jwt";

// Raio-X de pagamentos, Rodada 5, Lote 1: a Rodada 4 (Lote 2 do service +
// Lote 10 da UI) deu "cancelar consultoria pelo profissional" como pronto,
// mas a rota HTTP continuava travada em ensureRole(CLIENT) — 403 pra
// qualquer profissional que tentasse. Nenhum teste anterior batia na rota
// real com token de PROVIDER, só chamava o service direto. Este teste é
// exatamente a lacuna que deixou o bug passar despercebido.

const consultancyService = new ConsultancyService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
let offerId = "";

describe("Rodada 5, Lote 1 — cancelar consultoria pelo profissional via rota HTTP real", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `R5L1_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Lote1 Client",
        email: `${uid("l5l1_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        mpCustomerId: "cus_test_l5l1",
        emailVerifiedAt: new Date()
      }
    });
    clientId = client.id;

    await prisma.customerPaymentMethod.create({
      data: {
        userId: clientId,
        mpCustomerId: "cus_test_l5l1",
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
        name: "Lote1 Provider",
        email: `${uid("l5l1_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Lote1 Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 20000,
        mpAccountId: "999888111",
        mpAccessToken: encryptSensitiveText("fake_access_token"),
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "ONLINE_CONSULTANCY",
        title: "Consultoria — teste de cancelamento pelo profissional",
        billingCycle: "MONTHLY",
        priceCents: 20000
      }
    });
    offerId = offer.id;
  });

  afterAll(async () => {
    await prisma.disputeCase.deleteMany({ where: { clientId } });
    await prisma.trainingPlan.deleteMany({ where: { providerId } });
    await prisma.consultancyContract.deleteMany({ where: { clientId } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: offerId } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("profissional consegue cancelar a própria consultoria via POST /consultancy/contracts/:id/cancel (regressão do 403)", async () => {
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test_l5l1" } as any);
    vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 991, status: "authorized" } as any);

    const consultancyRequest = await prisma.consultancyRequest.create({
      data: {
        providerId,
        clientId,
        status: "RESPONDED",
        quotedOfferId: offerId,
        responseDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        respondedAt: new Date()
      }
    });

    const { contract } = await consultancyService.decideRequest(clientId, consultancyRequest.id, {
      decision: "ACCEPT",
      paymentMethod: "CREDIT_CARD" as any,
      acknowledgedImmediateExecution: true
    });
    expect(contract!.status).toBe("ACTIVE");

    const providerToken = signToken(providerUserId, "PROVIDER");

    const res = await request(app)
      .post(`/api/consultancy/contracts/${contract!.id}/cancel`)
      .set("Authorization", `Bearer ${providerToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");

    const afterCancel = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract!.id } });
    expect(afterCancel.status).toBe("CANCELLED");
  });

  it("continua rejeitando um profissional tentando cancelar a consultoria de outro (sanity check da checagem de dono)", async () => {
    const otherProviderUser = await prisma.user.create({
      data: {
        name: "Outro Provider",
        email: `${uid("l5l1_other_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}3`,
        role: "PROVIDER"
      }
    });

    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test_l5l1b" } as any);
    vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 992, status: "authorized" } as any);

    const consultancyRequest = await prisma.consultancyRequest.create({
      data: {
        providerId,
        clientId,
        status: "RESPONDED",
        quotedOfferId: offerId,
        responseDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        respondedAt: new Date()
      }
    });
    const { contract } = await consultancyService.decideRequest(clientId, consultancyRequest.id, {
      decision: "ACCEPT",
      paymentMethod: "CREDIT_CARD" as any,
      acknowledgedImmediateExecution: true
    });

    const otherProviderToken = signToken(otherProviderUser.id, "PROVIDER");
    const res = await request(app)
      .post(`/api/consultancy/contracts/${contract!.id}/cancel`)
      .set("Authorization", `Bearer ${otherProviderToken}`)
      .send({});

    expect(res.status).toBe(404);

    await prisma.consultancyContract.delete({ where: { id: contract!.id } });
    await prisma.user.delete({ where: { id: otherProviderUser.id } });
  });
});
