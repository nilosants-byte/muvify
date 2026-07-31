import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BookingStatus, ConsultancyContractStatus, ConsultancyPaymentStatus, ConsultancyRequestStatus, PresentialPackageMode, PresentialPackageStatus, ServiceOfferKind, OfferBillingCycle, UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";
import { ProviderService } from "../src/modules/providers/services/provider.service";

// Épico de Frentes, Frente 6 (Ofertas do profissional), Lote 1:
// (1) cliente não recebe mpAccessToken/mpRefreshToken do profissional nem
//     o split financeiro interno (providerAmountCents/platformAmountCents/
//     mpPaymentId/mpRefundId) do próprio contrato via listClientRequests/
//     listClientArchivedRequests/getMyTraining.
// (2) profissional não recebe cartão salvo/código Pix pendente do CLIENTE
//     via listProviderPackages/getPackageById/cancelPackage/
//     getStudentManagementDetail; o cliente continua vendo os próprios dados.

const consultancyService = new ConsultancyService();
const presentialPackageService = new PresentialPackageService();
const providerService = new ProviderService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let categoryId = "";
let providerUserId = "";
let providerId = "";
let clientId = "";
let offerId = "";
let requestId = "";
let contractId = "";
let packageId = "";
let trainingPlanId = "";
let bookingId = "";

