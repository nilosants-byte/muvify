import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { CustomerCard } from "mercadopago";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { PaymentService } from "../src/modules/payments/services/payment.service";
import { AppError } from "../src/shared/errors/app-error";

// Achado em teste manual (2026-09-27): salvar um cartão de teste inválido
// (na tela "Seu cartão", tanto do profissional quanto do cliente) mostrava
// um erro cru em inglês, "Payment method response is empty" - a mensagem de
// erro exata que a API da Mercado Pago devolve quando o token do cartão não
// corresponde a nenhum método de pagamento válido. O SDK da MP lança direto
// o corpo JSON de erro da API (nunca uma instância de Error) e esse objeto
// tem um `status` numérico (400) que fazia o middleware de erro genérico
// devolver `error.message` sem tradução nenhuma.

const paymentService = new PaymentService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientUserId = "";

describe("Tradução de erro da Mercado Pago ao salvar cartão", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const client = await prisma.user.create({
      data: {
        name: "Cliente Teste Erro Cartao MP",
        email: `${uid("mp_card_err_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}3`,
        role: UserRole.CLIENT,
        mpCustomerId: "cus_test_already_set"
      }
    });
    clientUserId = client.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: clientUserId } });
    await prisma.$disconnect();
  });

  it("confirmCustomerSetupIntent traduz 'Payment method response is empty' (mensagem direta) pro usuário, em vez de repassar o erro cru da MP", async () => {
    vi.spyOn(CustomerCard.prototype, "create").mockRejectedValue({
      status: 400,
      message: "Payment method response is empty",
      error: "bad_request"
    });

    await expect(
      paymentService.confirmCustomerSetupIntent(clientUserId, undefined, { cardToken: "tok_test_invalid" })
    ).rejects.toMatchObject({
      message: "Não foi possível validar este cartão. Confira os dados e tente novamente, ou use outro cartão.",
      statusCode: 400
    });
  });

  it("confirmCustomerSetupIntent também traduz quando o texto vem em cause[0].description (formato real da API da MP)", async () => {
    vi.spyOn(CustomerCard.prototype, "create").mockRejectedValue({
      status: 400,
      message: "bad request",
      cause: [{ code: 2062, description: "Invalid card number" }]
    });

    await expect(
      paymentService.confirmCustomerSetupIntent(clientUserId, undefined, { cardToken: "tok_test_invalid" })
    ).rejects.toMatchObject({
      message: "Número do cartão inválido.",
      statusCode: 400
    });
  });

  it("confirmCustomerSetupIntent cai numa mensagem genérica em português pra um erro da MP não mapeado, nunca no texto cru", async () => {
    vi.spyOn(CustomerCard.prototype, "create").mockRejectedValue({
      status: 400,
      message: "some brand-new mercadopago error we've never seen"
    });

    await expect(
      paymentService.confirmCustomerSetupIntent(clientUserId, undefined, { cardToken: "tok_test_invalid" })
    ).rejects.toMatchObject({
      message: "Não foi possível salvar o cartão. Verifique os dados e tente novamente.",
      statusCode: 400
    });
  });

  it("setupCustomerPaymentMethod (mesmo caminho usado por outra rota legada) também traduz o erro da MP", async () => {
    vi.spyOn(CustomerCard.prototype, "create").mockRejectedValue({
      status: 400,
      message: "Payment method response is empty"
    });

    await expect(
      paymentService.setupCustomerPaymentMethod(clientUserId, "tok_test_invalid")
    ).rejects.toMatchObject({
      message: "Não foi possível validar este cartão. Confira os dados e tente novamente, ou use outro cartão.",
      statusCode: 400
    });
  });

  it("erro traduzido é sempre uma instância de AppError (nunca o objeto cru da MP propagando por engano)", async () => {
    vi.spyOn(CustomerCard.prototype, "create").mockRejectedValue({
      status: 400,
      message: "Payment method response is empty"
    });

    try {
      await paymentService.confirmCustomerSetupIntent(clientUserId, undefined, { cardToken: "tok_test_invalid" });
      expect.unreachable("deveria ter lançado erro");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
    }
  });
});
