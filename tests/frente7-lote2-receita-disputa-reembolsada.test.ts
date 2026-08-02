import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { PaymentRefund } from "mercadopago";
import {
  BookingStatus,
  ConsultancyContractStatus,
  ConsultancyPaymentStatus,
  OfferBillingCycle,
  PaymentMethod,
  PaymentStatus,
  PresentialPackageMode,
  PresentialPackageStatus,
  ServiceOfferKind,
  UserRole
} from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { DisputeCaseService } from "../src/modules/admin/services/dispute-case.service";
import { FinancialService } from "../src/modules/financial/services/financial.service";
import { env } from "../src/config/env";

// Épico de Frentes, Frente 7 (Tela Financeiro do profissional), Lote 2:
// resolver uma disputa como REFUNDED só atualizava o Payment/contrato de
// consultoria - booking (via Payment já corrigido em rodada anterior, mas
// nunca lido pelo financeiro), pacote presencial e renovação de ficha
// continuavam contando a receita pra sempre, mesmo depois do dinheiro
// voltar pro cliente.

const disputeCaseService = new DisputeCaseService();
const financialService = new FinancialService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let categoryId = "";
let adminId = "";
let clientId = "";

const providerUserIds: string[] = [];
const providerIds: string[] = [];
const bookingIds: string[] = [];
const offerIds: string[] = [];
const packageIds: string[] = [];
const contractIds: string[] = [];
const requestIds: string[] = [];
const trainingPlanIds: string[] = [];

async function makeProvider(name: string) {
  const providerUser = await prisma.user.create({
    data: {
      name,
      email: `${uid("f7l2_provider")}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${providerUserIds.length}`,
      role: UserRole.PROVIDER
    }
  });
  providerUserIds.push(providerUser.id);

  const provider = await prisma.providerProfile.create({
    data: {
      userId: providerUser.id,
      displayName: name,
      bio: "test",
      experienceYears: 3,
      priceCents: 10000,
      mpAccountId: "111222333",
      crefValidationStatus: "APPROVED"
    }
  });
  providerIds.push(provider.id);

  return { providerUserId: providerUser.id, providerId: provider.id };
}

