import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { Payment, CardToken } from "mercadopago";
import { ConsultancyContractStatus, OfferBillingCycle, PresentialPackageMode, PresentialPackageStatus } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { NotificationService } from "../src/modules/notifications/services/notification.service";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Raio-X de pagamentos, Rodada 2, Lote 5: purchaseCombo agora bloqueia
// clientes com dívida em aberto (mesma trava que os outros fluxos de
// compra já tinham) e o encerramento automático de ficha vencida avisa
// quando é metade de combo (a parte presencial continua ativa).

const packageService = new PresentialPackageService();
const consultancyService = new ConsultancyService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const offerIds: string[] = [];
const packageIds: string[] = [];
const contractIds: string[] = [];

describe("purchaseCombo bloqueia dívida pendente + aviso de combo no encerramento automático (Rodada 2, Lote 5)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `CD_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Combo Debt Client",
        email: `${uid("cd_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        mpCustomerId: "cus_test_cd",
        emailVerifiedAt: new Date()
      }
    });
    clientId = client.id;

    await prisma.customerPaymentMethod.create({
      data: {
        userId: clientId,
        mpCustomerId: "cus_test_cd",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });

    const providerUser = await prisma.user.create({
      data: {
        name: "Combo Debt Provider",
        email: `${uid("cd_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Combo Debt Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 15000,
        mpAccountId: "555666777",
        mpAccessToken: encryptSensitiveText("fake_access_token"),
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
  });

  afterAll(async () => {
    await prisma.debtRecord.deleteMany({ where: { clientId } });
    await prisma.disputeCase.deleteMany({ where: { clientId } });
    await prisma.trainingPlan.deleteMany({ where: { providerId } });
    await prisma.consultancyContract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId } });
    await prisma.presentialPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("purchaseCombo rejeita cliente com dívida pendente, sem tentar cobrar nada", async () => {
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", clientId, providerId, amountCents: 5000, contextNote: "Teste" }
    });
    const debt = await prisma.debtRecord.create({
      data: {
        disputeCaseId: disputeCase.id,
        debtorType: "CLIENT",
        clientId,
        providerId,
        amountCents: 5000,
        reason: "Pendência de teste",
        status: "PENDING"
      }
    });

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "COMBO",
        title: `Combo ${uid("offer")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 90000,
        presentialPackageMode: PresentialPackageMode.FIXED_RECURRING,
        presentialSessionsPerCycle: 4,
        acceptsCreditCard: true,
        comboPresentialShareCents: 60000,
        comboConsultancyShareCents: 30000,
        comboPresentialDaysPerWeek: 2,
        comboOnlineDaysPerWeek: 3
      }
    });
    offerIds.push(offer.id);

    const createSpy = vi.spyOn(Payment.prototype, "create");

    await expect(
      packageService.purchaseCombo(clientId, {
        offerId: offer.id,
        categoryId,
        paymentMethod: "CREDIT_CARD" as any,
        weeklySchedule: [{ weekday: 3, time: "08:00" }],
        acknowledgedImmediateExecution: true
      })
    ).rejects.toThrow(/pendência financeira/);
    expect(createSpy).not.toHaveBeenCalled();

    await prisma.debtRecord.deleteMany({ where: { id: debt.id } });
    await prisma.disputeCase.deleteMany({ where: { id: disputeCase.id } });
  });

  it("escalateExpiredFichaContracts avisa que a parte presencial do combo continua ativa ao encerrar a consultoria", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "COMBO",
        title: `Combo ${uid("offer")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 50000,
        fichaValidityDays: 10,
        presentialPackageMode: PresentialPackageMode.FIXED_RECURRING,
        presentialSessionsPerCycle: 4,
        comboPresentialShareCents: 30000,
        comboConsultancyShareCents: 20000,
        comboPresentialDaysPerWeek: 2,
        comboOnlineDaysPerWeek: 3
      }
    });
    offerIds.push(offer.id);

    const request = await prisma.consultancyRequest.create({
      data: {
        providerId,
        clientId,
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
        providerId,
        clientId,
        offerId: offer.id,
        status: ConsultancyContractStatus.DELIVERED,
        paymentMethod: "CREDIT_CARD",
        paymentStatus: "CAPTURED",
        paymentAmountCents: 20000,
        providerAmountCents: 18000,
        platformAmountCents: 2000,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date(),
        deliveredAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000)
      }
    });
    contractIds.push(contract.id);

    // Metade presencial do combo, ainda ativa — vinculada via consultancyContractId.
    const pkg = await prisma.presentialPackage.create({
      data: {
        providerId,
        clientId,
        offerId: offer.id,
        categoryId,
        consultancyContractId: contract.id,
        mode: PresentialPackageMode.FIXED_RECURRING,
        status: PresentialPackageStatus.ACTIVE,
        paymentMethod: "CREDIT_CARD",
        cycleAmountCents: 30000,
        billingCycle: OfferBillingCycle.MONTHLY,
        sessionsPerCycle: 4
      }
    });
    packageIds.push(pkg.id);

    await prisma.trainingPlan.create({
      data: {
        providerId,
        contractId: contract.id,
        title: "Ficha vencida há 8 dias (combo)",
        isPrebuilt: false,
        isActive: true,
        createdAt: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000),
        validUntil: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        expiredNoticeSentAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
      }
    });

    const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);

    await consultancyService.escalateExpiredFichaContracts();

    const afterCancel = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(afterCancel.status).toBe(ConsultancyContractStatus.CANCELLED);

    const comboNotice = notifySpy.mock.calls.find(
      (call) => (call[1] as any).data?.type === "COMBO_CONSULTANCY_AUTO_CANCELLED"
    );
    expect(comboNotice).toBeDefined();
    expect((comboNotice![1] as any).body).toMatch(/parte presencial/);

    // Pacote presencial não é tocado — continua ativo e cobrando normalmente.
    const pkgAfter = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(pkgAfter.status).toBe(PresentialPackageStatus.ACTIVE);
  });
});
