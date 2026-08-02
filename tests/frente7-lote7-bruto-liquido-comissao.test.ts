import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  ConsultancyContractStatus,
  ConsultancyPaymentStatus,
  OfferBillingCycle,
  PresentialPackageMode,
  PresentialPackageStatus,
  ServiceOfferKind,
  UserRole
} from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { FinancialService } from "../src/modules/financial/services/financial.service";

// Épico de Frentes, Frente 7 (Tela Financeiro do profissional), Lote 7:
// "bruto" só somava sessões presenciais concluídas, enquanto "líquido" já
// vinha incluindo todos os tipos de receita - profissional que vende
// majoritariamente consultoria/pacote (sem nenhum booking presencial) tinha
// líquido > bruto, com "comissão" (bruto - líquido) aparecendo negativa.

const financialService = new FinancialService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let categoryId = "";
let clientId = "";
let providerUserId = "";
let providerId = "";
const offerIds: string[] = [];
const contractIds: string[] = [];
const requestIds: string[] = [];
const packageIds: string[] = [];

describe("Frente 7, Lote 7 — bruto/líquido/comissão no mesmo escopo", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `F7L7_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Sete Lote Sete",
        email: `${uid("f7l7_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.CLIENT
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Sete Lote Sete",
        email: `${uid("f7l7_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Sete Lote Sete",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;
  });

  afterAll(async () => {
    await prisma.presentialPackageCycle.deleteMany({ where: { package: { id: { in: packageIds } } } });
    await prisma.presentialPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.consultancyContract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [providerUserId, clientId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [providerUserId, clientId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("profissional só com consultoria/pacote (nenhum booking presencial) tem bruto >= líquido, comissão nunca negativa", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: { providerId, kind: ServiceOfferKind.ONLINE_CONSULTANCY, title: `Consultoria ${uid("offer")}`, billingCycle: OfferBillingCycle.MONTHLY, priceCents: 20000 }
    });
    offerIds.push(offer.id);

    const request = await prisma.consultancyRequest.create({
      data: { providerId, clientId, status: "ACCEPTED", quotedOfferId: offer.id, responseDeadlineAt: new Date(), respondedAt: new Date(), clientDecisionAt: new Date() }
    });
    requestIds.push(request.id);

    const contract = await prisma.consultancyContract.create({
      data: {
        requestId: request.id,
        providerId,
        clientId,
        offerId: offer.id,
        status: ConsultancyContractStatus.ACTIVE,
        paymentStatus: ConsultancyPaymentStatus.CAPTURED,
        paymentAmountCents: 20000,
        providerAmountCents: 18000,
        platformAmountCents: 2000,
        billingCycle: offer.billingCycle,
        kind: offer.kind,
        mpPaymentId: `mp_${uid("contract")}`,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date(),
        paymentCapturedAt: new Date()
      }
    });
    contractIds.push(contract.id);

    const presOffer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: ServiceOfferKind.PRESENTIAL,
        title: `Presencial ${uid("offer")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 30000,
        presentialPackageMode: PresentialPackageMode.FIXED_RECURRING,
        presentialSessionsPerCycle: 4
      }
    });
    offerIds.push(presOffer.id);

    const pkg = await prisma.presentialPackage.create({
      data: {
        providerId,
        clientId,
        offerId: presOffer.id,
        categoryId,
        mode: PresentialPackageMode.FIXED_RECURRING,
        status: PresentialPackageStatus.ACTIVE,
        cycleAmountCents: 30000,
        billingCycle: OfferBillingCycle.MONTHLY,
        sessionsPerCycle: 4
      }
    });
    packageIds.push(pkg.id);

    await prisma.presentialPackageCycle.create({
      data: {
        packageId: pkg.id,
        cycleIndex: 1,
        amountCents: 30000,
        providerAmountCents: 27000,
        platformAmountCents: 3000,
        sessionsGranted: 4,
        mpPaymentId: `mp_${uid("cycle")}`,
        capturedAt: new Date(),
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      }
    });

    const payouts = await financialService.getPayouts(providerUserId);

    expect(payouts.grossCents).toBe(50000);
    expect(payouts.availableCents).toBe(45000);
    expect(payouts.grossCents).toBeGreaterThanOrEqual(payouts.availableCents);
    const commissionCents = payouts.grossCents - payouts.availableCents;
    expect(commissionCents).toBeGreaterThanOrEqual(0);
  });
});
