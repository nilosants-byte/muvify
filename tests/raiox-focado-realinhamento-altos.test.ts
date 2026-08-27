import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { CardToken } from "mercadopago";
import {
  ConsultancyContractStatus,
  ConsultancyPaymentStatus,
  ConsultancyRequestStatus,
  OfferBillingCycle,
  PresentialPackageMode,
  PresentialPackageStatus,
  ProviderSubscriptionStatus,
  ServiceOfferKind
} from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { ProviderSubscriptionService } from "../src/modules/providers/services/provider-subscription.service";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Raio-X focado — realinhamento com o Will (2026-08-26), Lote Alto:
// (1) getMySubscription mostrava preço vencido (até ~29 dias depois da
//     trava de 12 meses do fundador acabar);
// (2) aceitar convite de aluno externo que troca de profissional deixava o
//     aluno preso com dois vínculos se o vínculo antigo fosse um contrato
//     PENDING_PAYMENT (sem job de resolução automática);
// (3) cancelamento de pacote presencial na troca suprimia o aviso pros dois
//     lados (notify: false reaproveitado de um caso diferente) — profissional
//     antigo nunca ficava sabendo que perdeu o aluno.

const consultancyService = new ConsultancyService();
const providerSubscriptionService = new ProviderSubscriptionService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function makeProvider(label: string, subscriptionStatus: ProviderSubscriptionStatus | null = ProviderSubscriptionStatus.ACTIVE) {
  const user = await prisma.user.create({
    data: {
      name: `RaioXFocado ${label} Provider`,
      email: `${uid(`rxf_${label}_prov`)}@test.com`,
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
      email: `${uid(`rxf_${label}_client`)}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}`,
      role: "CLIENT",
      emailVerifiedAt: new Date()
    }
  });
  return user.id;
}

