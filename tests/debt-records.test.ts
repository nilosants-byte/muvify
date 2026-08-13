import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { Payment, CardToken, PaymentRefund } from "mercadopago";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { DisputeCaseService } from "../src/modules/admin/services/dispute-case.service";
import { DebtService } from "../src/modules/payments/services/debt.service";
import { BookingService } from "../src/modules/bookings/services/booking.service";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";

// Frente 4 do roteiro de seguranca de pagamentos: registro interno de "quem
// deve o que, pra quem, por qual motivo" (DebtRecord). Cobre: divida do
// personal nascendo automatica quando uma disputa e resolvida como
// reembolso, divida do aluno nascendo manualmente quando o admin nega uma
// disputa apontando que o aluno ja recebeu indevidamente, o bloqueio de
// novas compras enquanto ha divida em aberto, e o pagamento da divida com
// cartao salvo (mock do SDK do Mercado Pago, sem chamada de rede real).

vi.spyOn(PaymentRefund.prototype, "create").mockImplementation(async ({ payment_id, body }: any) => ({
  id: 999,
  payment_id: Number(payment_id),
  amount: body?.amount
} as any));

const disputeCaseService = new DisputeCaseService();
const debtService = new DebtService();
const bookingService = new BookingService();
const presentialPackageService = new PresentialPackageService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let adminId = "";
let categoryId = "";

