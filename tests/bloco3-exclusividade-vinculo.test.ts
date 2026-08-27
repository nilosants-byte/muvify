import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { CardToken } from "mercadopago";
import { ConsultancyContractStatus, BookingStatus } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";
import { UserService } from "../src/modules/users/services/user.service";
import {
  assertNoActiveEngagementWithOtherProvider,
  getActiveEngagementSummary
} from "../src/shared/utils/client-engagement";
import { encryptSensitiveText } from "../src/shared/utils/encryption";
import { env } from "../src/config/env";

// Bloco 3 (exclusividade de marketplace): só um profissional ativo por vez
// — pode trocar/adicionar serviço com o MESMO profissional, mas não
// contrata outro enquanto o vínculo durar.

const consultancyService = new ConsultancyService();
const presentialPackageService = new PresentialPackageService();
const userService = new UserService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function makeProvider(label: string) {
  const user = await prisma.user.create({
    data: {
      name: `Excl ${label} Provider`,
      email: `${uid(`excl_${label}_prov`)}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}`,
      role: "PROVIDER"
    }
  });
  const profile = await prisma.providerProfile.create({
    data: {
      userId: user.id,
      displayName: `Excl ${label} Provider`,
      bio: "test",
      experienceYears: 3,
      priceCents: 15000,
      mpAccountId: `${Math.floor(Math.random() * 1_000_000_000)}`,
      mpAccessToken: encryptSensitiveText("fake_access_token"),
      crefValidationStatus: "APPROVED"
    }
  });
  return { userId: user.id, providerId: profile.id };
}

async function makeClient(label: string) {
  const user = await prisma.user.create({
    data: {
      name: `Excl ${label} Client`,
      email: `${uid(`excl_${label}_client`)}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}`,
      role: "CLIENT",
      mpCustomerId: "cus_test_excl",
      emailVerifiedAt: new Date()
    }
  });
  await prisma.clientAnamnesis.create({
    data: { clientId: user.id, status: "COMPLETED", completedAt: new Date() }
  });
  await prisma.customerPaymentMethod.create({
    data: {
      userId: user.id,
      mpCustomerId: "cus_test_excl",
      mpCardId: `card_${uid("c")}`,
      nickname: "Cartão de teste",
      brand: "visa",
      last4: "4242",
      funding: "CREDIT"
    }
  });
  return user.id;
}

async function makeOffer(providerId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return prisma.providerServiceOffer.create({
    data: {
      providerId,
      kind: "ONLINE_CONSULTANCY",
      title: `Consultoria ${uid("offer")}`,
      billingCycle: "MONTHLY",
      priceCents: 20000,
      fichaValidityDays: 30,
      ...overrides
    }
  });
}

const userIdsToCleanup = new Set<string>();
const providerProfileIdsToCleanup = new Set<string>();
const categoryIdsToCleanup = new Set<string>();