async function waitForNotification(userId: string, type: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await prisma.userNotification.findFirst({ where: { userId, data: { path: ["type"], equals: type } } });
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

const userIdsToCleanup = new Set<string>();
const providerProfileIdsToCleanup = new Set<string>();
const offerIdsToCleanup = new Set<string>();
const categoryIdsToCleanup = new Set<string>();

describe("Raio-X focado — realinhamento com o Will, Lote Alto", () => {
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
    await prisma.consultancyContract.deleteMany({ where: { clientId: { in: userIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.presentialPackage.deleteMany({ where: { clientId: { in: userIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: Array.from(offerIdsToCleanup) } } });
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

  it("[Alto] getMySubscription devolve o preço BASE quando a trava de 12 meses já venceu, mesmo sem nenhuma cobrança nova ainda", async () => {
    const provider = await makeProvider("pricegap", ProviderSubscriptionStatus.ACTIVE);
    providerProfileIdsToCleanup.add(provider.providerId);
    await prisma.providerSubscription.update({
      where: { providerId: provider.providerId },
      data: {
        isFounder: true,
        priceCents: 2990,
        priceLockedUntil: new Date(Date.now() - 24 * 60 * 60 * 1000)
      }
    });

    const sub = await providerSubscriptionService.getMySubscription(provider.userId);
    expect(sub.priceCents).toBe(3990);

    // Não é um efeito colateral de escrita — só a leitura calcula o valor
    // efetivo, o banco continua com o valor antigo até a próxima cobrança
    // real persistir a mudança.
    const raw = await prisma.providerSubscription.findUniqueOrThrow({ where: { providerId: provider.providerId } });
    expect(raw.priceCents).toBe(2990);
  });

  it("[Alto] getMySubscription continua mostrando o preço promocional enquanto a trava não venceu", async () => {
    const provider = await makeProvider("pricegap2", ProviderSubscriptionStatus.ACTIVE);
    providerProfileIdsToCleanup.add(provider.providerId);
    await prisma.providerSubscription.update({
      where: { providerId: provider.providerId },
      data: {
        isFounder: true,
        priceCents: 2990,
        priceLockedUntil: new Date(Date.now() + 300 * 24 * 60 * 60 * 1000)
      }
    });

    const sub = await providerSubscriptionService.getMySubscription(provider.userId);
    expect(sub.priceCents).toBe(2990);
  });

  it("[Alto] trocar de profissional cancela um contrato antigo PENDING_PAYMENT (antes ficava preso pra sempre) e avisa o aluno", async () => {
    const oldProvider = await makeProvider("oldpending");
    providerProfileIdsToCleanup.add(oldProvider.providerId);
    const newProvider = await makeProvider("newpending");
    providerProfileIdsToCleanup.add(newProvider.providerId);
    const client = await makeClient("pendingswitch");
    userIdsToCleanup.add(client);

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId: oldProvider.providerId,
        kind: ServiceOfferKind.ONLINE_CONSULTANCY,
        title: "Plano aguardando Pix",
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 9000
      }
    });
    offerIdsToCleanup.add(offer.id);
    const now = new Date();
    const request = await prisma.consultancyRequest.create({
      data: {
        providerId: oldProvider.providerId,
        clientId: client,
        status: ConsultancyRequestStatus.RESPONDED,
        quotedOfferId: offer.id,
        responseDeadlineAt: now,
        respondedAt: now
      }
    });
    const oldContract = await prisma.consultancyContract.create({
      data: {
        requestId: request.id,
        providerId: oldProvider.providerId,
        clientId: client,
        offerId: offer.id,
        status: ConsultancyContractStatus.PENDING_PAYMENT,
        paymentMethod: "PIX",
        paymentInstallments: 1,
        paymentStatus: ConsultancyPaymentStatus.PENDING,
        paymentAmountCents: 9000,
        providerAmountCents: 8000,
        platformAmountCents: 1000,
        deliveryDeadlineAt: now,
        immediateExecutionAcknowledgedAt: now,
        billingCycle: OfferBillingCycle.MONTHLY,
        kind: ServiceOfferKind.ONLINE_CONSULTANCY
      }
    });

    // Confirma que hoje (antes do fix) isso travaria — cancelContract não
    // aceita PENDING_PAYMENT.
    await expect(consultancyService.cancelContract(client, oldContract.id)).rejects.toThrow(/não pode mais ser cancelado/i);

    const newContract = await consultancyService.createExternalStudentContract(newProvider.userId, { clientId: client });
    expect(newContract.providerId).toBe(newProvider.providerId);

    const oldContractAfter = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: oldContract.id } });
    expect(oldContractAfter.status).toBe(ConsultancyContractStatus.CANCELLED);

    const notification = await waitForNotification(client, "CONSULTANCY_CANCELLED_BY_SWITCH");
    expect(notification).not.toBeNull();
  });

  it("[Alto] trocar de profissional cancela um pacote presencial antigo e avisa o profissional antigo (antes ficava mudo)", async () => {
    const oldProvider = await makeProvider("oldpkg");
    providerProfileIdsToCleanup.add(oldProvider.providerId);
    const newProvider = await makeProvider("newpkg");
    providerProfileIdsToCleanup.add(newProvider.providerId);
    const client = await makeClient("pkgswitch");
    userIdsToCleanup.add(client);

    const category = await prisma.serviceCategory.create({ data: { name: `RaioXFocado_${Date.now()}`, description: "t" } });
    categoryIdsToCleanup.add(category.id);
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId: oldProvider.providerId,
        kind: ServiceOfferKind.PRESENTIAL,
        title: "Pacote presencial antigo",
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 40000,
        presentialPackageMode: "FIXED_RECURRING"
      }
    });
    offerIdsToCleanup.add(offer.id);

    const oldPackage = await prisma.presentialPackage.create({
      data: {
        providerId: oldProvider.providerId,
        clientId: client,
        offerId: offer.id,
        categoryId: category.id,
        mode: PresentialPackageMode.FIXED_RECURRING,
        status: PresentialPackageStatus.ACTIVE,
        paymentMethod: "CREDIT_CARD",
        cycleAmountCents: 40000,
        billingCycle: OfferBillingCycle.MONTHLY,
        sessionsPerCycle: 4
      }
    });

    const newContract = await consultancyService.createExternalStudentContract(newProvider.userId, { clientId: client });
    expect(newContract.providerId).toBe(newProvider.providerId);

    const oldPackageAfter = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: oldPackage.id } });
    expect(oldPackageAfter.status).toBe(PresentialPackageStatus.CANCELLED);

    const oldProviderNotification = await waitForNotification(oldProvider.userId, "PRESENTIAL_PACKAGE_CANCELLED");
    expect(oldProviderNotification).not.toBeNull();
  });
});
