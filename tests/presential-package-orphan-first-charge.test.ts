import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { Payment, CardToken } from "mercadopago";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";
import { prisma } from "../src/config/prisma";
import { encryptSensitiveText } from "../src/shared/utils/encryption";
import { getActiveEngagementSummary } from "../src/shared/utils/client-engagement";

// Achado no teste manual do checklist (C6.1, 17/10/2026): na compra de
// pacote (horário fixo em Pix) e de combo, o pacote era reservado como
// PENDING_PAYMENT ANTES da primeira cobrança. Se ela falhasse (conexão do
// profissional com o Mercado Pago quebrada, Pix/cartão recusado, combo no
// cartão sem cartão salvo), o pacote — e no combo, o contrato — ficavam
// órfãos: a nova tentativa batia em "você já possui um pacote ativo (ou
// pendente)" e o registro fantasma ainda contava como vínculo ativo,
// prendendo o aluno àquele profissional.

const packageService = new PresentialPackageService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let categoryId = "";
let disconnectedProviderId = "";
let connectedProviderId = "";
const userIds: string[] = [];
const providerIds: string[] = [];
const offerIds: string[] = [];

async function createClient(opts: { withCard: boolean }) {
  const mpCustomerId = opts.withCard ? `cus_${uid("orf")}` : null;
  const client = await prisma.user.create({
    data: {
      name: "Cliente Pacote Orfao",
      email: `${uid("orf_client")}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
      role: "CLIENT",
      mpCustomerId,
      emailVerifiedAt: new Date()
    }
  });
  userIds.push(client.id);
  await prisma.clientAnamnesis.create({ data: { clientId: client.id, status: "COMPLETED", completedAt: new Date() } });
  if (opts.withCard && mpCustomerId) {
    await prisma.customerPaymentMethod.create({
      data: {
        userId: client.id,
        mpCustomerId,
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });
  }
  return client.id;
}

async function createProvider(opts: { connected: boolean }) {
  const user = await prisma.user.create({
    data: {
      name: "Provider Pacote Orfao",
      email: `${uid("orf_provider")}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
      role: "PROVIDER"
    }
  });
  userIds.push(user.id);
  const provider = await prisma.providerProfile.create({
    data: {
      userId: user.id,
      displayName: "Provider Pacote Orfao",
      bio: "test",
      experienceYears: 3,
      priceCents: 10000,
      // Conta MP "configurada" (mpAccountId) mas sem token válido — o caso
      // de uma conexão que expirou/foi revogada e precisa ser refeita.
      mpAccountId: "777666555",
      mpAccessToken: opts.connected ? encryptSensitiveText("fake_access_token") : null,
      crefValidationStatus: "APPROVED"
    }
  });
  providerIds.push(provider.id);
  return provider.id;
}

async function createOffer(
  providerId: string,
  data: { kind: "PRESENTIAL" | "COMBO"; mode: "FIXED_RECURRING" | "FLEXIBLE_CREDITS" }
) {
  const offer = await prisma.providerServiceOffer.create({
    data: {
      providerId,
      kind: data.kind,
      title: `Oferta ${uid("orf")}`,
      billingCycle: "MONTHLY",
      priceCents: data.kind === "COMBO" ? 90000 : 40000,
      presentialPackageMode: data.mode,
      presentialSessionsPerCycle: 4,
      presentialHasFixedTerm: data.mode === "FLEXIBLE_CREDITS",
      presentialTotalCycles: data.mode === "FLEXIBLE_CREDITS" ? 1 : null,
      acceptsPix: true,
      acceptsCreditCard: true,
      ...(data.kind === "COMBO"
        ? {
            comboPresentialShareCents: 60000,
            comboConsultancyShareCents: 30000,
            comboPresentialDaysPerWeek: 2,
            comboOnlineDaysPerWeek: 3
          }
        : {})
    }
  });
  offerIds.push(offer.id);
  return offer.id;
}

