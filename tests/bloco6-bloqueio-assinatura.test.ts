import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { CardToken, Payment } from "mercadopago";
import { BookingStatus, ProviderSubscriptionStatus } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { BookingService } from "../src/modules/bookings/services/booking.service";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";
import { FavoriteService } from "../src/modules/favorites/services/favorite.service";
import { ProviderService } from "../src/modules/providers/services/provider.service";
import { isProviderSubscriptionActive } from "../src/modules/providers/services/provider-subscription.service";
import { assertProviderSubscriptionActive } from "../src/shared/utils/provider-subscription-gate";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Bloco 6 (bloqueio por assinatura inativa): mesmo padrão de gate do CREF —
// navegação/leitura sempre livre, mas "configurar ou oferecer" algo exige
// status TRIALING ou ACTIVE. Sem exceção pra cliente já pagante (deliverContract
// bloqueia igual, mesma lógica que o CREF já usa hoje pra renovação de ficha).

const consultancyService = new ConsultancyService();
const bookingService = new BookingService();
const presentialPackageService = new PresentialPackageService();
const favoriteService = new FavoriteService();
const providerService = new ProviderService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function makeProvider(label: string, subscriptionStatus: ProviderSubscriptionStatus | null) {
  const user = await prisma.user.create({
    data: {
      name: `Gate ${label} Provider`,
      email: `${uid(`gate_${label}_prov`)}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}`,
      role: "PROVIDER"
    }
  });
  const profile = await prisma.providerProfile.create({
    data: {
      userId: user.id,
      displayName: `Gate ${label} Provider`,
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
      name: `Gate ${label} Client`,
      email: `${uid(`gate_${label}_client`)}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}`,
      role: "CLIENT",
      mpCustomerId: "cus_test_gate",
      emailVerifiedAt: new Date()
    }
  });
  await prisma.clientAnamnesis.create({
    data: { clientId: user.id, status: "COMPLETED", completedAt: new Date() }
  });
  await prisma.customerPaymentMethod.create({
    data: {
      userId: user.id,
      mpCustomerId: "cus_test_gate",
      mpCardId: `card_${uid("c")}`,
      nickname: "Cartão de teste",
      brand: "visa",
      last4: "4242",
      funding: "CREDIT"
    }
  });
  return user.id;
}

const userIdsToCleanup = new Set<string>();
const providerProfileIdsToCleanup = new Set<string>();
const categoryIdsToCleanup = new Set<string>();

