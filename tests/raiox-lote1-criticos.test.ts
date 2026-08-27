import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { CardToken, Payment } from "mercadopago";
import { BookingStatus, ProviderSubscriptionStatus, WaitlistAudience } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { ProviderSubscriptionService } from "../src/modules/providers/services/provider-subscription.service";
import { getActiveEngagementSummary } from "../src/shared/utils/client-engagement";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Raio-X pós-épico (auditoria multi-ângulo dos Blocos 1-7, 2026-08-25):
// corrige os 4 achados CRÍTICOS do "Lote 1" — cobrança da assinatura que
// podia parar de cobrar de verdade após o 1º mês, reactivateSubscription
// que não desbloqueava de verdade, aluno externo confirmável com assinatura
// vencida, e exclusividade que não enxergava agendamento avulso sem
// contrato/pacote.

const consultancyService = new ConsultancyService();
const providerSubscriptionService = new ProviderSubscriptionService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function makeProvider(label: string, subscriptionStatus: ProviderSubscriptionStatus | null = ProviderSubscriptionStatus.ACTIVE) {
  const user = await prisma.user.create({
    data: {
      name: `RaioX ${label} Provider`,
      email: `${uid(`raiox_${label}_prov`)}@test.com`,
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
      email: `${uid(`raiox_${label}_client`)}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}`,
      role: "CLIENT",
      mpCustomerId: "cus_test_raiox",
      emailVerifiedAt: new Date()
    }
  });
  return user.id;
}

const userIdsToCleanup = new Set<string>();
const providerProfileIdsToCleanup = new Set<string>();
const categoryIdsToCleanup = new Set<string>();
const waitlistIdsToCleanup = new Set<string>();

