import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BookingStatus, PaymentMethod, PaymentStatus, ConsultancyPaymentMethod, OfferBillingCycle } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { FinancialService } from "../src/modules/financial/services/financial.service";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Frente 3 (segunda camada) — consistência financeira do profissional.
// Cobre os achados centrais da investigação desta frente: saldo "disponível
// pra saque" cortado por take:50 no histórico completo (Lote 1), comissão
// que misturava taxa real com valor estornado (Lote 3), "Alunos" não
// descontando reembolso de sessão avulsa nem incluindo renovação de ficha
// (Lote 5), card semanal da Home só contando sessão presencial (Lote 6),
// dívida do profissional ausente do resumo geral (Lote 7), e "Lucro" do
// relatório sendo receita bruta em vez de líquida (Lote 2).

const financialService = new FinancialService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const bookingIds: string[] = [];
const offerIds: string[] = [];
const contractIds: string[] = [];
const debtRecordIds: string[] = [];
const disputeCaseIds: string[] = [];

describe("Frente 3 (segunda camada) — consistência financeira do profissional", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `FIN3_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Frente3 Financial Client",
        email: `${uid("f3_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        mpCustomerId: "cus_test_f3"
      }
    });
    clientId = client.id;

    const provider = await prisma.user.create({
      data: {
        name: "Frente3 Financial Provider",
        email: `${uid("f3_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = provider.id;

    const providerProfile = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Frente3 Financial Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "f3_test_account",
        mpAccessToken: encryptSensitiveText("fake_access_token"),
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = providerProfile.id;
  });

  afterAll(async () => {
    await prisma.debtRecord.deleteMany({ where: { id: { in: debtRecordIds } } });
    await prisma.disputeCase.deleteMany({ where: { id: { in: disputeCaseIds } } });
    await prisma.consultancyContract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.payment.deleteMany({ where: { booking: { id: { in: bookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [clientId, providerUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("Lote 1: getPayouts sem mês soma o histórico completo, não só os 50 pagamentos mais recentes", async () => {
    // 55 pagamentos capturados de um período passado (fora da semana/mês
    // corrente, pra não colidir com os testes de Lote 6/2 abaixo) — mais
    // que o antigo teto de 50 usado só pra exibição.
    const COUNT = 55;
    const scheduledBase = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    for (let i = 0; i < COUNT; i++) {
      const booking = await prisma.booking.create({
        data: {
          clientId,
          providerId,
          categoryId,
          scheduledAt: new Date(scheduledBase.getTime() - i * 60 * 1000),
          priceCents: 1000,
          status: BookingStatus.COMPLETED
        }
      });
      bookingIds.push(booking.id);
      await prisma.payment.create({
        data: {
          bookingId: booking.id,
          amountCents: 1000,
          providerAmountCents: 900,
          platformFeeCents: 100,
          method: PaymentMethod.CREDIT_CARD,
          status: PaymentStatus.CAPTURED,
          capturedAt: new Date(scheduledBase.getTime() - i * 60 * 1000),
          mpPaymentId: `mp_${uid("bulk")}`
        }
      });
    }

    const payouts = await financialService.getPayouts(providerUserId);
    // Frente 2 (segunda camada), Lote 1 do épico anterior: antes desta
    // frente, availableCents/grossCents eram somados só sobre os 50 mais
    // recentes quando `month` não era informado — um profissional ativo
    // "esquecia" pagamentos mais antigos do saldo mostrado.
    expect(payouts.availableCents).toBeGreaterThanOrEqual(COUNT * 900);
    expect(payouts.grossCents).toBeGreaterThanOrEqual(COUNT * 1000);
    // A lista de exibição continua limitada a 50 linhas (comportamento
    // antigo preservado — só os TOTAIS pararam de ser cortados).
    expect(payouts.payments.length).toBeLessThanOrEqual(50);
  });

  it("Lote 3: comissão exposta separadamente do valor estornado (bruto = comissão + líquido + estornado)", async () => {
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        priceCents: 10000,
        status: BookingStatus.COMPLETED
      }
    });
    bookingIds.push(booking.id);
    await prisma.payment.create({
      data: {
        bookingId: booking.id,
        amountCents: 10000,
        providerAmountCents: 9000,
        platformFeeCents: 1000,
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.PARTIALLY_REFUNDED,
        capturedAt: new Date(),
        refundedAt: new Date(),
        refundedAmountCents: 4000,
        mpPaymentId: `mp_${uid("partial3")}`
      }
    });

    const payouts = await financialService.getPayouts(providerUserId);
    const tx = payouts.payments.find((p) => p.bookingId === booking.id);
    expect(tx).toBeDefined();
    // (10000-4000)/10000 = 0.6 restante -> comissão real 1000*0.6=600
    expect(payouts.platformFeeCents).toBeGreaterThanOrEqual(600);
    expect(payouts.refundedCents).toBeGreaterThanOrEqual(4000);
    // Identidade completa: bruto = comissão + líquido + estornado.
    expect(payouts.grossCents).toBe(payouts.platformFeeCents + payouts.availableCents + payouts.refundedCents);
  });

  it("Lote 5: listAppClients desconta reembolso de sessão avulsa e inclui renovação de ficha", async () => {
    // Mede antes de criar os fixtures deste teste — outros testes deste
    // mesmo arquivo compartilham provider/client/mês, então o total
    // absoluto não é confiável, só a diferença causada por este teste.
    const before = await financialService.listAppClients(providerUserId);
    const completedCentsBefore = before.find((c) => c.clientId === clientId)?.completedCents ?? 0;

    const refundedBooking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(),
        priceCents: 10000,
        status: BookingStatus.COMPLETED
      }
    });
    bookingIds.push(refundedBooking.id);
    await prisma.payment.create({
      data: {
        bookingId: refundedBooking.id,
        amountCents: 10000,
        providerAmountCents: 9000,
        platformFeeCents: 1000,
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.PARTIALLY_REFUNDED,
        capturedAt: new Date(),
        refundedAt: new Date(),
        refundedAmountCents: 6000,
        mpPaymentId: `mp_${uid("appclient")}`
      }
    });

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "ONLINE_CONSULTANCY",
        title: `Consultoria ${uid("offer3")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 30000,
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
        status: "DELIVERED",
        paymentMethod: ConsultancyPaymentMethod.CREDIT_CARD,
        paymentStatus: "CAPTURED",
        paymentAmountCents: 30000,
        providerAmountCents: 27000,
        platformAmountCents: 3000,
        billingCycle: "MONTHLY",
        kind: "ONLINE_CONSULTANCY",
        fichaValidityDays: 30,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date(),
        deliveredAt: new Date(),
        paymentCapturedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      }
    });
    contractIds.push(contract.id);
    // Ficha de RENOVAÇÃO (não a primeira) — cobra de novo, precisa aparecer.
    await prisma.trainingPlan.create({
      data: {
        providerId,
        contractId: contract.id,
        title: "Ficha renovada",
        isPrebuilt: false,
        isActive: true,
        renewalMpPaymentId: `mp_${uid("renewal3")}`
      }
    });

    const appClients = await financialService.listAppClients(providerUserId);
    const entry = appClients.find((c) => c.clientId === clientId);
    expect(entry).toBeDefined();
    // (10000-6000)/10000 = 0.4 restante -> só 4000 dessa sessão contam.
    // renewalCount >= 1 confirma que a renovação de ficha entrou na soma.
    expect(entry!.renewalCount).toBeGreaterThanOrEqual(1);
    expect(entry!.services).toContain("Renovação de ficha");
    // Delta causado por este teste: sessão já descontada (4000) + renovação
    // (30000) = 34000 — nunca o valor cheio da sessão (10000) sem desconto,
    // que daria um delta de 40000.
    const delta = entry!.completedCents - completedCentsBefore;
    expect(delta).toBe(4000 + 30000);
  });

  it("Lote 6 e Lote 7: dashboard expõe receita semanal completa (não só presencial) e dívida em aberto do profissional", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "ONLINE_CONSULTANCY",
        title: `Consultoria ${uid("offer6")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 20000,
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
        status: "DELIVERED",
        paymentMethod: ConsultancyPaymentMethod.CREDIT_CARD,
        paymentStatus: "CAPTURED",
        paymentAmountCents: 20000,
        providerAmountCents: 18000,
        platformAmountCents: 2000,
        billingCycle: "MONTHLY",
        kind: "ONLINE_CONSULTANCY",
        fichaValidityDays: 30,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date(),
        deliveredAt: new Date(),
        // dentro da semana corrente, sem nenhum booking presencial na mesma janela
        paymentCapturedAt: new Date()
      }
    });
    contractIds.push(contract.id);

    const disputeCase = await prisma.disputeCase.create({
      data: {
        type: "REFUND_FAILED",
        status: "RESOLVED",
        clientId,
        providerId,
        amountCents: 500,
        resolution: "REFUNDED",
        resolvedAmountCents: 500,
        resolutionNote: "Frente 3 teste"
      }
    });
    disputeCaseIds.push(disputeCase.id);
    const debt = await prisma.debtRecord.create({
      data: {
        disputeCaseId: disputeCase.id,
        debtorType: "PROVIDER",
        providerId,
        amountCents: 500,
        reason: "Frente 3 teste — dívida de reembolso",
        status: "NOTIFIED"
      }
    });
    debtRecordIds.push(debt.id);

    const dashboard = await financialService.getDashboard(providerUserId);
    // Lote 6: card semanal da Home passa a incluir consultoria (antes só
    // olhava sessão presencial, travando em 0 pra quem vende consultoria).
    expect(dashboard.weeklyRevenueCents).toBeGreaterThanOrEqual(18000);
    // Lote 7: dívida do profissional aparece no resumo geral.
    expect(dashboard.outstandingDebtCents).toBeGreaterThanOrEqual(500);
  });

  it("Lote 2: 'Lucro' do relatório desconta a comissão da plataforma, não só despesas manuais", async () => {
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(),
        priceCents: 10000,
        status: BookingStatus.COMPLETED
      }
    });
    bookingIds.push(booking.id);
    await prisma.payment.create({
      data: {
        bookingId: booking.id,
        amountCents: 10000,
        providerAmountCents: 9000,
        platformFeeCents: 1000,
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.CAPTURED,
        capturedAt: new Date(),
        mpPaymentId: `mp_${uid("netprofit")}`
      }
    });

    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const report = await financialService.getReport(providerUserId, 1);
    const currentMonthReport = report.months.find((m) => m.month === currentMonthKey);
    expect(currentMonthReport).toBeDefined();
    // Sem despesas manuais registradas neste teste: se "Lucro" ainda fosse
    // bruto - despesas (bug antigo), netCents incluiria os 10000 cheios daqui.
    // Com o conserto, no máximo os 9000 líquidos desta venda entram.
    expect(currentMonthReport!.netCents).toBeLessThan(currentMonthReport!.appRevenueCents);
  });
});
