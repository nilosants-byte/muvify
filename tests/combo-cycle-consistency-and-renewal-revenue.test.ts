import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { Payment, CardToken } from "mercadopago";
import {
  BookingStatus,
  ConsultancyPaymentMethod,
  OfferBillingCycle,
  PaymentMethod,
  PresentialPackageMode,
  PresentialPackageStatus
} from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";
import { PaymentService } from "../src/modules/payments/services/payment.service";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { FinancialService } from "../src/modules/financial/services/financial.service";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Frente 12 (segunda camada), Lote 13: os ids de pagamento mockados abaixo
// (8001, 8002...) são literais fixos — ConsultancyContract.mpPaymentId e
// PresentialPackage.mpPaymentId são @unique no schema, e outro arquivo de
// teste (consultancy-offer-flexibility.test.ts) usava o mesmo "8001",
// causando "Unique constraint failed on the fields: (mpPaymentId)" quando os
// dois rodavam concorrentes na suíte completa. Offset por arquivo garante
// que a faixa nunca colide com a de outro arquivo.
const MOCK_MP_ID_BASE = Date.now() + Math.floor(Math.random() * 1_000_000);

// Raio-X de pagamentos, Rodada 2, Lote 4: combo em cartão não pode trocar de
// motor de cobrança sozinho a partir do 2º ciclo (chargeDueCycles vs.
// generateDueCardFixedPeriods tinham filtros desalinhados); booking de
// horário fixo sem Payment próprio não pode derrubar a tela de detalhe;
// renovação de ficha precisa aparecer no financeiro do profissional; e
// contestar uma ficha precisa travar a cobrança da próxima renovação.

const packageService = new PresentialPackageService();
const paymentService = new PaymentService();
const consultancyService = new ConsultancyService();
const financialService = new FinancialService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const offerIds: string[] = [];
const packageIds: string[] = [];
const bookingIds: string[] = [];
const contractIds: string[] = [];

