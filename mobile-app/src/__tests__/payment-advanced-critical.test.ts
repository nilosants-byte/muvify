/**
 * Testes críticos de fluxo de pagamento avançado.
 *
 * Cobre:
 * - Criação de cobrança PIX
 * - Status de pagamento em diferentes estados
 * - Configuração de setup intent (cartão)
 * - Cartão já configurado vs pendente
 * - Seleção de método de pagamento no booking
 * - Tratamento de falha de cartão recusado
 * - Rate limit (429) em endpoints de pagamento
 * - Serviço indisponível (503)
 */
import { ApiError, paymentsApi, PaymentStatusResponse, PixChargeResponse } from "../services/api/client";

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function jsonResponse(data: unknown, status = 200, headers?: Record<string, string>) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (key: string) => {
        if (key === "content-type") return "application/json";
        return headers?.[key] ?? null;
      },
    },
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response);
}

function buildPaymentStatus(
  status: PaymentStatusResponse["status"] = "AUTHORIZED"
): PaymentStatusResponse {
  return {
    id: "pay-001",
    method: "PIX",
    status,
    amountCents: 10000,
    currency: "BRL",
    bookingId: "booking-001",
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  global.fetch = mockFetch as unknown as typeof fetch;
});

describe("PIX — criação de cobrança", () => {
  const TOKEN = "user-token-pix";

  it("cria cobrança PIX e retorna QR code", async () => {
    const pixResponse: PixChargeResponse = {
      paymentId: "pix-pay-001",
      bookingId: "booking-001",
      method: "PIX",
      status: "AUTHORIZING",
      amountCents: 10000,
      pix: {
        qrCodeUrl: "https://pix.mercadopago.com/qr/abc123",
        copyAndPasteCode: "00020126330014BR.GOV.BCB.PIX...",
        hostedInstructionsUrl: "https://mp.com/pix/instruction",
        expiresAt: "2026-04-01T12:00:00Z",
      },
    };
    mockFetch.mockReturnValueOnce(jsonResponse(pixResponse, 201));

    const result = await paymentsApi.createPixCharge(TOKEN, "booking-001");
    expect(result.pix?.copyAndPasteCode).toContain("00020126");
    expect(result.pix?.qrCodeUrl).toBeTruthy();
    expect(result.status).toBe("AUTHORIZING");
    expect(result.amountCents).toBe(10000);
  });

  it("rejeita tentativa de PIX duplicado (409)", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ message: "Cobrança PIX já existe para este agendamento." }, 409)
    );

    await expect(paymentsApi.createPixCharge(TOKEN, "booking-pix-exists")).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe("Status de pagamento — todos os estados", () => {
  const TOKEN = "user-token-pay";

  it.each([
    ["PENDING_AUTH", "pré-autorização pendente"],
    ["AUTHORIZED", "pré-autorizado"],
    ["CAPTURED", "capturado"],
    ["CANCELED", "cancelado"],
    ["FAILED", "falha"],
    ["REFUNDED", "estornado"],
  ] as const)("retorna status %s corretamente", async (status, _label) => {
    mockFetch.mockReturnValueOnce(jsonResponse(buildPaymentStatus(status)));

    const result = await paymentsApi.bookingPayment(TOKEN, "booking-001");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(status);
    expect(result!.bookingId).toBe("booking-001");
  });

  it("retorna failureReason quando pagamento falha", async () => {
    const failedPayment: PaymentStatusResponse = {
      ...buildPaymentStatus("FAILED"),
      failureReason: "Cartão sem limite disponível",
    };
    mockFetch.mockReturnValueOnce(jsonResponse(failedPayment));

    const result = await paymentsApi.bookingPayment(TOKEN, "booking-001");
    expect(result).not.toBeNull();
    expect(result!.status).toBe("FAILED");
    expect(result!.failureReason).toBe("Cartão sem limite disponível");
  });
});