describe("Raio-X pós-épico — Lote 1 (críticos)", () => {
  beforeAll(async () => {
    await prisma.$connect();
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
  });

  afterAll(async () => {
    const userIds = Array.from(userIdsToCleanup);
    const providerIds = Array.from(providerProfileIdsToCleanup);
    await prisma.booking.deleteMany({ where: { clientId: { in: userIds } } });
    const offerIds = (
      await prisma.consultancyContract.findMany({ where: { clientId: { in: userIds } }, select: { offerId: true } })
    ).map((c) => c.offerId);
    const requestIds = (
      await prisma.consultancyRequest.findMany({ where: { clientId: { in: userIds } }, select: { id: true } })
    ).map((r) => r.id);
    await prisma.consultancyContract.deleteMany({ where: { clientId: { in: userIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.externalStudentInvite.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.waitlistSignup.deleteMany({ where: { id: { in: Array.from(waitlistIdsToCleanup) } } });
    await prisma.providerSubscription.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.serviceCategory.deleteMany({ where: { id: { in: Array.from(categoryIdsToCleanup) } } });
    await prisma.$disconnect();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
  });

  it("[Crítico 1] idempotencyKey de cobrança muda entre ciclos — nunca reaproveita a chave do mês anterior", async () => {
    const chargeSpy = vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 9999, status: "approved" } as any);

    const provider = await makeProvider("cycle1", ProviderSubscriptionStatus.PENDING_PAYMENT);
    providerProfileIdsToCleanup.add(provider.providerId);
    await prisma.user.update({ where: { id: provider.userId }, data: { mpCustomerId: "cus_test_cycle" } });
    await prisma.customerPaymentMethod.create({
      data: {
        userId: provider.userId,
        mpCustomerId: "cus_test_cycle",
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

    // 1ª cobrança (mês 1).
    await providerSubscriptionService.runSubscriptionBilling(new Date());
    const afterFirst = await prisma.providerSubscription.findUniqueOrThrow({ where: { providerId: provider.providerId } });
    expect(afterFirst.status).toBe(ProviderSubscriptionStatus.ACTIVE);
    expect(afterFirst.billingCycleIndex).toBe(1);
    const firstKey = (chargeSpy.mock.calls[0][0] as any).requestOptions.idempotencyKey;

    // Força o vencimento do próximo ciclo (mês 2) e cobra de novo.
    await prisma.providerSubscription.update({
      where: { providerId: provider.providerId },
      data: { nextBillingAt: new Date(Date.now() - 60 * 1000) }
    });
    await providerSubscriptionService.runSubscriptionBilling(new Date());
    const afterSecond = await prisma.providerSubscription.findUniqueOrThrow({ where: { providerId: provider.providerId } });
    expect(afterSecond.billingCycleIndex).toBe(2);
    const secondKey = (chargeSpy.mock.calls[1][0] as any).requestOptions.idempotencyKey;

    expect(firstKey).not.toBe(secondKey);
  });

  it("[Crítico 2] reactivateSubscription reabre de verdade quando o job já converteu pra CANCELED", async () => {
    const provider = await makeProvider("reactivate1", ProviderSubscriptionStatus.ACTIVE);
    providerProfileIdsToCleanup.add(provider.providerId);

    // Cancela (agenda pro fim do período) e simula o job já tendo rodado
    // (nextBillingAt no passado, cancelAtPeriodEnd true → job finaliza).
    await providerSubscriptionService.cancelSubscription(provider.userId);
    await prisma.providerSubscription.update({
      where: { providerId: provider.providerId },
      data: { nextBillingAt: new Date(Date.now() - 60 * 1000) }
    });
    await providerSubscriptionService.runSubscriptionBilling(new Date());
    const canceled = await prisma.providerSubscription.findUniqueOrThrow({ where: { providerId: provider.providerId } });
    expect(canceled.status).toBe(ProviderSubscriptionStatus.CANCELED);

    // Reativar precisa desbloquear de verdade, não só apagar a flag.
    const reactivated = await providerSubscriptionService.reactivateSubscription(provider.userId);
    expect(reactivated.status).not.toBe(ProviderSubscriptionStatus.CANCELED);
    expect(reactivated.status).toBe(ProviderSubscriptionStatus.PENDING_PAYMENT);
  });

  it("[Crítico 3] createExternalStudentContract bloqueia profissional com assinatura inativa", async () => {
    const provider = await makeProvider("external1", ProviderSubscriptionStatus.PAST_DUE);
    providerProfileIdsToCleanup.add(provider.providerId);
    const client = await makeClient("external1");
    userIdsToCleanup.add(client);

    await expect(
      consultancyService.createExternalStudentContract(provider.userId, { clientId: client })
    ).rejects.toThrow(/não está disponível/i);
  });

  it("[Crítico 3b] createExternalStudentContract libera profissional com assinatura ativa", async () => {
    const provider = await makeProvider("external2", ProviderSubscriptionStatus.ACTIVE);
    providerProfileIdsToCleanup.add(provider.providerId);
    const client = await makeClient("external2");
    userIdsToCleanup.add(client);

    const contract = await consultancyService.createExternalStudentContract(provider.userId, { clientId: client });
    expect(contract).toBeTruthy();
  });

  it("[Crítico 4] getActiveEngagementSummary enxerga agendamento avulso sem contrato/pacote", async () => {
    const provider = await makeProvider("booking1");
    providerProfileIdsToCleanup.add(provider.providerId);
    const client = await makeClient("booking1");
    userIdsToCleanup.add(client);

    const category = await prisma.serviceCategory.create({ data: { name: `RaioX_${Date.now()}`, description: "t" } });
    categoryIdsToCleanup.add(category.id);

    await prisma.booking.create({
      data: {
        clientId: client,
        providerId: provider.providerId,
        categoryId: category.id,
        scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        priceCents: 12000,
        status: BookingStatus.CONFIRMED
      }
    });

    const summary = await getActiveEngagementSummary(client);
    expect(summary.hasActive).toBe(true);
    if (summary.hasActive) {
      expect(summary.providerId).toBe(provider.providerId);
      expect(summary.contractId).toBeNull();
      expect(summary.packageId).toBeNull();
      expect(summary.bookingId).not.toBeNull();
      expect(summary.priceCents).toBe(12000);
    }
  });

  it("[Crítico 3, vaga de fundador] duas reivindicações simultâneas do mesmo registro nunca dão fundador em dobro", async () => {
    const email = `${uid("raiox_founder_race")}@test.com`;
    const waitlist = await prisma.waitlistSignup.create({
      data: { email, audience: WaitlistAudience.PROFESSIONAL }
    });
    waitlistIdsToCleanup.add(waitlist.id);

    const userA = await prisma.user.create({
      data: {
        name: "RaioX Race A",
        email: `${uid("raiox_race_a")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "PROVIDER"
      }
    });
    userIdsToCleanup.add(userA.id);
    const userB = await prisma.user.create({
      data: {
        name: "RaioX Race B",
        email: `${uid("raiox_race_b")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    userIdsToCleanup.add(userB.id);
    const profileA = await prisma.providerProfile.create({
      data: { userId: userA.id, displayName: "Race A", bio: "t", experienceYears: 1, priceCents: 1000 }
    });
    providerProfileIdsToCleanup.add(profileA.id);
    const profileB = await prisma.providerProfile.create({
      data: { userId: userB.id, displayName: "Race B", bio: "t", experienceYears: 1, priceCents: 1000 }
    });
    providerProfileIdsToCleanup.add(profileB.id);

    // Duas transações concorrentes de verdade, batendo no mesmo e-mail de waitlist.
    const [resultA, resultB] = await Promise.all([
      prisma.$transaction((tx) => providerSubscriptionService.createSubscriptionForProvider(tx, profileA.id, { email, phone: null })),
      prisma.$transaction((tx) => providerSubscriptionService.createSubscriptionForProvider(tx, profileB.id, { email, phone: null }))
    ]);

    const founderCount = [resultA, resultB].filter((r) => r.isFounder).length;
    expect(founderCount).toBe(1);
  });
});
