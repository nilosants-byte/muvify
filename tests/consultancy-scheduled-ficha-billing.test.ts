import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { Payment, CardToken } from "mercadopago";
import {
  ConsultancyContractStatus,
  ConsultancyPaymentStatus,
  ConsultancyPaymentMethod,
  ServiceOfferKind
} from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Achado em teste manual QA (2026-09-20): entregar a ficha do próximo ciclo
// ANTES do vencimento fazia a cobrança daquele ciclo nunca disparar (o
// sistema via como "adição gratuita" em vez de início de ciclo novo).
// Este arquivo cobre o novo motor de cobrança agendada (chargeDueFichaRenewals/
// chargeFichaRenewalCycle) isoladamente, por analogia aos testes do mesmo
// padrão já usado no pacote presencial (chargeDueCycles/chargeCycle) —
// ainda sem depender de deliverContract estar "cortado" (isso é o próximo
// commit do plano).

const consultancyService = new ConsultancyService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe("Cobrança de ficha por calendário fixo — motor automático", () => {
  let clientId = "";
  let providerUserId = "";
  let providerId = "";
  let categoryId = "";
  const offerIds: string[] = [];
  const contractIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `CSFB_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Calendario Fixo Client",
        email: `${uid("csfb_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        mpCustomerId: "cus_test_csfb"
      }
    });
    clientId = client.id;

    await prisma.customerPaymentMethod.create({
      data: {
        userId: clientId,
        mpCustomerId: "cus_test_csfb",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });

    const providerUser = await prisma.user.create({
      data: {
        name: "Calendario Fixo Provider",
        email: `${uid("csfb_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Calendario Fixo Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 20000,
        mpAccountId: "555444333",
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
    await prisma.trainingPlan.deleteMany({ where: { providerId } });
    await prisma.consultancyContract.deleteMany({ where: { clientId } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  async function makeOffer() {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: ServiceOfferKind.ONLINE_CONSULTANCY,
        title: `Consultoria ${uid("offer")}`,
        billingCycle: "MONTHLY",
        priceCents: 20000,
        fichaValidityDays: 30
      }
    });
    offerIds.push(offer.id);
    return offer;
  }

  // Simula o estado que deliverContract deixaria pra um contrato já
  // "entregue" (status DELIVERED, nextBillingAt/lastBilledContentAt
  // setados, uma ficha ativa) - o corte real de deliverContract é o
  // próximo commit do plano, este arquivo testa o motor de cobrança
  // isoladamente por enquanto.
  async function makeDeliveredContract(opts: {
    nextBillingAt: Date;
    lastBilledContentAt: Date | null;
    planCreatedAt: Date;
    consecutiveFailedRenewalCycles?: number;
    nextRenewalCycleIndex?: number;
    paymentMethod?: ConsultancyPaymentMethod;
  }) {
    const offer = await makeOffer();
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
    const deliveredAt = new Date(Date.now() - 40 * DAY_MS);
    const contract = await prisma.consultancyContract.create({
      data: {
        requestId: request.id,
        providerId,
        clientId,
        offerId: offer.id,
        status: ConsultancyContractStatus.DELIVERED,
        paymentMethod: opts.paymentMethod ?? ConsultancyPaymentMethod.CREDIT_CARD,
        paymentStatus: ConsultancyPaymentStatus.CAPTURED,
        paymentAmountCents: 20000,
        providerAmountCents: 18000,
        platformAmountCents: 2000,
        billingCycle: "MONTHLY",
        kind: ServiceOfferKind.ONLINE_CONSULTANCY,
        fichaValidityDays: 30,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date(),
        deliveredAt,
        nextBillingAt: opts.nextBillingAt,
        lastBilledContentAt: opts.lastBilledContentAt,
        consecutiveFailedRenewalCycles: opts.consecutiveFailedRenewalCycles ?? 0,
        nextRenewalCycleIndex: opts.nextRenewalCycleIndex ?? 1
      }
    });
    contractIds.push(contract.id);

    const plan = await prisma.trainingPlan.create({
      data: {
        providerId,
        contractId: contract.id,
        title: "Treino existente",
        isPrebuilt: false,
        isActive: true,
        validUntil: opts.nextBillingAt,
        createdAt: opts.planCreatedAt
      }
    });

    return { contract, plan };
  }

  it("sem conteúdo novo desde a última cobrança: não cobra, não mexe em nextBillingAt", async () => {
    const paymentCreateSpy = vi.spyOn(Payment.prototype, "create");
    const now = new Date();
    const lastBilledContentAt = new Date(now.getTime() - 5 * DAY_MS);
    const { contract } = await makeDeliveredContract({
      nextBillingAt: new Date(now.getTime() - DAY_MS),
      lastBilledContentAt,
      // Ficha existente é MAIS ANTIGA que a última cobrança - nada novo.
      planCreatedAt: new Date(lastBilledContentAt.getTime() - DAY_MS)
    });

    await consultancyService.chargeDueFichaRenewals();

    expect(paymentCreateSpy).not.toHaveBeenCalled();
    const after = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(after.nextBillingAt!.getTime()).toBe(contract.nextBillingAt!.getTime());
    expect(after.consecutiveFailedRenewalCycles).toBe(0);
    expect(after.status).toBe(ConsultancyContractStatus.DELIVERED);
  });

  it("com conteúdo novo e cobrança aprovada: cobra, avança nextBillingAt a partir do valor antigo, estende a ficha", async () => {
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
    vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 9001, status: "approved" } as any);

    const now = new Date();
    const oldNextBillingAt = new Date(now.getTime() - DAY_MS);
    const lastBilledContentAt = new Date(now.getTime() - 35 * DAY_MS);
    const { contract, plan } = await makeDeliveredContract({
      nextBillingAt: oldNextBillingAt,
      lastBilledContentAt,
      // Ficha criada DEPOIS da última cobrança - conta como conteúdo novo.
      planCreatedAt: new Date(now.getTime() - 2 * DAY_MS)
    });

    await consultancyService.chargeDueFichaRenewals();

    const after = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    const expectedNextBillingAt = new Date(oldNextBillingAt.getTime() + 30 * DAY_MS);
    expect(after.nextBillingAt!.getTime()).toBe(expectedNextBillingAt.getTime());
    expect(after.nextRenewalCycleIndex).toBe(2);
    expect(after.consecutiveFailedRenewalCycles).toBe(0);

    const planAfter = await prisma.trainingPlan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(planAfter.isActive).toBe(true);
    expect(planAfter.validUntil!.getTime()).toBe(expectedNextBillingAt.getTime());
    expect(planAfter.renewalMpPaymentId).toBe("9001");
  });

  it("cobrança recusada: incrementa consecutiveFailedRenewalCycles e agenda retry em 24h, sem cancelar", async () => {
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
    vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 9002, status: "rejected", status_detail: "cc_rejected_other_reason" } as any);

    const now = new Date();
    const { contract } = await makeDeliveredContract({
      nextBillingAt: new Date(now.getTime() - DAY_MS),
      lastBilledContentAt: new Date(now.getTime() - 35 * DAY_MS),
      planCreatedAt: new Date(now.getTime() - 2 * DAY_MS)
    });

    await consultancyService.chargeDueFichaRenewals();

    const after = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(after.status).toBe(ConsultancyContractStatus.DELIVERED);
    expect(after.consecutiveFailedRenewalCycles).toBe(1);
    expect(after.lastRenewalFailureReason).toMatch(/recusado/i);
    // Retry ~24h à frente (não usa o calendário original de fichaValidityDays).
    expect(after.nextBillingAt!.getTime()).toBeGreaterThan(now.getTime() + 23 * 60 * 60 * 1000);
    expect(after.nextBillingAt!.getTime()).toBeLessThan(now.getTime() + 25 * 60 * 60 * 1000);
  });

  it("3ª falha consecutiva cancela o contrato automaticamente", async () => {
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
    vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 9003, status: "rejected", status_detail: "cc_rejected_other_reason" } as any);

    const now = new Date();
    const { contract } = await makeDeliveredContract({
      nextBillingAt: new Date(now.getTime() - DAY_MS),
      lastBilledContentAt: new Date(now.getTime() - 35 * DAY_MS),
      planCreatedAt: new Date(now.getTime() - 2 * DAY_MS),
      consecutiveFailedRenewalCycles: 2
    });

    await consultancyService.chargeDueFichaRenewals();

    const after = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(after.status).toBe(ConsultancyContractStatus.CANCELLED);
    expect(after.consecutiveFailedRenewalCycles).toBe(3);
    // Congela o calendário em vez de agendar mais um retry.
    expect(after.nextBillingAt!.getTime()).toBe(contract.nextBillingAt!.getTime());
  });

  it("consultoria paga por Pix não permite renovação automática (falha tratada, não exceção)", async () => {
    const paymentCreateSpy = vi.spyOn(Payment.prototype, "create");

    const now = new Date();
    const { contract } = await makeDeliveredContract({
      nextBillingAt: new Date(now.getTime() - DAY_MS),
      lastBilledContentAt: new Date(now.getTime() - 35 * DAY_MS),
      planCreatedAt: new Date(now.getTime() - 2 * DAY_MS),
      paymentMethod: ConsultancyPaymentMethod.PIX
    });

    await expect(consultancyService.chargeDueFichaRenewals()).resolves.not.toThrow();

    expect(paymentCreateSpy).not.toHaveBeenCalled();
    const after = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(after.consecutiveFailedRenewalCycles).toBe(1);
    expect(after.lastRenewalFailureReason).toMatch(/pix/i);
  });

  it("profissional desconectado do Mercado Pago: falha tratada com aviso de reconexão, sem exceção", async () => {
    const paymentCreateSpy = vi.spyOn(Payment.prototype, "create");
    const disconnectedProvider = await prisma.providerProfile.create({
      data: {
        userId: (
          await prisma.user.create({
            data: {
              name: "Provider Desconectado",
              email: `${uid("csfb_disconnected")}@test.com`,
              password: "x",
              phone: `11${Date.now().toString().slice(-9)}3`,
              role: "PROVIDER"
            }
          })
        ).id,
        displayName: "Provider Desconectado",
        bio: "test",
        experienceYears: 1,
        priceCents: 20000,
        crefValidationStatus: "APPROVED"
        // sem mpAccountId/mpAccessToken - nunca conectou o Mercado Pago.
      }
    });

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId: disconnectedProvider.id,
        kind: ServiceOfferKind.ONLINE_CONSULTANCY,
        title: `Consultoria ${uid("offer")}`,
        billingCycle: "MONTHLY",
        priceCents: 20000,
        fichaValidityDays: 30
      }
    });
    const request = await prisma.consultancyRequest.create({
      data: {
        providerId: disconnectedProvider.id,
        clientId,
        status: "ACCEPTED",
        quotedOfferId: offer.id,
        responseDeadlineAt: new Date(),
        respondedAt: new Date(),
        clientDecisionAt: new Date()
      }
    });
    const now = new Date();
    const contract = await prisma.consultancyContract.create({
      data: {
        requestId: request.id,
        providerId: disconnectedProvider.id,
        clientId,
        offerId: offer.id,
        status: ConsultancyContractStatus.DELIVERED,
        paymentMethod: ConsultancyPaymentMethod.CREDIT_CARD,
        paymentStatus: ConsultancyPaymentStatus.CAPTURED,
        paymentAmountCents: 20000,
        providerAmountCents: 18000,
        platformAmountCents: 2000,
        billingCycle: "MONTHLY",
        kind: ServiceOfferKind.ONLINE_CONSULTANCY,
        fichaValidityDays: 30,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date(),
        deliveredAt: new Date(now.getTime() - 40 * DAY_MS),
        nextBillingAt: new Date(now.getTime() - DAY_MS),
        lastBilledContentAt: new Date(now.getTime() - 35 * DAY_MS)
      }
    });
    await prisma.trainingPlan.create({
      data: {
        providerId: disconnectedProvider.id,
        contractId: contract.id,
        title: "Treino existente",
        isPrebuilt: false,
        isActive: true,
        validUntil: contract.nextBillingAt,
        createdAt: new Date(now.getTime() - 2 * DAY_MS)
      }
    });

    await expect(consultancyService.chargeDueFichaRenewals()).resolves.not.toThrow();

    expect(paymentCreateSpy).not.toHaveBeenCalled();
    const after = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(after.consecutiveFailedRenewalCycles).toBe(1);
    expect(after.lastRenewalFailureReason).toMatch(/reconectad/i);

    await prisma.trainingPlan.deleteMany({ where: { contractId: contract.id } });
    await prisma.consultancyContract.deleteMany({ where: { id: contract.id } });
    await prisma.consultancyRequest.deleteMany({ where: { id: request.id } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: offer.id } });
    await prisma.providerProfile.deleteMany({ where: { id: disconnectedProvider.id } });
    await prisma.user.deleteMany({ where: { id: disconnectedProvider.userId } });
  });

  it("contrato com renewalDeliveryLockedAt recente (entrega em andamento) é pulado nesse tick", async () => {
    const paymentCreateSpy = vi.spyOn(Payment.prototype, "create");
    const now = new Date();
    const { contract } = await makeDeliveredContract({
      nextBillingAt: new Date(now.getTime() - DAY_MS),
      lastBilledContentAt: new Date(now.getTime() - 35 * DAY_MS),
      planCreatedAt: new Date(now.getTime() - 2 * DAY_MS)
    });

    await prisma.consultancyContract.update({
      where: { id: contract.id },
      data: { renewalDeliveryLockedAt: now }
    });

    await consultancyService.chargeDueFichaRenewals();

    expect(paymentCreateSpy).not.toHaveBeenCalled();
    const after = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    // Nem cobrou, nem contou como falha - só pulou pra tentar de novo depois.
    expect(after.consecutiveFailedRenewalCycles).toBe(0);
    expect(after.nextBillingAt!.getTime()).toBe(contract.nextBillingAt!.getTime());
  });
});