describe("Setup Intent — configuração de cartão", () => {
  const TOKEN = "user-token-setup";

  it("cria setup intent para primeiro cartão", async () => {
    const setupResponse = {
      setupIntentId: "seti_abc123",
      setupIntentClientSecret: "seti_secret_abc",
      customerId: "cus_xyz789",
      ephemeralKeySecret: "ek_test_secret",
    };
    mockFetch.mockReturnValueOnce(jsonResponse(setupResponse, 201));

    const result = await paymentsApi.createCustomerSetupIntent(TOKEN);
    expect(result.setupIntentId).toBe("seti_abc123");
    expect(result.customerId).toBe("cus_xyz789");
  });

  it("confirma setup intent após tokenização do cartão", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(undefined, 204));

    await expect(
      paymentsApi.confirmCustomerSetupIntent(TOKEN, "seti_abc123")
    ).resolves.toBeUndefined();

    const [, options] = mockFetch.mock.calls[0];
    expect(JSON.parse(options.body).setupIntentId).toBe("seti_abc123");
  });

  it("falha na confirmação quando setup intent expirou (400)", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ message: "Setup intent inválido ou expirado." }, 400)
    );

    await expect(
      paymentsApi.confirmCustomerSetupIntent(TOKEN, "seti_expired")
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("Status do cliente de pagamento", () => {
  const TOKEN = "user-token-status";

  it("retorna hasDefaultPaymentMethod=false para cliente novo", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ configured: false, hasCustomer: false, hasDefaultPaymentMethod: false })
    );

    const result = await paymentsApi.customerStatus(TOKEN);
    expect(result.configured).toBe(false);
    expect(result.hasDefaultPaymentMethod).toBe(false);
  });

  it("retorna hasDefaultPaymentMethod=true após configurar cartão", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ configured: true, hasCustomer: true, hasDefaultPaymentMethod: true })
    );

    const result = await paymentsApi.customerStatus(TOKEN);
    expect(result.configured).toBe(true);
    expect(result.hasDefaultPaymentMethod).toBe(true);
  });
});

describe("Seleção de método de pagamento no booking", () => {
  const TOKEN = "user-token-method";

  it("seleciona PIX como método de pagamento", async () => {
    const updated: PaymentStatusResponse = {
      ...buildPaymentStatus("PENDING_AUTH"),
      method: "PIX",
    };
    mockFetch.mockReturnValueOnce(jsonResponse(updated));

    const result = await paymentsApi.selectBookingPaymentMethod(TOKEN, "booking-001", {
      method: "PIX",
    });
    expect(result.method).toBe("PIX");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.method).toBe("PIX");
  });

  it("seleciona cartão de crédito como método de pagamento", async () => {
    const updated: PaymentStatusResponse = {
      ...buildPaymentStatus("PENDING_AUTH"),
      method: "CREDIT_CARD",
    };
    mockFetch.mockReturnValueOnce(jsonResponse(updated));

    const result = await paymentsApi.selectBookingPaymentMethod(TOKEN, "booking-001", {
      method: "CARD",
    });
    expect(result.method).toBe("CREDIT_CARD");
  });
});

describe("Cenários de erro de pagamento", () => {
  const TOKEN = "user-token-errors";

  it("rate limit (429) retorna mensagem com tempo de espera", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ message: "Rate limit exceeded" }, 429, { "Retry-After": "30" })
    );

    try {
      await paymentsApi.createPixCharge(TOKEN, "booking-429");
      fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).message).toMatch(/Aguarde 30s/);
      expect((err as ApiError).status).toBe(429);
    }
  });

  it("serviço indisponível (503) retorna mensagem amigável", async () => {
    // Sem body message → cliente usa fallback em português
    mockFetch.mockReturnValueOnce(jsonResponse(null, 503));

    try {
      await paymentsApi.bookingPayment(TOKEN, "booking-503");
      fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(503);
      expect((err as ApiError).message).toMatch(/indisponível/i);
    }
  });

  it("cartão recusado (422) retorna mensagem específica do backend", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ message: "Cartão sem limite disponível para pré-autorização." }, 422)
    );

    try {
      await paymentsApi.confirmCustomerSetupIntent(TOKEN, "seti_declined");
      fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(422);
      expect((err as ApiError).message).toContain("Cartão sem limite");
    }
  });

  it("booking não encontrado (404) ao consultar pagamento", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ message: "Recurso não encontrado." }, 404)
    );

    await expect(paymentsApi.bookingPayment(TOKEN, "booking-nao-existe")).rejects.toMatchObject({
      status: 404,
    });
  });
});