describe("Bloco 3 — exclusividade de marketplace", () => {
  beforeAll(async () => {
    await prisma.$connect();
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
  });

  afterAll(async () => {
    const userIds = Array.from(userIdsToCleanup);
    await prisma.disputeCase.deleteMany({ where: { clientId: { in: userIds } } });
    await prisma.consultancyMessage.deleteMany({ where: { contract: { clientId: { in: userIds } } } });
    await prisma.trainingPlan.deleteMany({ where: { providerId: { in: Array.from(providerProfileIdsToCleanup) } } });
    const requestIds = (
      await prisma.consultancyRequest.findMany({ where: { clientId: { in: userIds } }, select: { id: true } })
    ).map((r) => r.id);
    const offerIds = (
      await prisma.consultancyContract.findMany({ where: { clientId: { in: userIds } }, select: { offerId: true } })
    ).map((c) => c.offerId);
    await prisma.booking.deleteMany({ where: { clientId: { in: userIds } } });
    await prisma.consultancyContract.deleteMany({ where: { clientId: { in: userIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId: { in: userIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: Array.from(providerProfileIdsToCleanup) } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.serviceCategory.deleteMany({ where: { id: { in: Array.from(categoryIdsToCleanup) } } });
    await prisma.$disconnect();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
  });

  it("assertNoActiveEngagementWithOtherProvider bloqueia quando há Booking ativo com outro profissional", async () => {
    const providerA = await makeProvider("a1");
    const providerB = await makeProvider("b1");
    const client = await makeClient("bk1");
    userIdsToCleanup.add(client);
    providerProfileIdsToCleanup.add(providerA.providerId);
    providerProfileIdsToCleanup.add(providerB.providerId);

    const category = await prisma.serviceCategory.create({ data: { name: `Excl_${Date.now()}`, description: "t" } });
    categoryIdsToCleanup.add(category.id);

    await prisma.booking.create({
      data: {
        clientId: client,
        providerId: providerA.providerId,
        categoryId: category.id,
        scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        priceCents: 10000,
        status: BookingStatus.CONFIRMED
      }
    });

    await expect(assertNoActiveEngagementWithOtherProvider(client, providerB.providerId)).rejects.toThrow(
      /já tem um profissional ativo/i
    );
    // Mesmo profissional (A) nunca é bloqueado.
    await expect(assertNoActiveEngagementWithOtherProvider(client, providerA.providerId)).resolves.not.toThrow();
  });

  it("purchasePackage é bloqueado por um ConsultancyContract ativo com outro profissional", async () => {
    const providerA = await makeProvider("a2");
    const providerB = await makeProvider("b2");
    const client = await makeClient("pkg1");
    userIdsToCleanup.add(client);
    providerProfileIdsToCleanup.add(providerA.providerId);
    providerProfileIdsToCleanup.add(providerB.providerId);

    const offerA = await makeOffer(providerA.providerId);
    const requestA = await prisma.consultancyRequest.create({
      data: {
        providerId: providerA.providerId,
        clientId: client,
        status: "ACCEPTED",
        quotedOfferId: offerA.id,
        responseDeadlineAt: new Date(),
        respondedAt: new Date(),
        clientDecisionAt: new Date()
      }
    });
    await prisma.consultancyContract.create({
      data: {
        requestId: requestA.id,
        providerId: providerA.providerId,
        clientId: client,
        offerId: offerA.id,
        status: ConsultancyContractStatus.ACTIVE,
        paymentMethod: "CREDIT_CARD",
        paymentStatus: "CAPTURED",
        paymentAmountCents: 20000,
        providerAmountCents: 18000,
        platformAmountCents: 2000,
        billingCycle: offerA.billingCycle,
        kind: offerA.kind,
        fichaValidityDays: offerA.fichaValidityDays,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date()
      }
    });

    const category = await prisma.serviceCategory.create({ data: { name: `Excl_${Date.now()}b`, description: "t" } });
    categoryIdsToCleanup.add(category.id);
    const presentialOfferB = await prisma.providerServiceOffer.create({
      data: {
        providerId: providerB.providerId,
        kind: "PRESENTIAL",
        title: "Pacote presencial",
        billingCycle: "MONTHLY",
        priceCents: 40000,
        presentialPackageMode: "FLEXIBLE_CREDITS"
      }
    });

    await expect(
      presentialPackageService.purchasePackage(client, {
        offerId: presentialOfferB.id,
        categoryId: category.id,
        paymentMethod: "CREDIT_CARD"
      })
    ).rejects.toThrow(/já tem um profissional ativo/i);

    await prisma.providerServiceOffer.deleteMany({ where: { id: presentialOfferB.id } });
  });

  it("getActiveEngagementSummary resume corretamente um vínculo de consultoria online", async () => {
    const provider = await makeProvider("sum1");
    const client = await makeClient("sum1");
    userIdsToCleanup.add(client);
    providerProfileIdsToCleanup.add(provider.providerId);

    const offer = await makeOffer(provider.providerId);
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
    await prisma.consultancyContract.create({
      data: {
        requestId: request.id,
        providerId: provider.providerId,
        clientId: client,
        offerId: offer.id,
        status: ConsultancyContractStatus.ACTIVE,
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

    const summary = await getActiveEngagementSummary(client);
    expect(summary.hasActive).toBe(true);
    if (summary.hasActive) {
      expect(summary.providerId).toBe(provider.providerId);
      expect(summary.kind).toBe("ONLINE_CONSULTANCY");
      expect(summary.priceCents).toBe(20000);
    }
  });

  it("switchOrAddOffer troca pra outra oferta do MESMO profissional só depois de confirmar a nova (cobrança da antiga simulada com sucesso)", async () => {
    vi.spyOn(await import("mercadopago").then((m) => m.Payment.prototype), "create").mockResolvedValue({
      id: 9001,
      status: "approved"
    } as any);

    const provider = await makeProvider("sw1");
    const client = await makeClient("sw1");
    userIdsToCleanup.add(client);
    providerProfileIdsToCleanup.add(provider.providerId);

    const oldOffer = await makeOffer(provider.providerId, { title: "Consultoria antiga" });
    const oldRequest = await prisma.consultancyRequest.create({
      data: {
        providerId: provider.providerId,
        clientId: client,
        status: "ACCEPTED",
        quotedOfferId: oldOffer.id,
        responseDeadlineAt: new Date(),
        respondedAt: new Date(),
        clientDecisionAt: new Date()
      }
    });
    const oldContract = await prisma.consultancyContract.create({
      data: {
        requestId: oldRequest.id,
        providerId: provider.providerId,
        clientId: client,
        offerId: oldOffer.id,
        status: ConsultancyContractStatus.ACTIVE,
        paymentMethod: "CREDIT_CARD",
        paymentStatus: "CAPTURED",
        paymentAmountCents: 20000,
        providerAmountCents: 18000,
        platformAmountCents: 2000,
        billingCycle: oldOffer.billingCycle,
        kind: oldOffer.kind,
        fichaValidityDays: oldOffer.fichaValidityDays,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date()
      }
    });

    const newOffer = await makeOffer(provider.providerId, {
      title: "Consultoria nova",
      kind: "ONLINE_CONSULTANCY_SPECIALIZED"
    });

    const result = await userService.switchOrAddOffer(client, {
      newOfferId: newOffer.id,
      paymentMethod: "CREDIT_CARD",
      acknowledgedImmediateExecution: true
    });
    expect(result).toBeTruthy();

    const reloadedOld = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: oldContract.id } });
    expect(reloadedOld.status).toBe(ConsultancyContractStatus.CANCELLED);

    const summary = await getActiveEngagementSummary(client);
    expect(summary.hasActive).toBe(true);
    if (summary.hasActive) {
      expect(summary.providerId).toBe(provider.providerId);
    }
  });
});