describe("Compra de pacote/combo: falha na primeira cobrança não deixa pacote órfão", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const category = await prisma.serviceCategory.create({ data: { name: `ORF_${Date.now()}`, description: "test" } });
    categoryId = category.id;
    disconnectedProviderId = await createProvider({ connected: false });
    connectedProviderId = await createProvider({ connected: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    const clientIds = userIds;
    await prisma.consultancyContract.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.presentialPackage.deleteMany({ where: { offerId: { in: offerIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: { in: clientIds } } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("pacote horário fixo em Pix com o profissional desconectado do Mercado Pago: recusa antes de reservar nada", async () => {
    const clientId = await createClient({ withCard: false });
    const offerId = await createOffer(disconnectedProviderId, { kind: "PRESENTIAL", mode: "FIXED_RECURRING" });
    const paymentCreateSpy = vi.spyOn(Payment.prototype, "create");

    await expect(
      packageService.purchasePackage(clientId, {
        offerId,
        categoryId,
        paymentMethod: "PIX" as any,
        weeklySchedule: [{ weekday: 1, time: "08:00" }]
      })
    ).rejects.toThrow(/precisa ser reconectada/);

    expect(paymentCreateSpy).not.toHaveBeenCalled();
    expect(await prisma.presentialPackage.count({ where: { clientId, offerId } })).toBe(0);
    // O aluno não pode ficar preso a esse profissional por causa de uma compra que nunca aconteceu.
    expect((await getActiveEngagementSummary(clientId)).hasActive).toBe(false);
  });

  it("pacote horário fixo em Pix recusado na primeira cobrança: pacote é cancelado e a nova tentativa funciona", async () => {
    const clientId = await createClient({ withCard: false });
    const offerId = await createOffer(connectedProviderId, { kind: "PRESENTIAL", mode: "FIXED_RECURRING" });
    const input = {
      offerId,
      categoryId,
      paymentMethod: "PIX" as any,
      weeklySchedule: [{ weekday: 1, time: "08:00" }]
    };

    vi.spyOn(Payment.prototype, "create").mockResolvedValueOnce({ id: 9100, status: "rejected" } as any);
    await expect(packageService.purchasePackage(clientId, input)).rejects.toThrow(/não foi aprovado/);

    const failed = await prisma.presentialPackage.findMany({ where: { clientId, offerId } });
    expect(failed).toHaveLength(1);
    expect(failed[0].status).toBe("CANCELLED");

    // Antes desta correção, isto batia em "Você já possui um pacote ativo (ou pendente) para esta oferta."
    vi.spyOn(Payment.prototype, "create").mockResolvedValueOnce({ id: 9101, status: "pending" } as any);
    const retry = await packageService.purchasePackage(clientId, input);
    expect(retry.payment.status).toBe("PENDING");
  });

  it("combo com o profissional desconectado do Mercado Pago: recusa antes de reservar pacote ou criar contrato", async () => {
    const clientId = await createClient({ withCard: true });
    const offerId = await createOffer(disconnectedProviderId, { kind: "COMBO", mode: "FLEXIBLE_CREDITS" });
    const paymentCreateSpy = vi.spyOn(Payment.prototype, "create");

    await expect(
      packageService.purchaseCombo(clientId, {
        offerId,
        categoryId,
        paymentMethod: "CREDIT_CARD" as any,
        acknowledgedImmediateExecution: true
      })
    ).rejects.toThrow(/precisa ser reconectada/);

    expect(paymentCreateSpy).not.toHaveBeenCalled();
    expect(await prisma.presentialPackage.count({ where: { clientId, offerId } })).toBe(0);
    expect(await prisma.consultancyContract.count({ where: { clientId, offerId } })).toBe(0);
    expect((await getActiveEngagementSummary(clientId)).hasActive).toBe(false);
  });

  it("combo no cartão sem cartão salvo: recusa antes de reservar pacote ou criar contrato", async () => {
    const clientId = await createClient({ withCard: false });
    const offerId = await createOffer(connectedProviderId, { kind: "COMBO", mode: "FLEXIBLE_CREDITS" });

    await expect(
      packageService.purchaseCombo(clientId, {
        offerId,
        categoryId,
        paymentMethod: "CREDIT_CARD" as any,
        acknowledgedImmediateExecution: true
      })
    ).rejects.toThrow();

    expect(await prisma.presentialPackage.count({ where: { clientId, offerId } })).toBe(0);
    expect(await prisma.consultancyContract.count({ where: { clientId, offerId } })).toBe(0);
  });

  it("combo com o cartão recusado na cobrança da consultoria: pacote e contrato cancelados, nova tentativa funciona", async () => {
    const clientId = await createClient({ withCard: true });
    const offerId = await createOffer(connectedProviderId, { kind: "COMBO", mode: "FLEXIBLE_CREDITS" });
    const input = {
      offerId,
      categoryId,
      paymentMethod: "CREDIT_CARD" as any,
      acknowledgedImmediateExecution: true
    };

    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_orf" } as any);
    vi.spyOn(Payment.prototype, "create").mockResolvedValueOnce({ id: 9200, status: "rejected" } as any);
    await expect(packageService.purchaseCombo(clientId, input)).rejects.toThrow(/não foi aprovado/);

    const pkgs = await prisma.presentialPackage.findMany({ where: { clientId, offerId } });
    expect(pkgs).toHaveLength(1);
    expect(pkgs[0].status).toBe("CANCELLED");
    const contracts = await prisma.consultancyContract.findMany({ where: { clientId, offerId } });
    expect(contracts).toHaveLength(1);
    expect(contracts[0].status).toBe("CANCELLED");
    expect(contracts[0].paymentStatus).toBe("FAILED");
    expect((await getActiveEngagementSummary(clientId)).hasActive).toBe(false);

    // Antes desta correção, isto batia em "Você já possui um combo ativo (ou pendente) para esta oferta."
    vi.spyOn(Payment.prototype, "create").mockResolvedValueOnce({ id: 9201, status: "authorized" } as any);
    const retry = await packageService.purchaseCombo(clientId, input);
    expect(retry.consultancyPayment.status).toBe("AUTHORIZED");
    expect(retry.presentialPayment.status).toBe("READY");
  });
});
