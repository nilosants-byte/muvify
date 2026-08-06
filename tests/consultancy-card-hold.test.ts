import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { Payment, CardToken, PaymentRefund } from "mercadopago";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Frente 3a do roteiro de seguranca de pagamentos: pagamento de consultoria no
// cartao vira reserva (capture:false) no aceite, com cobranca de verdade so
// na entrega da primeira ficha. Estes testes cobrem o motor novo (aceite,
// entrega com captura, falha de captura bloqueando a entrega, e liberacao da
// reserva quando o prazo de 48h vence sem entrega) usando mocks do SDK do
// Mercado Pago — sem nenhuma chamada de rede real.

const consultancyService = new ConsultancyService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
let offerId = "";

describe("Consultoria — reserva no cartão e captura na entrega", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `CH_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Hold Client",
        email: `${uid("hold_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        mpCustomerId: "cus_test_hold",
        emailVerifiedAt: new Date()
      }
    });
    clientId = client.id;

    await prisma.customerPaymentMethod.create({
      data: {
        userId: clientId,
        mpCustomerId: "cus_test_hold",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });

    await prisma.clientAnamnesis.create({
      data: { clientId, status: "COMPLETED", completedAt: new Date() }
    });

    const providerUser = await prisma.user.create({
      data: {
        name: "Hold Provider",
        email: `${uid("hold_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Hold Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 20000,
        mpAccountId: "999888777",
        mpAccessToken: encryptSensitiveText("fake_access_token"),
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "ONLINE_CONSULTANCY",
        title: "Consultoria com reserva",
        billingCycle: "MONTHLY",
        priceCents: 20000
      }
    });
    offerId = offer.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.disputeCase.deleteMany({ where: { clientId } });
    await prisma.trainingPlan.deleteMany({ where: { providerId } });
    await prisma.consultancyContract.deleteMany({ where: { clientId } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: offerId } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  async function makeRespondedRequest() {
    return prisma.consultancyRequest.create({
      data: {
        providerId,
        clientId,
        status: "RESPONDED",
        quotedOfferId: offerId,
        responseDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        respondedAt: new Date()
      }
    });
  }

  it("aceite no cartão reserva o valor (AUTHORIZED) e não captura nada ainda", async () => {
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
    vi.spyOn(Payment.prototype, "create").mockResolvedValue({
      id: 111,
      status: "authorized"
    } as any);

    const request = await makeRespondedRequest();

    const { contract } = await consultancyService.decideRequest(clientId, request.id, {
      decision: "ACCEPT",
      paymentMethod: "CREDIT_CARD" as any,
      acknowledgedImmediateExecution: true
    });

    expect(contract!.paymentStatus).toBe("AUTHORIZED");
    expect(contract!.status).toBe("ACTIVE");
    expect(contract!.paymentCapturedAt).toBeNull();
  });

  it("entregar a primeira ficha captura o valor reservado e marca o contrato como DELIVERED", async () => {
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
    vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 222, status: "authorized" } as any);
    const captureSpy = vi.spyOn(Payment.prototype, "capture").mockResolvedValue({ status: "approved", status_detail: "accredited" } as any);

    const request = await makeRespondedRequest();
    const { contract } = await consultancyService.decideRequest(clientId, request.id, {
      decision: "ACCEPT",
      paymentMethod: "CREDIT_CARD" as any,
      acknowledgedImmediateExecution: true
    });

    const { plan, contract: delivered } = await consultancyService.deliverContract(providerUserId, contract!.id, {
      title: "Ficha 1",
      exercises: [
        { name: "Agachamento", repetitionsSets: "4x10", load: "40kg" }
      ]
    });

    expect(captureSpy).toHaveBeenCalledWith({
      id: "222",
      transaction_amount: 200,
      requestOptions: { idempotencyKey: `consultancy:${contract!.id}:capture` }
    });
    expect(delivered.status).toBe("DELIVERED");
    expect(delivered.paymentStatus).toBe("CAPTURED");
    expect(delivered.paymentCapturedAt).not.toBeNull();
    expect(plan.title).toBe("Ficha 1");
  });

  it("se a captura falhar na entrega, a entrega inteira falha e nada é salvo", async () => {
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
    vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 333, status: "authorized" } as any);
    vi.spyOn(Payment.prototype, "capture").mockRejectedValue(new Error("gateway indisponível"));

    const request = await makeRespondedRequest();
    const { contract } = await consultancyService.decideRequest(clientId, request.id, {
      decision: "ACCEPT",
      paymentMethod: "CREDIT_CARD" as any,
      acknowledgedImmediateExecution: true
    });

    await expect(
      consultancyService.deliverContract(providerUserId, contract!.id, {
        title: "Ficha que não deve salvar",
        exercises: [{ name: "Agachamento", repetitionsSets: "4x10", load: "40kg" }]
      })
    ).rejects.toThrow();

    const afterFailure = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract!.id } });
    expect(afterFailure.status).toBe("ACTIVE");
    expect(afterFailure.paymentStatus).toBe("AUTHORIZED");
    expect(afterFailure.deliveredAt).toBeNull();

    const plans = await prisma.trainingPlan.findMany({ where: { contractId: contract!.id } });
    expect(plans).toHaveLength(0);
  });

  it("prazo de 48h vencido sem entrega: libera a reserva do cartão (cancela, não estorna)", async () => {
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
    vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 444, status: "authorized" } as any);
    const cancelSpy = vi.spyOn(Payment.prototype, "cancel").mockResolvedValue({} as any);
    const refundSpy = vi.spyOn(PaymentRefund.prototype, "create");

    const request = await makeRespondedRequest();
    const { contract } = await consultancyService.decideRequest(clientId, request.id, {
      decision: "ACCEPT",
      paymentMethod: "CREDIT_CARD" as any,
      acknowledgedImmediateExecution: true
    });

    // Força o prazo pra "já vencido"
    await prisma.consultancyContract.update({
      where: { id: contract!.id },
      data: { deliveryDeadlineAt: new Date(Date.now() - 60 * 60 * 1000) }
    });

    await consultancyService.autoRefundExpiredContracts(new Date());

    expect(cancelSpy).toHaveBeenCalledWith({
      id: "444",
      requestOptions: { idempotencyKey: `consultancy:${contract!.id}:cancel` }
    });
    expect(refundSpy).not.toHaveBeenCalled();

    const afterExpiry = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract!.id } });
    expect(afterExpiry.paymentStatus).toBe("CANCELED");
    expect(afterExpiry.status).toBe("REFUNDED_EXPIRED");
    expect(afterExpiry.paymentCanceledAt).not.toBeNull();
  });

  it("aluno cancela antes da entrega: libera a reserva do cartão (cancela, não estorna)", async () => {
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
    vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 555, status: "authorized" } as any);
    const cancelSpy = vi.spyOn(Payment.prototype, "cancel").mockResolvedValue({} as any);
    const refundSpy = vi.spyOn(PaymentRefund.prototype, "create");

    const request = await makeRespondedRequest();
    const { contract } = await consultancyService.decideRequest(clientId, request.id, {
      decision: "ACCEPT",
      paymentMethod: "CREDIT_CARD" as any,
      acknowledgedImmediateExecution: true
    });

    const cancelled = await consultancyService.cancelContract(clientId, contract!.id);

    expect(cancelSpy).toHaveBeenCalledWith({
      id: "555",
      requestOptions: { idempotencyKey: `consultancy:${contract!.id}:cancel` }
    });
    expect(refundSpy).not.toHaveBeenCalled();
    expect(cancelled.paymentStatus).toBe("CANCELED");
    expect(cancelled.status).toBe("CANCELLED");
  });
});