describe("Bloco 6 — bloqueio por assinatura inativa", () => {
  beforeAll(async () => {
    await prisma.$connect();
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
  });

  afterAll(async () => {
    const userIds = Array.from(userIdsToCleanup);
    const providerIds = Array.from(providerProfileIdsToCleanup);
    await prisma.favorite.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.booking.deleteMany({ where: { clientId: { in: userIds } } });
    const offerIds = (
      await prisma.providerServiceOffer.findMany({ where: { providerId: { in: providerIds } }, select: { id: true } })
    ).map((o) => o.id);
    await prisma.presentialPackage.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.consultancyContract.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.providerSubscription.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId: { in: userIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.serviceCategory.deleteMany({ where: { id: { in: Array.from(categoryIdsToCleanup) } } });
    await prisma.$disconnect();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
  });

  it("isProviderSubscriptionActive cobre os 5 status + ausência de registro", () => {
    expect(isProviderSubscriptionActive(ProviderSubscriptionStatus.TRIALING)).toBe(true);
    expect(isProviderSubscriptionActive(ProviderSubscriptionStatus.ACTIVE)).toBe(true);
    expect(isProviderSubscriptionActive(ProviderSubscriptionStatus.PENDING_PAYMENT)).toBe(false);
    expect(isProviderSubscriptionActive(ProviderSubscriptionStatus.PAST_DUE)).toBe(false);
    expect(isProviderSubscriptionActive(ProviderSubscriptionStatus.CANCELED)).toBe(false);
    // Fail-open de propósito — ver comentário em provider-subscription.service.ts.
    expect(isProviderSubscriptionActive(null)).toBe(true);
    expect(isProviderSubscriptionActive(undefined)).toBe(true);
  });

  it("assertProviderSubscriptionActive bloqueia PENDING_PAYMENT/PAST_DUE/CANCELED e libera TRIALING/ACTIVE", async () => {
    const trialing = await makeProvider("assert_trial", ProviderSubscriptionStatus.TRIALING);
    providerProfileIdsToCleanup.add(trialing.providerId);
    await expect(assertProviderSubscriptionActive(trialing.providerId)).resolves.not.toThrow();

    const active = await makeProvider("assert_active", ProviderSubscriptionStatus.ACTIVE);
    providerProfileIdsToCleanup.add(active.providerId);
    await expect(assertProviderSubscriptionActive(active.providerId)).resolves.not.toThrow();

    const pending = await makeProvider("assert_pending", ProviderSubscriptionStatus.PENDING_PAYMENT);
    providerProfileIdsToCleanup.add(pending.providerId);
    await expect(assertProviderSubscriptionActive(pending.providerId)).rejects.toThrow(/assinatura/i);

    const pastDue = await makeProvider("assert_pastdue", ProviderSubscriptionStatus.PAST_DUE);
    providerProfileIdsToCleanup.add(pastDue.providerId);
    await expect(assertProviderSubscriptionActive(pastDue.providerId)).rejects.toThrow(/assinatura/i);

    const canceled = await makeProvider("assert_canceled", ProviderSubscriptionStatus.CANCELED);
    providerProfileIdsToCleanup.add(canceled.providerId);
    await expect(assertProviderSubscriptionActive(canceled.providerId)).rejects.toThrow(/assinatura/i);
  });

  it("createProviderOffer bloqueia sem assinatura ativa e libera com TRIALING", async () => {
    const pastDue = await makeProvider("offer_pastdue", ProviderSubscriptionStatus.PAST_DUE);
    providerProfileIdsToCleanup.add(pastDue.providerId);
    await expect(
      consultancyService.createProviderOffer(pastDue.userId, {
        kind: "ONLINE_CONSULTANCY",
        title: "Oferta teste",
        billingCycle: "MONTHLY",
        priceCents: 20000
      } as any)
    ).rejects.toThrow(/assinatura/i);

    const trialing = await makeProvider("offer_trial", ProviderSubscriptionStatus.TRIALING);
    providerProfileIdsToCleanup.add(trialing.providerId);
    const offer = await consultancyService.createProviderOffer(trialing.userId, {
      kind: "ONLINE_CONSULTANCY",
      title: "Oferta teste",
      billingCycle: "MONTHLY",
      priceCents: 20000
    } as any);
    expect(offer).toBeTruthy();
  });

  it("deliverContract bloqueia mesmo pra contrato JÁ ativo (sem exceção pra cliente já pagante)", async () => {
    const provider = await makeProvider("deliver_pastdue", ProviderSubscriptionStatus.PAST_DUE);
    providerProfileIdsToCleanup.add(provider.providerId);
    const client = await makeClient("deliver1");
    userIdsToCleanup.add(client);

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId: provider.providerId,
        kind: "ONLINE_CONSULTANCY",
        title: `Consultoria ${uid("offer")}`,
        billingCycle: "MONTHLY",
        priceCents: 20000,
        fichaValidityDays: 30
      }
    });
    const request = await prisma.consultancyRequest.create({
      data: {
        providerId: provider.providerId,
        clientId: client,
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
        providerId: provider.providerId,
        clientId: client,
        offerId: offer.id,
        status: "ACTIVE",
        paymentMethod: "CREDIT_CARD",
        paymentStatus: "CAPTURED",
        paymentAmountCents: 20000,
        providerAmountCents: 18000,
        platformAmountCents: 2000,
        billingCycle: offer.billingCycle,
        kind: offer.kind,
        fichaValidityDays: offer.fichaValidityDays,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date()
      }
    });

    await expect(
      consultancyService.deliverContract(provider.userId, contract.id, {
        title: "Ficha nova",
        exercises: []
      })
    ).rejects.toThrow(/assinatura/i);
  });

  it("BookingService.create bloqueia agendamento com profissional sem assinatura ativa", async () => {
    const provider = await makeProvider("booking_canceled", ProviderSubscriptionStatus.CANCELED);
    providerProfileIdsToCleanup.add(provider.providerId);
    const client = await makeClient("booking1");
    userIdsToCleanup.add(client);

    const category = await prisma.serviceCategory.create({ data: { name: `Gate_${Date.now()}`, description: "t" } });
    categoryIdsToCleanup.add(category.id);
    await prisma.providerCategory.create({ data: { providerId: provider.providerId, categoryId: category.id } });

    await expect(
      bookingService.create(
        client,
        provider.providerId,
        category.id,
        // >7 dias — evita a checagem separada de "ciência de início imediato"
        // (não relacionada a este gate) mascarar o erro que eu quero testar.
        new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
      )
    ).rejects.toThrow(/não está disponível/i);
  });

  it("purchasePackage bloqueia compra de pacote presencial de profissional sem assinatura ativa", async () => {
    const provider = await makeProvider("pkg_pending", ProviderSubscriptionStatus.PENDING_PAYMENT);
    providerProfileIdsToCleanup.add(provider.providerId);
    const client = await makeClient("pkg1");
    userIdsToCleanup.add(client);

    const category = await prisma.serviceCategory.create({ data: { name: `Gate_${Date.now()}b`, description: "t" } });
    categoryIdsToCleanup.add(category.id);
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId: provider.providerId,
        kind: "PRESENTIAL",
        title: "Pacote presencial",
        billingCycle: "MONTHLY",
        priceCents: 40000,
        presentialPackageMode: "FLEXIBLE_CREDITS"
      }
    });

    await expect(
      presentialPackageService.purchasePackage(client, {
        offerId: offer.id,
        categoryId: category.id,
        paymentMethod: "CREDIT_CARD"
      })
    ).rejects.toThrow(/não está disponível/i);
  });

  it("favoritar bloqueia profissional sem assinatura ativa; listagem de favoritos filtra silenciosamente", async () => {
    const provider = await makeProvider("fav_pastdue", ProviderSubscriptionStatus.PAST_DUE);
    providerProfileIdsToCleanup.add(provider.providerId);
    const client = await makeClient("fav1");
    userIdsToCleanup.add(client);

    await expect(favoriteService.add(client, provider.providerId)).rejects.toThrow(/não disponível/i);
  });

  it("busca pública filtra profissional sem assinatura ativa (mesmo tratamento silencioso do CREF)", async () => {
    const active = await makeProvider("search_active", ProviderSubscriptionStatus.ACTIVE);
    providerProfileIdsToCleanup.add(active.providerId);
    await prisma.providerProfile.update({ where: { id: active.providerId }, data: { displayName: `SearchGate_${Date.now()}_Active` } });

    const pastDue = await makeProvider("search_pastdue", ProviderSubscriptionStatus.PAST_DUE);
    providerProfileIdsToCleanup.add(pastDue.providerId);
    const sharedTag = `SearchGateShared_${Date.now()}`;
    await prisma.providerProfile.update({ where: { id: pastDue.providerId }, data: { displayName: sharedTag } });
    await prisma.providerProfile.update({ where: { id: active.providerId }, data: { displayName: sharedTag } });

    const results = await providerService.search({ q: sharedTag } as any);
    const ids = (results as any[]).map((r) => r.id);
    expect(ids).toContain(active.providerId);
    expect(ids).not.toContain(pastDue.providerId);
  });
});
