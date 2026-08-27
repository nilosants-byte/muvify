import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { CardToken, Payment } from "mercadopago";
import {
  ConsultancyContractStatus,
  ConsultancyPaymentStatus,
  ConsultancyRequestStatus,
  OfferBillingCycle,
  ProviderSubscriptionStatus,
  ServiceOfferKind
} from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { ProviderSubscriptionService } from "../src/modules/providers/services/provider-subscription.service";
import { getActiveEngagementSummary } from "../src/shared/utils/client-engagement";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Raio-X pós-épico — "Lote 2" (altos), 2026-08-25:
// (1) oferta atual real (não mais adivinhada por `kind`) no resumo do
//     vínculo, base do fix de ProviderServicesUpgradeScreen;
// (2) cobrança da assinatura não dobra quando a chamada à MP lança um erro
//     de rede/timeout DEPOIS que a cobrança já foi processada de verdade do
//     outro lado — confere via `external_reference` antes de assumir falha.

const providerSubscriptionService = new ProviderSubscriptionService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function makeProvider(label: string, subscriptionStatus: ProviderSubscriptionStatus | null = ProviderSubscriptionStatus.ACTIVE) {
  const user = await prisma.user.create({
    data: {
      name: `RaioX ${label} Provider`,
      email: `${uid(`raiox2_${label}_prov`)}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}`,
      role: "PROVIDER"
    }
  });
  const profile = await prisma.providerProfile.create({
    data: {
      userId: user.id,
      displayName: `RaioX ${label} Provider`,
      bio: "test",
      experienceYears: 3,
      priceCents: 15000,
      mpAccountId: `${Math.floor(Math.random() * 1_000_000_000)}`,
      mpAccessToken: encryptSensitiveText("fake_access_token"),
      crefValidationStatus: "APPROVED"
    }
  });
  if (subscriptionStatus) {
    await prisma.providerSubscription.create({
      data: { providerId: profile.id, status: subscriptionStatus }
    });
  }
  return { userId: user.id, providerId: profile.id };
}

async function makeClient(label: string) {
  const user = await prisma.user.create({
    data: {
      name: `RaioX ${label} Client`,
      email: `${uid(`raiox2_${label}_client`)}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}`,
      role: "CLIENT",
      mpCustomerId: "cus_test_raiox2",
      emailVerifiedAt: new Date()
    }
  });
  return user.id;
}

const userIdsToCleanup = new Set<string>();
const providerProfileIdsToCleanup = new Set<string>();
const offerIdsToCleanup = new Set<string>();