describe("Frente 7, Lote 2 — receita de disputa reembolsada não fica inflada", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `F7L2_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Sete Lote Dois",
        email: `${uid("f7l2_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}9`,
        role: UserRole.CLIENT
      }
    });
    clientId = client.id;

    const adminEmail = env.ADMIN_ALLOWED_EMAILS[0];
    let admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!admin) {
      admin = await prisma.user.create({
        data: {
          name: "Frente Sete Lote Dois Admin",
          email: adminEmail,
          password: "x",
          phone: `11${Date.now().toString().slice(-9)}8`,
          role: "CLIENT"
        }
      });
    }
    adminId = admin.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.disputeCase.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.trainingPlan.deleteMany({ where: { id: { in: trainingPlanIds } } });
    await prisma.consultancyContract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.presentialPackageCycle.deleteMany({ where: { package: { id: { in: packageIds } } } });
    await prisma.presentialPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.payment.deleteMany({ where: { booking: { id: { in: bookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: [...providerUserIds, clientId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [...providerUserIds, clientId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("disputa de booking resolvida com reembolso TOTAL some da receita do dashboard financeiro", async () => {
    const { providerUserId, providerId } = await makeProvider("Profissional Booking Total");

    const booking = await prisma.booking.create({
      data: { clientId, providerId, categoryId, scheduledAt: new Date(), priceCents: 10000, status: BookingStatus.COMPLETED, completedAt: new Date() }
    });
    bookingIds.push(booking.id);
    const mpPaymentId = `mp_${uid("pay")}`;
    await prisma.payment.create({
      data: { bookingId: booking.id, method: PaymentMethod.CREDIT_CARD, status: PaymentStatus.CAPTURED, amountCents: 10000, currency: "BRL", mpPaymentId, capturedAt: new Date() }
    });

    const before = await financialService.getDashboard(providerUserId);
    expect(before.appRevenueCents).toBe(10000);

    vi.spyOn(PaymentRefund.prototype, "create").mockResolvedValue({ id: 1 } as any);
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "CHARGEBACK", clientId, providerId, bookingId: booking.id, amountCents: 10000, mpPaymentId }
    });
    await disputeCaseService.resolveCase(adminId, disputeCase.id, { resolution: "REFUNDED", amountCents: 10000, note: "Reembolso total." });

    const after = await financialService.getDashboard(providerUserId);
    expect(after.appRevenueCents).toBe(0);
  });

  it("disputa de booking resolvida com reembolso PARCIAL desconta só a parte reembolsada", async () => {
    const { providerUserId, providerId } = await makeProvider("Profissional Booking Parcial");

    const booking = await prisma.booking.create({
      data: { clientId, providerId, categoryId, scheduledAt: new Date(), priceCents: 10000, status: BookingStatus.COMPLETED, completedAt: new Date() }
    });
    bookingIds.push(booking.id);
    const mpPaymentId = `mp_${uid("pay")}`;
    await prisma.payment.create({
      data: { bookingId: booking.id, method: PaymentMethod.CREDIT_CARD, status: PaymentStatus.CAPTURED, amountCents: 10000, currency: "BRL", mpPaymentId, capturedAt: new Date() }
    });

    vi.spyOn(PaymentRefund.prototype, "create").mockResolvedValue({ id: 2 } as any);
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "CHARGEBACK", clientId, providerId, bookingId: booking.id, amountCents: 10000, mpPaymentId }
    });
    await disputeCaseService.resolveCase(adminId, disputeCase.id, { resolution: "REFUNDED", amountCents: 4000, note: "Reembolso parcial." });

    const after = await financialService.getDashboard(providerUserId);
    expect(after.appRevenueCents).toBe(6000);
  });

  it("disputa de ciclo de pacote presencial resolvida com reembolso some da receita do dashboard financeiro", async () => {
    const { providerUserId, providerId } = await makeProvider("Profissional Pacote");

    const offer = await prisma.providerServiceOffer.create({
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
    offerIds.push(offer.id);

    const pkg = await prisma.presentialPackage.create({
      data: {
        providerId,
        clientId,
        offerId: offer.id,
        categoryId,
        mode: PresentialPackageMode.FIXED_RECURRING,
        status: PresentialPackageStatus.ACTIVE,
        cycleAmountCents: 30000,
        billingCycle: OfferBillingCycle.MONTHLY,
        sessionsPerCycle: 4
      }
    });
    packageIds.push(pkg.id);

    const mpPaymentId = `mp_${uid("cycle")}`;
    const cycle = await prisma.presentialPackageCycle.create({
      data: {
        packageId: pkg.id,
        cycleIndex: 1,
        amountCents: 30000,
        sessionsGranted: 4,
        mpPaymentId,
        capturedAt: new Date(),
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      }
    });

    const before = await financialService.getDashboard(providerUserId);
    expect(before.appRevenueCents).toBe(30000);

    vi.spyOn(PaymentRefund.prototype, "create").mockResolvedValue({ id: 3 } as any);
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", clientId, providerId, presentialPackageCycleId: cycle.id, amountCents: 30000, mpPaymentId }
    });
    await disputeCaseService.resolveCase(adminId, disputeCase.id, { resolution: "REFUNDED", amountCents: 30000, note: "Reembolso do ciclo." });

    const after = await financialService.getDashboard(providerUserId);
    expect(after.appRevenueCents).toBe(0);

    const cycleAfter = await prisma.presentialPackageCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    expect(cycleAfter.refundedAt).toBeTruthy();
    expect(cycleAfter.refundedAmountCents).toBe(30000);
  });

  it("disputa de renovação de ficha resolvida com reembolso some da receita do dashboard financeiro", async () => {
    const { providerUserId, providerId } = await makeProvider("Profissional Renovacao");

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
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date(),
        // 1ª cobrança (ficha original) fora do mês corrente - só a
        // renovação (abaixo) deve entrar na receita do mês testado, senão
        // as duas contam juntas e o teste não isola o que está sendo
        // verificado.
        paymentCapturedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
      }
    });
    contractIds.push(contract.id);

    const mpPaymentId = `mp_${uid("renewal")}`;
    const plan = await prisma.trainingPlan.create({
      data: { providerId, contractId: contract.id, title: "Ficha renovada", renewalMpPaymentId: mpPaymentId }
    });
    trainingPlanIds.push(plan.id);

    const before = await financialService.getDashboard(providerUserId);
    expect(before.appRevenueCents).toBe(20000);

    vi.spyOn(PaymentRefund.prototype, "create").mockResolvedValue({ id: 4 } as any);
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "DELIVERY_CONTESTED", clientId, providerId, trainingPlanId: plan.id, amountCents: 20000, mpPaymentId }
    });
    await disputeCaseService.resolveCase(adminId, disputeCase.id, { resolution: "REFUNDED", amountCents: 20000, note: "Entrega contestada, reembolsada." });

    const after = await financialService.getDashboard(providerUserId);
    expect(after.appRevenueCents).toBe(0);

    const planAfter = await prisma.trainingPlan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(planAfter.refundedAt).toBeTruthy();
  });

  it("consultoria com pagamento reembolsado (caminho já correto) continua funcionando", async () => {
    const { providerUserId, providerId } = await makeProvider("Profissional Consultoria Baseline");

    const offer = await prisma.providerServiceOffer.create({
      data: { providerId, kind: ServiceOfferKind.ONLINE_CONSULTANCY, title: `Consultoria ${uid("offer")}`, billingCycle: OfferBillingCycle.MONTHLY, priceCents: 15000 }
    });
    offerIds.push(offer.id);

    const request = await prisma.consultancyRequest.create({
      data: { providerId, clientId, status: "ACCEPTED", quotedOfferId: offer.id, responseDeadlineAt: new Date(), respondedAt: new Date(), clientDecisionAt: new Date() }
    });
    requestIds.push(request.id);

    const mpPaymentId = `mp_${uid("contract")}`;
    const contract = await prisma.consultancyContract.create({
      data: {
        requestId: request.id,
        providerId,
        clientId,
        offerId: offer.id,
        status: ConsultancyContractStatus.ACTIVE,
        paymentStatus: ConsultancyPaymentStatus.CAPTURED,
        paymentAmountCents: 15000,
        providerAmountCents: 13500,
        platformAmountCents: 1500,
        billingCycle: offer.billingCycle,
        kind: offer.kind,
        mpPaymentId,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date(),
        paymentCapturedAt: new Date()
      }
    });
    contractIds.push(contract.id);

    const before = await financialService.getDashboard(providerUserId);
    expect(before.appRevenueCents).toBe(15000);

    vi.spyOn(PaymentRefund.prototype, "create").mockResolvedValue({ id: 5 } as any);
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "DELIVERY_CONTESTED", clientId, providerId, consultancyContractId: contract.id, amountCents: 15000, mpPaymentId }
    });
    await disputeCaseService.resolveCase(adminId, disputeCase.id, { resolution: "REFUNDED", amountCents: 15000, note: "Reembolso da consultoria." });

    const after = await financialService.getDashboard(providerUserId);
    expect(after.appRevenueCents).toBe(0);
  });
});