describe("Frente 6, Lote 1 — vazamento de dados sensíveis entre cliente e profissional", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `F6L1_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Seis Lote Um",
        email: `${uid("f6l1_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Seis Lote Um",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        // Dado sensível que NUNCA pode chegar no cliente.
        mpAccessToken: "SECRET_ACCESS_TOKEN",
        mpRefreshToken: "SECRET_REFRESH_TOKEN",
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Seis Lote Um",
        email: `${uid("f6l1_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: UserRole.CLIENT,
        emailVerifiedAt: new Date()
      }
    });
    clientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: ServiceOfferKind.ONLINE_CONSULTANCY,
        title: "Consultoria Frente 6 Lote 1",
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 30000
      }
    });
    offerId = offer.id;

    const request = await prisma.consultancyRequest.create({
      data: {
        providerId,
        clientId,
        status: ConsultancyRequestStatus.REFUSED,
        quotedOfferId: offerId,
        responseDeadlineAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        respondedAt: new Date(),
        clientDecisionAt: new Date()
      }
    });
    requestId = request.id;

    const contract = await prisma.consultancyContract.create({
      data: {
        requestId,
        providerId,
        clientId,
        offerId,
        status: ConsultancyContractStatus.ACTIVE,
        paymentStatus: ConsultancyPaymentStatus.CAPTURED,
        paymentAmountCents: 30000,
        billingCycle: OfferBillingCycle.MONTHLY,
        kind: ServiceOfferKind.ONLINE_CONSULTANCY,
        // Dados sensíveis que NUNCA podem chegar no cliente.
        providerAmountCents: 27000,
        platformAmountCents: 3000,
        mpPaymentId: `mp_${uid("payment")}`,
        mpRefundId: `mp_${uid("refund")}`,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date()
      }
    });
    contractId = contract.id;

    const trainingPlan = await prisma.trainingPlan.create({
      data: {
        providerId,
        contractId,
        title: "Ficha Frente 6 Lote 1",
        isPrebuilt: false,
        isActive: true
      }
    });
    trainingPlanId = trainingPlan.id;

    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        priceCents: 10000,
        status: BookingStatus.CONFIRMED
      }
    });
    bookingId = booking.id;

    const pkg = await prisma.presentialPackage.create({
      data: {
        providerId,
        clientId,
        offerId,
        categoryId,
        mode: PresentialPackageMode.FLEXIBLE_CREDITS,
        status: PresentialPackageStatus.ACTIVE,
        cycleAmountCents: 20000,
        billingCycle: OfferBillingCycle.MONTHLY,
        sessionsPerCycle: 4,
        // Dados de cobrança do CLIENTE que NUNCA podem chegar no profissional.
        billingCardId: "card_secret_123",
        pendingChargeMpPaymentId: `mp_${uid("pending")}`,
        pendingChargePixQrCodeUrl: "https://example.com/qr-secret",
        pendingChargePixCopyPasteCode: "PIX_COPY_PASTE_SECRET_CODE",
        pendingChargePixExpiresAt: new Date(Date.now() + 30 * 60 * 1000)
      }
    });
    packageId = pkg.id;
  });

  afterAll(async () => {
    await prisma.presentialPackage.deleteMany({ where: { id: packageId } });
    await prisma.booking.deleteMany({ where: { id: bookingId } });
    await prisma.trainingPlan.deleteMany({ where: { id: trainingPlanId } });
    await prisma.consultancyContract.deleteMany({ where: { id: contractId } });
    await prisma.consultancyRequest.deleteMany({ where: { id: requestId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: offerId } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [providerUserId, clientId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [providerUserId, clientId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("listClientRequests não vaza mpAccessToken/mpRefreshToken do profissional nem o split financeiro do contrato", async () => {
    const requests = await consultancyService.listClientRequests(clientId);
    const found = requests.find((r: any) => r.id === requestId) as any;
    expect(found).toBeTruthy();
    expect(found.provider).not.toHaveProperty("mpAccessToken");
    expect(found.provider).not.toHaveProperty("mpRefreshToken");
    expect(found.provider.displayName).toBe("Profissional Frente Seis Lote Um");
    expect(found.contract).not.toHaveProperty("mpPaymentId");
    expect(found.contract).not.toHaveProperty("mpRefundId");
    expect(found.contract).not.toHaveProperty("providerAmountCents");
    expect(found.contract).not.toHaveProperty("platformAmountCents");
    expect(found.contract.paymentAmountCents).toBe(30000);
  });

  it("listClientArchivedRequests não vaza os mesmos dados sensíveis", async () => {
    const requests = await consultancyService.listClientArchivedRequests(clientId, "REFUSED");
    const found = requests.find((r: any) => r.id === requestId) as any;
    expect(found).toBeTruthy();
    expect(found.provider).not.toHaveProperty("mpAccessToken");
    expect(found.provider).not.toHaveProperty("mpRefreshToken");
    expect(found.contract).not.toHaveProperty("mpPaymentId");
    expect(found.contract).not.toHaveProperty("mpRefundId");
    expect(found.contract).not.toHaveProperty("providerAmountCents");
    expect(found.contract).not.toHaveProperty("platformAmountCents");
  });

  it("getMyTraining não vaza os mesmos dados sensíveis, e preserva o que a tela do cliente precisa", async () => {
    const training = await consultancyService.getMyTraining(clientId);
    const found = training.contracts.find((c: any) => c.id === contractId) as any;
    expect(found).toBeTruthy();
    expect(found).not.toHaveProperty("mpPaymentId");
    expect(found).not.toHaveProperty("mpRefundId");
    expect(found).not.toHaveProperty("providerAmountCents");
    expect(found).not.toHaveProperty("platformAmountCents");
    expect(found.provider).not.toHaveProperty("mpAccessToken");
    expect(found.provider).not.toHaveProperty("mpRefreshToken");
    expect(found.provider.displayName).toBe("Profissional Frente Seis Lote Um");
    expect(found.offer.billingCycle).toBe("MONTHLY");
  });

  it("listProviderPackages não vaza cartão salvo/código Pix do cliente pro profissional", async () => {
    const packages = await presentialPackageService.listProviderPackages(providerUserId);
    const found = packages.find((p: any) => p.id === packageId) as any;
    expect(found).toBeTruthy();
    expect(found).not.toHaveProperty("billingCardId");
    expect(found).not.toHaveProperty("pendingChargeMpPaymentId");
    expect(found).not.toHaveProperty("pendingChargePixQrCodeUrl");
    expect(found).not.toHaveProperty("pendingChargePixCopyPasteCode");
    expect(found.cycleAmountCents).toBe(20000);
  });

  it("getPackageById esconde cartão/Pix do cliente quando quem pede é o profissional, mas mantém quando é o próprio cliente", async () => {
    const asProvider = await presentialPackageService.getPackageById(providerUserId, packageId) as any;
    expect(asProvider).not.toHaveProperty("billingCardId");
    expect(asProvider).not.toHaveProperty("pendingChargePixCopyPasteCode");

    const asClient = await presentialPackageService.getPackageById(clientId, packageId) as any;
    expect(asClient.billingCardId).toBe("card_secret_123");
    expect(asClient.pendingChargePixCopyPasteCode).toBe("PIX_COPY_PASTE_SECRET_CODE");
  });

  it("getStudentManagementDetail (tela de gestão de alunos do profissional) não vaza cartão/Pix do cliente", async () => {
    const detail = await providerService.getStudentManagementDetail(providerUserId, clientId);
    const pkg = detail.presentialPackages.find((p: any) => p.id === packageId) as any;
    expect(pkg).toBeTruthy();
    expect(pkg).not.toHaveProperty("billingCardId");
    expect(pkg).not.toHaveProperty("pendingChargeMpPaymentId");
    expect(pkg).not.toHaveProperty("pendingChargePixQrCodeUrl");
    expect(pkg).not.toHaveProperty("pendingChargePixCopyPasteCode");
    expect(pkg.cycleAmountCents).toBe(20000);
  });
});