describe("DebtRecord — pendências financeiras entre disputa e cobrança (Frente 4)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `DR_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Debt Client",
        email: `${uid("debt_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        mpCustomerId: "cus_test_debt",
        emailVerifiedAt: new Date()
      }
    });
    clientId = client.id;

    await prisma.customerPaymentMethod.create({
      data: {
        userId: clientId,
        mpCustomerId: "cus_test_debt",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });

    const providerUser = await prisma.user.create({
      data: {
        name: "Debt Provider",
        email: `${uid("debt_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER",
        mpCustomerId: "cus_test_debt_provider"
      }
    });
    providerUserId = providerUser.id;

    await prisma.customerPaymentMethod.create({
      data: {
        userId: providerUserId,
        mpCustomerId: "cus_test_debt_provider",
        mpCardId: `card_${uid("p")}`,
        nickname: "Cartão do profissional",
        brand: "visa",
        last4: "1111",
        funding: "CREDIT"
      }
    });

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Debt Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 20000,
        mpAccountId: "999888777",
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    // O e-mail admin e compartilhado com outros arquivos de teste rodando em
    // paralelo (so existe 1 na allowlist) — se outro arquivo ja criou a
    // conta primeiro, reaproveita em vez de colidir (P2002).
    const admin = await prisma.user
      .create({
        data: {
          name: "Debt Admin",
          email: env.ADMIN_ALLOWED_EMAILS[0],
          password: "x",
          phone: `11${Date.now().toString().slice(-9)}3`,
          role: "CLIENT"
        }
      })
      .catch(() => prisma.user.findUniqueOrThrow({ where: { email: env.ADMIN_ALLOWED_EMAILS[0] } }));
    adminId = admin.id;
  });

  afterAll(async () => {
    await prisma.debtRecord.deleteMany({ where: { OR: [{ clientId }, { providerId }] } });
    // Frente 12 (segunda camada), Lote 4: NÃO apaga AdminAuditLog daqui —
    // adminId é a conta fixa compartilhada com dezenas de outros arquivos
    // rodando em paralelo; apagar aqui podia derrubar a asserção de outro
    // arquivo concorrente que ainda não tinha lido o próprio registro
    // (mesma classe de risco já reconhecida pra não apagar a conta admin
    // em si). AdminAuditLog é trilha de auditoria — crescimento no banco
    // de teste é aceitável, mesmo raciocínio já usado pra produção.
    await prisma.disputeCase.deleteMany({ where: { clientId } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: { in: [clientId, providerUserId] } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    // Nao apaga a conta admin: o e-mail e compartilhado com outros arquivos
    // de teste rodando em paralelo — apagar aqui pode derrubar outro arquivo
    // no meio do proprio teste.
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
    vi.restoreAllMocks();
  });

  it("resolver uma disputa como reembolso cria a dívida do personal automaticamente", async () => {
    const disputeCase = await prisma.disputeCase.create({
      data: {
        type: "CHARGEBACK",
        clientId,
        providerId,
        amountCents: 10000,
        mpPaymentId: `mp_${uid("resolve")}`
      }
    });

    await disputeCaseService.resolveCase(adminId, disputeCase.id, {
      resolution: "REFUNDED",
      amountCents: 6000,
      note: "Reembolso parcial acordado entre as partes."
    });

    const debt = await prisma.debtRecord.findFirst({ where: { disputeCaseId: disputeCase.id } });
    expect(debt).not.toBeNull();
    expect(debt?.debtorType).toBe("PROVIDER");
    expect(debt?.providerId).toBe(providerId);
    // Raio-X de pagamentos, Rodada 5, Lote 3: a dívida cobra o valor líquido
    // (90%) que o profissional efetivamente recebeu, não o bruto de 6000 —
    // a comissão da plataforma (10%, já embolsada na venda original) nunca
    // é cobrada de volta dele.
    expect(debt?.amountCents).toBe(5400);
    expect(debt?.status).toBe("NOTIFIED");
  });

  it("negar uma disputa sem marcar pendência do aluno não cria nenhum DebtRecord", async () => {
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", clientId, providerId, amountCents: 5000 }
    });

    await disputeCaseService.resolveCase(adminId, disputeCase.id, {
      resolution: "DENIED",
      note: "Evidências indicam que o serviço foi prestado normalmente."
    });

    const debt = await prisma.debtRecord.findFirst({ where: { disputeCaseId: disputeCase.id } });
    expect(debt).toBeNull();
  });

  it("negar uma disputa marcando pendência do aluno cria o DebtRecord do aluno", async () => {
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", clientId, providerId, amountCents: 5000 }
    });

    await disputeCaseService.resolveCase(adminId, disputeCase.id, {
      resolution: "DENIED",
      note: "O aluno já havia sido reembolsado indevidamente antes desta disputa.",
      chargeClientDebtCents: 3000
    });

    const debt = await prisma.debtRecord.findFirst({ where: { disputeCaseId: disputeCase.id } });
    expect(debt).not.toBeNull();
    expect(debt?.debtorType).toBe("CLIENT");
    expect(debt?.clientId).toBe(clientId);
    expect(debt?.amountCents).toBe(3000);
    expect(debt?.status).toBe("NOTIFIED");

    await prisma.debtRecord.delete({ where: { id: debt!.id } });
  });

  it("aluno com pendência em aberto é bloqueado de criar um novo agendamento avulso", async () => {
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", clientId, providerId, amountCents: 5000 }
    });
    const debt = await prisma.debtRecord.create({
      data: {
        disputeCaseId: disputeCase.id,
        debtorType: "CLIENT",
        clientId,
        amountCents: 3000,
        reason: "teste de bloqueio",
        status: "NOTIFIED"
      }
    });

    const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    await expect(
      bookingService.create(clientId, "nonexistent-provider", categoryId, futureDate)
    ).rejects.toThrow(/pendência/i);

    await prisma.debtRecord.delete({ where: { id: debt.id } });
    await prisma.disputeCase.delete({ where: { id: disputeCase.id } });
  });

  it("aluno com pendência em aberto é bloqueado de comprar um pacote presencial", async () => {
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", clientId, providerId, amountCents: 5000 }
    });
    const debt = await prisma.debtRecord.create({
      data: {
        disputeCaseId: disputeCase.id,
        debtorType: "CLIENT",
        clientId,
        amountCents: 3000,
        reason: "teste de bloqueio",
        status: "PENDING"
      }
    });

    await expect(
      presentialPackageService.purchasePackage(clientId, {
        offerId: "nonexistent-offer",
        categoryId,
        paymentMethod: "CREDIT_CARD" as any
      })
    ).rejects.toThrow(/pendência/i);

    await prisma.debtRecord.delete({ where: { id: debt.id } });
    await prisma.disputeCase.delete({ where: { id: disputeCase.id } });
  });

  it("pagar a dívida cobra o cartão salvo, marca como PAID e libera novas compras", async () => {
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
    const paymentCreateSpy = vi.spyOn(Payment.prototype, "create").mockResolvedValue({
      id: 777,
      status: "approved"
    } as any);

    const disputeCase = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", clientId, providerId, amountCents: 5000 }
    });
    const debt = await prisma.debtRecord.create({
      data: {
        disputeCaseId: disputeCase.id,
        debtorType: "CLIENT",
        clientId,
        amountCents: 3000,
        reason: "teste de pagamento",
        status: "NOTIFIED"
      }
    });

    const paid = await debtService.payDebt(clientId, debt.id);

    expect(paid.status).toBe("PAID");
    expect(paid.mpPaymentId).toBe("777");
    expect(paid.paidAt).not.toBeNull();
    expect(paymentCreateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ transaction_amount: 30, capture: true })
      })
    );

    await expect(debtService.assertNoOutstandingDebt(clientId)).resolves.toBeUndefined();

    await prisma.debtRecord.delete({ where: { id: debt.id } });
    await prisma.disputeCase.delete({ where: { id: disputeCase.id } });
  });

  it("rejeita pagar uma dívida que já foi paga", async () => {
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", clientId, providerId, amountCents: 5000 }
    });
    const debt = await prisma.debtRecord.create({
      data: {
        disputeCaseId: disputeCase.id,
        debtorType: "CLIENT",
        clientId,
        amountCents: 3000,
        reason: "teste",
        status: "PAID",
        paidAt: new Date(),
        mpPaymentId: "already_paid"
      }
    });

    await expect(debtService.payDebt(clientId, debt.id)).rejects.toThrow();

    await prisma.debtRecord.delete({ where: { id: debt.id } });
    await prisma.disputeCase.delete({ where: { id: disputeCase.id } });
  });

  it("rejeita pagar uma dívida de outro cliente", async () => {
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", clientId, providerId, amountCents: 5000 }
    });
    const debt = await prisma.debtRecord.create({
      data: {
        disputeCaseId: disputeCase.id,
        debtorType: "CLIENT",
        clientId,
        amountCents: 3000,
        reason: "teste",
        status: "NOTIFIED"
      }
    });

    await expect(debtService.payDebt("outro-cliente-qualquer", debt.id)).rejects.toThrow();

    await prisma.debtRecord.delete({ where: { id: debt.id } });
    await prisma.disputeCase.delete({ where: { id: disputeCase.id } });
  });

  it("profissional consegue pagar a própria dívida ativamente, sem split de marketplace (Rodada 4, Lote 6)", async () => {
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test_provider" } as any);
    const paymentCreateSpy = vi.spyOn(Payment.prototype, "create").mockResolvedValue({
      id: 888,
      status: "approved"
    } as any);

    const disputeCase = await prisma.disputeCase.create({
      data: { type: "CHARGEBACK", clientId, providerId, amountCents: 6000, mpPaymentId: `mp_${uid("prov_pay")}` }
    });
    const debt = await prisma.debtRecord.create({
      data: {
        disputeCaseId: disputeCase.id,
        debtorType: "PROVIDER",
        providerId,
        amountCents: 4000,
        reason: "teste de pagamento do profissional",
        status: "NOTIFIED"
      }
    });

    const paid = await debtService.payDebt(providerUserId, debt.id);

    expect(paid.status).toBe("PAID");
    expect(paid.mpPaymentId).toBe("888");
    expect(paid.paidAt).not.toBeNull();
    // Dívida do profissional é dinheiro que ele já recebeu indevidamente —
    // vai direto pra conta da própria plataforma, sem collector nem
    // marketplace_fee (diferente da dívida do cliente, cobrada em nome do
    // profissional).
    const callBody = paymentCreateSpy.mock.calls[0][0].body as Record<string, unknown>;
    expect(callBody.collector).toBeUndefined();
    expect(callBody.marketplace_fee).toBeUndefined();
    expect(callBody.transaction_amount).toBe(40);

    await prisma.debtRecord.delete({ where: { id: debt.id } });
    await prisma.disputeCase.delete({ where: { id: disputeCase.id } });
  });

  it("rejeita profissional tentando pagar dívida de outro profissional", async () => {
    const disputeCase = await prisma.disputeCase.create({
      data: { type: "CHARGEBACK", clientId, providerId, amountCents: 5000, mpPaymentId: `mp_${uid("prov_reject")}` }
    });
    const debt = await prisma.debtRecord.create({
      data: {
        disputeCaseId: disputeCase.id,
        debtorType: "PROVIDER",
        providerId,
        amountCents: 3000,
        reason: "teste",
        status: "NOTIFIED"
      }
    });

    await expect(debtService.payDebt("outro-profissional-qualquer", debt.id)).rejects.toThrow();

    await prisma.debtRecord.delete({ where: { id: debt.id } });
    await prisma.disputeCase.delete({ where: { id: disputeCase.id } });
  });
});
