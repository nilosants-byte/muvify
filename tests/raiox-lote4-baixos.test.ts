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
import { FavoriteService } from "../src/modules/favorites/services/favorite.service";
import { getActiveEngagementSummary } from "../src/shared/utils/client-engagement";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Raio-X pós-épico — "Lote 4" (baixos), 2026-08-25: cobrança em análise
// (in_process/pending) não avança o contador de tentativas (evita cobrar em
// dobro se resolver aprovada depois), listagem de favoritos não vaza mais o
// telefone do profissional, e o resumo de vínculo ativo agora expõe
// `origin` (contexto do aluno externo no card de plano).

const providerSubscriptionService = new ProviderSubscriptionService();
const favoriteService = new FavoriteService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function makeProvider(label: string, subscriptionStatus: ProviderSubscriptionStatus | null = ProviderSubscriptionStatus.ACTIVE) {
  const user = await prisma.user.create({
    data: {
      name: `RaioX ${label} Provider`,
      email: `${uid(`raiox4_${label}_prov`)}@test.com`,
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
      email: `${uid(`raiox4_${label}_client`)}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}`,
      role: "CLIENT",
      emailVerifiedAt: new Date()
    }
  });
  return user.id;
}

const userIdsToCleanup = new Set<string>();
const providerProfileIdsToCleanup = new Set<string>();
const offerIdsToCleanup = new Set<string>();

describe("Raio-X pós-épico — Lote 4 (baixos)", () => {
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
    await prisma.favorite.deleteMany({ where: { userId: { in: userIds } } });
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

  it("[Baixo] cobrança em análise (in_process) não avança o contador de tentativas nem marca falha definitiva", async () => {
    const provider = await makeProvider("inprocess1", ProviderSubscriptionStatus.PENDING_PAYMENT);
    providerProfileIdsToCleanup.add(provider.providerId);
    await prisma.user.update({ where: { id: provider.userId }, data: { mpCustomerId: "cus_test_raiox4_inprocess" } });
    await prisma.customerPaymentMethod.create({
      data: {
        userId: provider.userId,
        mpCustomerId: "cus_test_raiox4_inprocess",
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

    vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: "mp_inprocess", status: "in_process" } as any);

    await providerSubscriptionService.runSubscriptionBilling(new Date());

    const after = await prisma.providerSubscription.findUniqueOrThrow({ where: { providerId: provider.providerId } });
    expect(after.status).toBe(ProviderSubscriptionStatus.PENDING_PAYMENT);
    expect(after.lastChargeStatus).toBe("PENDING");
    // Não avança — mesma idempotencyKey amanhã, pra recuperar o resultado
    // final desta cobrança em vez de criar uma nova.
    expect(after.consecutiveFailedCharges).toBe(0);
    expect(after.billingCycleIndex).toBe(0);
  });

  it("[Baixo] cobrança rejeitada de verdade (definitiva) continua avançando o contador normalmente", async () => {
    const provider = await makeProvider("rejected1", ProviderSubscriptionStatus.PENDING_PAYMENT);
    providerProfileIdsToCleanup.add(provider.providerId);
    await prisma.user.update({ where: { id: provider.userId }, data: { mpCustomerId: "cus_test_raiox4_rejected" } });
    await prisma.customerPaymentMethod.create({
      data: {
        userId: provider.userId,
        mpCustomerId: "cus_test_raiox4_rejected",
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

    vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: "mp_rejected", status: "rejected" } as any);

    await providerSubscriptionService.runSubscriptionBilling(new Date());

    const after = await prisma.providerSubscription.findUniqueOrThrow({ where: { providerId: provider.providerId } });
    expect(after.lastChargeStatus).toBe("FAILED");
    expect(after.consecutiveFailedCharges).toBe(1);
  });

  it("[Baixo] listagem de favoritos não expõe mais o telefone pessoal do profissional", async () => {
    const provider = await makeProvider("favphone1");
    providerProfileIdsToCleanup.add(provider.providerId);
    const client = await makeClient("favphone1");
    userIdsToCleanup.add(client);

    await favoriteService.add(client, provider.providerId);
    const list = await favoriteService.list(client);

    expect(list.length).toBeGreaterThan(0);
    for (const fav of list) {
      expect((fav.provider.user as any).phone).toBeUndefined();
    }
  });

  it("[Baixo] getActiveEngagementSummary expõe origin (EXTERNAL) pro card de plano dar contexto ao aluno", async () => {
    const provider = await makeProvider("origin1");
    providerProfileIdsToCleanup.add(provider.providerId);
    const client = await makeClient("origin1");
    userIdsToCleanup.add(client);

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId: provider.providerId,
        kind: ServiceOfferKind.ONLINE_CONSULTANCY,
        title: "Consultoria externa (cadastro manual)",
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 0,
        isActive: false
      }
    });
    offerIdsToCleanup.add(offer.id);
    const now = new Date();
    const request = await prisma.consultancyRequest.create({
      data: {
        providerId: provider.providerId,
        clientId: client,
        status: ConsultancyRequestStatus.RESPONDED,
        quotedOfferId: offer.id,
        responseDeadlineAt: now,
        respondedAt: now
      }
    });
    await prisma.consultancyContract.create({
      data: {
        requestId: request.id,
        providerId: provider.providerId,
        clientId: client,
        offerId: offer.id,
        origin: "EXTERNAL",
        status: ConsultancyContractStatus.ACTIVE,
        paymentInstallments: 1,
        paymentStatus: ConsultancyPaymentStatus.CAPTURED,
        paymentAmountCents: 0,
        providerAmountCents: 0,
        platformAmountCents: 0,
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
      expect(summary.origin).toBe("EXTERNAL");
    }
  });

  it("[Baixo] getActiveEngagementSummary devolve origin null pro vínculo de marketplace normal", async () => {
    const provider = await makeProvider("origin2");
    providerProfileIdsToCleanup.add(provider.providerId);
    const client = await makeClient("origin2");
    userIdsToCleanup.add(client);

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId: provider.providerId,
        kind: ServiceOfferKind.ONLINE_CONSULTANCY,
        title: "Oferta normal",
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 9000
      }
    });
    offerIdsToCleanup.add(offer.id);
    const now = new Date();
    const request = await prisma.consultancyRequest.create({
      data: {
        providerId: provider.providerId,
        clientId: client,
        status: ConsultancyRequestStatus.RESPONDED,
        quotedOfferId: offer.id,
        responseDeadlineAt: now,
        respondedAt: now
      }
    });
    await prisma.consultancyContract.create({
      data: {
        requestId: request.id,
        providerId: provider.providerId,
        clientId: client,
        offerId: offer.id,
        status: ConsultancyContractStatus.ACTIVE,
        paymentInstallments: 1,
        paymentStatus: ConsultancyPaymentStatus.CAPTURED,
        paymentAmountCents: 9000,
        providerAmountCents: 8000,
        platformAmountCents: 1000,
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
      expect(summary.origin).toBe("MARKETPLACE");
    }
  });
});
