import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { CardToken, Payment } from "mercadopago";
import { BookingStatus, ProviderSubscriptionStatus } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { ProviderSubscriptionService } from "../src/modules/providers/services/provider-subscription.service";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Raio-X focado — realinhamento com o Will (2026-08-26), Lote Médio-Alto:
// (1) quando a VERIFICAÇÃO pós-erro-incerto de cobrança falha (não só a
//     cobrança original), o contador de tentativas não pode avançar — senão
//     reabre risco de cobrança em dobro com valores diferentes se o preço
//     mudou no meio do caminho (trava de 12 meses do fundador vencendo);
// (2) trocar de profissional não tenta mais cancelar um agendamento avulso
//     antigo cujo horário já passou sem presença validada — isso sempre
//     seria rejeitado (só "reportar falta" resolve esse caso), então a
//     tentativa é pulada de propósito (sem erro, sem ruído) — o job de
//     expiração de 48h resolve sozinho.

const consultancyService = new ConsultancyService();
const providerSubscriptionService = new ProviderSubscriptionService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function makeProvider(label: string, subscriptionStatus: ProviderSubscriptionStatus | null = ProviderSubscriptionStatus.ACTIVE) {
  const user = await prisma.user.create({
    data: {
      name: `RaioXFocado ${label} Provider`,
      email: `${uid(`rxfma_${label}_prov`)}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}`,
      role: "PROVIDER"
    }
  });
  const profile = await prisma.providerProfile.create({
    data: {
      userId: user.id,
      displayName: `RaioXFocado ${label} Provider`,
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
      name: `RaioXFocado ${label} Client`,
      email: `${uid(`rxfma_${label}_client`)}@test.com`,
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
const categoryIdsToCleanup = new Set<string>();

describe("Raio-X focado — realinhamento com o Will, Lote Médio-Alto", () => {
  beforeAll(async () => {
    await prisma.$connect();
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
  });

  afterAll(async () => {
    const userIds = Array.from(userIdsToCleanup);
    const providerIds = Array.from(providerProfileIdsToCleanup);
    await prisma.booking.deleteMany({ where: { clientId: { in: userIds } } });
    const requestIds = (
      await prisma.consultancyRequest.findMany({ where: { clientId: { in: userIds } }, select: { id: true } })
    ).map((r) => r.id);
    const offerIds = (
      await prisma.consultancyContract.findMany({ where: { clientId: { in: userIds } }, select: { offerId: true } })
    ).map((c) => c.offerId);
    await prisma.consultancyContract.deleteMany({ where: { clientId: { in: userIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: { in: providerIds } } });
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

  it("[Médio-alto] quando a verificação pós-erro-incerto FALHA em si (não só a cobrança), não avança o contador de tentativas", async () => {
    const provider = await makeProvider("verifyfail1", ProviderSubscriptionStatus.PENDING_PAYMENT);
    providerProfileIdsToCleanup.add(provider.providerId);
    await prisma.user.update({ where: { id: provider.userId }, data: { mpCustomerId: "cus_test_verifyfail1" } });
    await prisma.customerPaymentMethod.create({
      data: {
        userId: provider.userId,
        mpCustomerId: "cus_test_verifyfail1",
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
    // A cobrança original E a verificação pós-erro-incerto falham as duas —
    // pior caso: não temos NENHUMA confirmação do que aconteceu.
    vi.spyOn(Payment.prototype, "search").mockRejectedValue(new Error("MP search indisponível"));

    await providerSubscriptionService.runSubscriptionBilling(new Date());

    const after = await prisma.providerSubscription.findUniqueOrThrow({ where: { providerId: provider.providerId } });
    expect(after.status).toBe(ProviderSubscriptionStatus.PENDING_PAYMENT);
    expect(after.lastChargeStatus).toBe("PENDING");
    // Não avança — mesma idempotencyKey amanhã, pra recuperar o resultado
    // final desta cobrança (se ela realmente tiver ido pra MP) em vez de
    // criar uma nova com um valor possivelmente diferente.
    expect(after.consecutiveFailedCharges).toBe(0);
  });

  it("[Médio-alto, regressão] quando a verificação RODA e genuinamente não acha nada, continua avançando o contador normalmente", async () => {
    const provider = await makeProvider("verifyempty1", ProviderSubscriptionStatus.PENDING_PAYMENT);
    providerProfileIdsToCleanup.add(provider.providerId);
    await prisma.user.update({ where: { id: provider.userId }, data: { mpCustomerId: "cus_test_verifyempty1" } });
    await prisma.customerPaymentMethod.create({
      data: {
        userId: provider.userId,
        mpCustomerId: "cus_test_verifyempty1",
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
    expect(after.lastChargeStatus).toBe("FAILED");
    expect(after.consecutiveFailedCharges).toBe(1);
  });

  it("[Médio-alto] trocar de profissional NÃO tenta cancelar agendamento avulso vencido sem presença validada (evita erro esperado/ruído)", async () => {
    const oldProvider = await makeProvider("oldbooking");
    providerProfileIdsToCleanup.add(oldProvider.providerId);
    const newProvider = await makeProvider("newbooking");
    providerProfileIdsToCleanup.add(newProvider.providerId);
    const client = await makeClient("bookingswitch");
    userIdsToCleanup.add(client);

    const category = await prisma.serviceCategory.create({ data: { name: `RaioXFocadoMA_${Date.now()}`, description: "t" } });
    categoryIdsToCleanup.add(category.id);

    const oldBooking = await prisma.booking.create({
      data: {
        clientId: client,
        providerId: oldProvider.providerId,
        categoryId: category.id,
        // Horário já passado, presença nunca validada — updateStatus
        // sempre rejeitaria um cancelamento simples aqui.
        scheduledAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        priceCents: 10000,
        status: BookingStatus.CONFIRMED
      }
    });

    const newContract = await consultancyService.createExternalStudentContract(newProvider.userId, { clientId: client });
    expect(newContract.providerId).toBe(newProvider.providerId);

    // Não tentou (e não conseguiria) cancelar — booking continua intocado,
    // vai se resolver sozinho via autoExpireStaleBookings em até 48h.
    const oldBookingAfter = await prisma.booking.findUniqueOrThrow({ where: { id: oldBooking.id } });
    expect(oldBookingAfter.status).toBe(BookingStatus.CONFIRMED);
  });
});