describe("Consistência de combo e visibilidade financeira de renovação (Rodada 2, Lote 4)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `CR_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Combo Renewal Client",
        email: `${uid("cr_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        mpCustomerId: "cus_test_cr",
        emailVerifiedAt: new Date()
      }
    });
    clientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });

    await prisma.customerPaymentMethod.create({
      data: {
        userId: clientId,
        mpCustomerId: "cus_test_cr",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });

    const providerUser = await prisma.user.create({
      data: {
        name: "Combo Renewal Provider",
        email: `${uid("cr_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Combo Renewal Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 15000,
        mpAccountId: "222333444",
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
    await prisma.disputeCase.deleteMany({ where: { clientId } });
    await prisma.trainingPlan.deleteMany({ where: { providerId } });
    await prisma.consultancyContract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId } });
    await prisma.presentialPackageCycle.deleteMany({ where: { package: { id: { in: packageIds } } } });
    await prisma.presentialPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.payment.deleteMany({ where: { booking: { id: { in: bookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("combo em cartão mantém o mesmo motor de cobrança (chargeCycle) do 1º ao 3º ciclo, via chargeDueCycles", async () => {
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

    vi.spyOn(Payment.prototype, "create")
      .mockResolvedValueOnce({ id: MOCK_MP_ID_BASE + 1, status: "approved" } as any) // consultoria do combo
      .mockResolvedValueOnce({ id: MOCK_MP_ID_BASE + 2, status: "approved" } as any); // 1o ciclo presencial

    const result = await packageService.purchaseCombo(clientId, {
      offerId: offer.id,
      categoryId,
      paymentMethod: "CREDIT_CARD" as any,
      weeklySchedule: [{ weekday: 1, time: "08:00" }],
      acknowledgedImmediateExecution: true
    });
    const pkg = result.package;
    packageIds.push(pkg.id);
    contractIds.push((result.contract as { id: string }).id);

    const stored = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(stored.consultancyContractId).not.toBeNull();
    expect(stored.nextCycleIndex).toBe(2);

    // Força o vencimento do 2o ciclo e roda o job periodico — deve ir por
    // chargeCycle (Payment.create), nao por activateCardFixedPeriod (que
    // nao chama Payment.create nenhum).
    await prisma.presentialPackage.update({
      where: { id: pkg.id },
      data: { nextBillingAt: new Date(Date.now() - 60_000) }
    });

    // Cleanup pós-épico segunda camada: chargeDueCycles() varre TODO pacote
    // com nextBillingAt vencido no banco inteiro, por desenho (é o job real
    // de produção) — sob a suíte completa em paralelo, outro arquivo
    // concorrente pode ter deixado um pacote seu também vencido no mesmo
    // instante, fazendo esse spy global (Payment.prototype.create) contar
    // 2 chamadas em vez de 1 sem ser bug nenhum. toHaveBeenCalledTimes(1)
    // dava falso negativo nesse cenário. A idempotencyKey embute
    // pkg.id+cycleIndex — verificar por ela confirma que ESTE pacote foi
    // cobrado exatamente uma vez, imune a outro pacote concorrente
    // legitimamente cobrado na mesma varredura.
    const createSpy = vi.spyOn(Payment.prototype, "create").mockResolvedValueOnce({ id: MOCK_MP_ID_BASE + 3, status: "approved" } as any);
    await packageService.chargeDueCycles();
    const cycle2Calls = createSpy.mock.calls.filter(
      (call) => (call[0] as any)?.requestOptions?.idempotencyKey?.startsWith(`presential-package:${pkg.id}:cycle:2:`)
    );
    expect(cycle2Calls).toHaveLength(1);

    const afterCycle2 = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(afterCycle2.nextCycleIndex).toBe(3);

    // 3o ciclo — mesma verificação, pra confirmar que não foi coincidência.
    await prisma.presentialPackage.update({
      where: { id: pkg.id },
      data: { nextBillingAt: new Date(Date.now() - 60_000) }
    });
    const createSpy2 = vi.spyOn(Payment.prototype, "create").mockResolvedValueOnce({ id: MOCK_MP_ID_BASE + 4, status: "approved" } as any);
    await packageService.chargeDueCycles();
    const cycle3Calls = createSpy2.mock.calls.filter(
      (call) => (call[0] as any)?.requestOptions?.idempotencyKey?.startsWith(`presential-package:${pkg.id}:cycle:3:`)
    );
    expect(cycle3Calls).toHaveLength(1);
  });

  it("generateDueCardFixedPeriods ignora pacotes de combo (não cobra por sessão o que é combo)", async () => {
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

    vi.spyOn(Payment.prototype, "create")
      .mockResolvedValueOnce({ id: MOCK_MP_ID_BASE + 101, status: "approved" } as any)
      .mockResolvedValueOnce({ id: MOCK_MP_ID_BASE + 102, status: "approved" } as any);

    const result = await packageService.purchaseCombo(clientId, {
      offerId: offer.id,
      categoryId,
      paymentMethod: "CREDIT_CARD" as any,
      weeklySchedule: [{ weekday: 2, time: "09:00" }],
      acknowledgedImmediateExecution: true
    });
    const pkg = result.package;
    packageIds.push(pkg.id);
    contractIds.push((result.contract as { id: string }).id);

    await prisma.presentialPackage.update({
      where: { id: pkg.id },
      data: { nextBillingAt: new Date(Date.now() - 60_000) }
    });

    const createSpy = vi.spyOn(Payment.prototype, "create");
    const bookingsBefore = await prisma.booking.count({ where: { packageId: pkg.id } });
    await packageService.generateDueCardFixedPeriods();
    const bookingsAfter = await prisma.booking.count({ where: { packageId: pkg.id } });

    // generateDueCardFixedPeriods não deveria sequer olhar pra esse pacote —
    // nenhuma cobrança nova, nenhuma sessão gerada por ele.
    expect(createSpy).not.toHaveBeenCalled();
    expect(bookingsAfter).toBe(bookingsBefore);
  });

  it("agendamento de horário fixo sem Payment próprio: getPaymentForBooking devolve null em vez de 404", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "PRESENTIAL",
        title: `Pacote ${uid("offer")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 40000,
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
        paymentMethod: PaymentMethod.CREDIT_CARD,
        cycleAmountCents: 40000,
        billingCycle: OfferBillingCycle.MONTHLY,
        sessionsPerCycle: 4
      }
    });
    packageIds.push(pkg.id);

    // Booking gerado por ciclo de horário fixo — sem Payment (activateCycle
    // nunca cria um), diferente de um booking avulso normal.
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        packageId: pkg.id,
        scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        priceCents: 0,
        status: BookingStatus.CONFIRMED
      }
    });
    bookingIds.push(booking.id);

    const result = await paymentService.getPaymentForBooking(booking.id, clientId);
    expect(result).toBeNull();
  });

  it("renovação de ficha aparece na lista de repasses (getPayouts) e no total disponível", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "ONLINE_CONSULTANCY",
        title: `Consultoria ${uid("offer")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 25000,
        fichaValidityDays: 30
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
        status: "ACTIVE",
        paymentMethod: "CREDIT_CARD",
        paymentStatus: "CAPTURED",
        paymentAmountCents: 25000,
        providerAmountCents: 22500,
        platformAmountCents: 2500,
        billingCycle: "MONTHLY",
        kind: "ONLINE_CONSULTANCY",
        fichaValidityDays: 30,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date()
      }
    });
    contractIds.push(contract.id);

    await consultancyService.deliverContract(providerUserId, contract.id, { title: "Ficha 1", exercises: [] });

    vi.spyOn(Payment.prototype, "create").mockResolvedValueOnce({ id: MOCK_MP_ID_BASE + 201, status: "approved" } as any);
    await consultancyService.deliverContract(providerUserId, contract.id, { title: "Ficha 2 (renovação)", exercises: [] });

    const payouts = await financialService.getPayouts(providerUserId);
    const renewalTx = payouts.payments.find((p) => p.type === "CONSULTANCY_RENEWAL");
    expect(renewalTx).toBeDefined();
    expect(renewalTx?.amountCents).toBe(25000);
    expect(renewalTx?.providerAmountCents).toBe(22500);
  });

  it("contestar uma ficha bloqueia a cobrança da próxima renovação até o caso ser resolvido", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "ONLINE_CONSULTANCY",
        title: `Consultoria ${uid("offer")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 18000,
        fichaValidityDays: 30
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
        status: "ACTIVE",
        paymentMethod: "CREDIT_CARD",
        paymentStatus: "CAPTURED",
        paymentAmountCents: 18000,
        providerAmountCents: 16200,
        platformAmountCents: 1800,
        billingCycle: "MONTHLY",
        kind: "ONLINE_CONSULTANCY",
        fichaValidityDays: 30,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date()
      }
    });
    contractIds.push(contract.id);

    await consultancyService.deliverContract(providerUserId, contract.id, { title: "Ficha 1", exercises: [] });
    await consultancyService.contestDelivery(clientId, contract.id, "A ficha não corresponde ao combinado.");

    const createSpy = vi.spyOn(Payment.prototype, "create");
    await expect(
      consultancyService.deliverContract(providerUserId, contract.id, { title: "Ficha 2 (renovação)", exercises: [] })
    ).rejects.toThrow(/contestação em aberto/);
    expect(createSpy).not.toHaveBeenCalled();
  });
});
