import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { Payment, CardToken } from "mercadopago";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { encryptSensitiveText } from "../src/shared/utils/encryption";
import { getActiveEngagementSummary } from "../src/shared/utils/client-engagement";

// Achado ao preparar o teste manual do checklist (C7.3, 20/10/2026): aceitar
// uma proposta criava o contrato (PENDING_PAYMENT) antes da cobrança; se ela
// falhasse (profissional desconectado do Mercado Pago, erro do MP), o pedido
// voltava pra "respondido" mas o contrato ficava pra trás contando como
// vínculo ativo — aluno preso ao profissional sem ter pago nada. Mesmo achado
// e correção do pacote presencial (C6.1).

const consultancyService = new ConsultancyService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

const userIds: string[] = [];
const providerIds: string[] = [];
const offerIds: string[] = [];

async function makeClient() {
  const mpCustomerId = `cus_${uid("acc")}`;
  const client = await prisma.user.create({
    data: {
      name: "Cliente Aceite",
      email: `${uid("acc_client")}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
      role: "CLIENT",
      mpCustomerId,
      emailVerifiedAt: new Date()
    }
  });
  userIds.push(client.id);
  await prisma.clientAnamnesis.create({ data: { clientId: client.id, status: "COMPLETED", completedAt: new Date() } });
  await prisma.customerPaymentMethod.create({
    data: { userId: client.id, mpCustomerId, mpCardId: `card_${uid("c")}`, nickname: "Cartão", brand: "visa", last4: "4242", funding: "CREDIT" }
  });
  return client.id;
}

async function makeProviderWithRequest(clientId: string, connected: boolean) {
  const user = await prisma.user.create({
    data: { name: "Provider Aceite", email: `${uid("acc_provider")}@test.com`, password: "x", phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`, role: "PROVIDER" }
  });
  userIds.push(user.id);
  const provider = await prisma.providerProfile.create({
    data: {
      userId: user.id,
      displayName: "Provider Aceite",
      bio: "test",
      experienceYears: 3,
      priceCents: 20000,
      mpAccountId: "123456789",
      mpAccessToken: connected ? encryptSensitiveText("fake_access_token") : null,
      crefValidationStatus: "APPROVED"
    }
  });
  providerIds.push(provider.id);
  const offer = await prisma.providerServiceOffer.create({
    data: { providerId: provider.id, kind: "ONLINE_CONSULTANCY", title: "Consultoria", billingCycle: "MONTHLY", priceCents: 20000 }
  });
  offerIds.push(offer.id);
  return prisma.consultancyRequest.create({
    data: {
      providerId: provider.id,
      clientId,
      status: "RESPONDED",
      quotedOfferId: offer.id,
      responseDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      respondedAt: new Date()
    }
  });
}

describe("Aceitar proposta: falha na cobrança não deixa contrato órfão", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.consultancyContract.deleteMany({ where: { clientId: { in: userIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId: { in: userIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId: { in: userIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("profissional desconectado do Mercado Pago: recusa antes de criar o contrato", async () => {
    const clientId = await makeClient();
    const request = await makeProviderWithRequest(clientId, false);
    const paymentSpy = vi.spyOn(Payment.prototype, "create");

    await expect(
      consultancyService.decideRequest(clientId, request.id, {
        decision: "ACCEPT",
        paymentMethod: "PIX" as any,
        acknowledgedImmediateExecution: true
      })
    ).rejects.toThrow(/precisa ser reconectada/);

    expect(paymentSpy).not.toHaveBeenCalled();
    expect(await prisma.consultancyContract.count({ where: { requestId: request.id } })).toBe(0);
    expect((await prisma.consultancyRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("RESPONDED");
    expect((await getActiveEngagementSummary(clientId)).hasActive).toBe(false);
  });

  it("erro do Mercado Pago na cobrança: contrato some e a nova tentativa funciona", async () => {
    const clientId = await makeClient();
    const request = await makeProviderWithRequest(clientId, true);
    const input = { decision: "ACCEPT" as const, paymentMethod: "CREDIT_CARD" as any, acknowledgedImmediateExecution: true };

    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_acc" } as any);
    vi.spyOn(Payment.prototype, "create").mockRejectedValueOnce(new Error("Falha simulada do Mercado Pago"));
    await expect(consultancyService.decideRequest(clientId, request.id, input)).rejects.toThrow();

    expect(await prisma.consultancyContract.count({ where: { requestId: request.id } })).toBe(0);
    expect((await prisma.consultancyRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("RESPONDED");
    expect((await getActiveEngagementSummary(clientId)).hasActive).toBe(false);

    vi.spyOn(Payment.prototype, "create").mockResolvedValueOnce({ id: Date.now(), status: "authorized" } as any);
    const { contract } = await consultancyService.decideRequest(clientId, request.id, input);
    expect(contract!.status).toBe("ACTIVE");
  });
});