describe("Raio-X pós-épico — Lote 2 (altos)", () => {
  beforeAll(async () => {
    await prisma.$connect();
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
  });

  afterAll(async () => {
    const userIds = Array.from(userIdsToCleanup);
    const providerIds = Array.from(providerProfileIdsToCleanup);
    const requestIds = (
      await prisma.consultancyRequest.findMany({ where: { clientId: { in: userIds } }, select: { id: true } })
    ).map((r) => r.id);
    await prisma.consultancyContract.deleteMany({ where: { clientId: { in: userIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: Array.from(offerIdsToCleanup) } } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.providerSubscription.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
  });

  it("[Alto 1] getActiveEngagementSummary devolve a oferta REAL do contrato, não a primeira do mesmo kind", async () => {
    const provider = await makeProvider("offerid1");
    providerProfileIdsToCleanup.add(provider.providerId);
    const client = await makeClient("offerid1");
    userIdsToCleanup.add(client);

    const offerA = await prisma.providerServiceOffer.create({
      data: {
        providerId: provider.providerId,
        kind: ServiceOfferKind.ONLINE_CONSULTANCY,
        title: "Plano A (mais barato)",
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 10000
      }
    });
    offerIdsToCleanup.add(offerA.id);
    const offerB = await prisma.providerServiceOffer.create({
      data: {
        providerId: provider.providerId,
        kind: ServiceOfferKind.ONLINE_CONSULTANCY,
        title: "Plano B (mais caro)",
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 20000
      }
    });
    offerIdsToCleanup.add(offerB.id);

    const now = new Date();
    const request = await prisma.consultancyRequest.create({
      data: {
        providerId: provider.providerId,
        clientId: client,
        status: ConsultancyRequestStatus.RESPONDED,
        quotedOfferId: offerB.id,
        responseDeadlineAt: now,
        respondedAt: now
      }
    });
    await prisma.consultancyContract.create({
      data: {
        requestId: request.id,
        providerId: provider.providerId,
        clientId: client,
        offerId: offerB.id,
        status: ConsultancyContractStatus.ACTIVE,
        paymentInstallments: 1,
        paymentStatus: ConsultancyPaymentStatus.CAPTURED,
        paymentAmountCents: 20000,
        providerAmountCents: 18000,
        platformAmountCents: 2000,
        paymentCapturedAt: now,
        deliveryDeadlineAt: now,
        immediateExecutionAcknowledgedAt: now,
        billingCycle: OfferBillingCycle.MONTHLY,
        kind: ServiceOfferKind.ONLINE_CONSULTANCY
      }
    });

    const summary = await getActiveEngagementSummary(client);
    expect(summary.hasActive).toBe(true);
    if (summary.hasActive) {
      expect(summary.offerId).toBe(offerB.id);
      expect(summary.offerId).not.toBe(offerA.id);
    }
  });

  it("[Alto 2] erro de rede na cobrança não dobra quando a MP já tinha aprovado do outro lado", async () => {
    const provider = await makeProvider("verify1", ProviderSubscriptionStatus.PENDING_PAYMENT);
    providerProfileIdsToCleanup.add(provider.providerId);
    await prisma.user.update({ where: { id: provider.userId }, data: { mpCustomerId: "cus_test_raiox2_billing" } });
    await prisma.customerPaymentMethod.create({
      data: {
        userId: provider.userId,
        mpCustomerId: "cus_test_raiox2_billing",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });
    await prisma.providerSubscription.update({
      where: { providerId: provider.providerId },
      data: { nextBillingAt: new Date(Date.now() - 60 * 1000) }
    });

    vi.spyOn(Payment.prototype, "create").mockRejectedValue(new Error("ETIMEDOUT"));
    const searchSpy = vi.spyOn(Payment.prototype, "search").mockResolvedValue({
      results: [{ id: "mp_ghost_approved", status: "approved" }]
    } as any);

    await providerSubscriptionService.runSubscriptionBilling(new Date());

    const after = await prisma.providerSubscription.findUniqueOrThrow({ where: { providerId: provider.providerId } });
    expect(after.status).toBe(ProviderSubscriptionStatus.ACTIVE);
    expect(after.lastMpPaymentId).toBe("mp_ghost_approved");
    expect(after.billingCycleIndex).toBe(1);
    expect(after.consecutiveFailedCharges).toBe(0);
    expect(searchSpy).toHaveBeenCalledTimes(1);
    const searchArg = searchSpy.mock.calls[0][0] as any;
    expect(searchArg.options.external_reference).toContain(`provider-subscription:${after.id}:cycle:0`);
  });

  it("[Alto 2b, regressão] erro de rede sem cobrança real do outro lado continua marcando falha (sem dobrar no ar)", async () => {
    const provider = await makeProvider("verify2", ProviderSubscriptionStatus.PENDING_PAYMENT);
    providerProfileIdsToCleanup.add(provider.providerId);
    await prisma.user.update({ where: { id: provider.userId }, data: { mpCustomerId: "cus_test_raiox2_billing2" } });
    await prisma.customerPaymentMethod.create({
      data: {
        userId: provider.userId,
        mpCustomerId: "cus_test_raiox2_billing2",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });
    await prisma.providerSubscription.update({
      where: { providerId: provider.providerId },
      data: { nextBillingAt: new Date(Date.now() - 60 * 1000) }
    });

    vi.spyOn(Payment.prototype, "create").mockRejectedValue(new Error("ECONNRESET"));
    vi.spyOn(Payment.prototype, "search").mockResolvedValue({ results: [] } as any);

    await providerSubscriptionService.runSubscriptionBilling(new Date());

    const after = await prisma.providerSubscription.findUniqueOrThrow({ where: { providerId: provider.providerId } });
    expect(after.status).toBe(ProviderSubscriptionStatus.PENDING_PAYMENT);
    expect(after.consecutiveFailedCharges).toBe(1);
    expect(after.billingCycleIndex).toBe(0);
  });
});
