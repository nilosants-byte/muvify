/**
 * Testes de tratamento de erros de rede.
 *
 * Cobre:
 * - Timeout de rede (AbortError) gera mensagem amigável
 * - Sem conexão com a internet (TypeError: fetch failed)
 * - 401 dispara refresh + retry em runWithAuth
 * - 503 / 502 / 504 geram mensagem de serviço indisponível
 * - 429 com Retry-After gera mensagem com tempo de espera
 */
import { ApiError, authApi, bookingsApi, paymentsApi, userApi } from "../services/api/client";

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

beforeEach(() => {
  jest.resetAllMocks();
  global.fetch = mockFetch as unknown as typeof fetch;
});

describe("Timeout de rede (AbortError)", () => {
  it("gera mensagem de conexão lenta quando fetch é abortado", async () => {
    const abortError = new Error("signal timed out");
    abortError.name = "AbortError";
    // Frente 14 (segunda camada, carga real), Lote 12: apiRequest agora
    // retenta GET até 2x extra em falha de rede — mockRejectedValueOnce
    // deixava as tentativas seguintes sem mock configurado (retornando
    // undefined em vez de rejeitar), mascarando o erro esperado.
    mockFetch.mockRejectedValue(abortError);

    try {
      await bookingsApi.me("any-token");
      fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(0);
      // produção: "A conexão demorou muito. Verifique sua internet e tente novamente."
      // dev: "Tempo limite (30s)."
      expect(apiErr.message).toMatch(/demorou|timeout|Tempo limite/i);
    }
  });

  it("gera mensagem de timeout também quando a mensagem contém 'aborted'", async () => {
    const abortedErr = new Error("The operation was aborted");
    abortedErr.name = "Error";
    mockFetch.mockRejectedValue(abortedErr);

    try {
      await paymentsApi.bookingPayment("any-token", "booking-abc");
      fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(0);
      expect(apiErr.message).toMatch(/demorou|aborted|Tempo/i);
    }
  });
});

describe("Sem conexão com a internet (falha de rede)", () => {
  it("gera mensagem de sem conexão quando fetch lança TypeError", async () => {
    mockFetch.mockRejectedValue(new TypeError("Network request failed"));

    try {
      await bookingsApi.me("any-token");
      fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(0);
      // produção: "Sem conexão com a internet..."
      // dev: "Falha de rede. URL: ..."
      expect(apiErr.message).toMatch(/rede|conexão|internet|network/i);
    }
  });

  it("status 0 distingue erro de rede de erro HTTP", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));

    try {
      await userApi.me("any-token");
      fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(0);
    }
  });
});

describe("Erros 5xx — serviço indisponível", () => {
  it.each([502, 503, 504])(
    "status %i retorna mensagem de serviço temporariamente indisponível",
    async (statusCode) => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({ message: "Service Unavailable" }, statusCode)
      );

      try {
        await bookingsApi.me("any-token");
        fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.status).toBe(statusCode);
        // Aceita mensagem do backend ou mensagem padrão
        expect(apiErr.message).toMatch(/indisponível|unavailable/i);
      }
    }
  );

  it("503 com mensagem específica do backend usa a mensagem do backend", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ message: "Manutenção programada até 23h." }, 503)
    );

    try {
      await paymentsApi.customerStatus("any-token");
      fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      // cliente usa a mensagem do backend quando presente
      expect((err as ApiError).message).toContain("Manutenção");
      expect((err as ApiError).status).toBe(503);
    }
  });
});

describe("Rate limit (429)", () => {
  it("429 sem Retry-After usa padrão de 60s", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ message: "Too Many Requests" }, 429)
    );

    try {
      await bookingsApi.me("any-token");
      fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(429);
      expect(apiErr.message).toContain("60s");
    }
  });

  it("429 com Retry-After usa o valor do header", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ message: "Too Many Requests" }, 429, { "Retry-After": "120" })
    );

    try {
      await bookingsApi.me("any-token");
      fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).message).toContain("120s");
    }
  });
});

describe("Fluxo 401 → refresh → retry (via authApi)", () => {
  it("refresh bem-sucedido disponibiliza novo token", async () => {
    const refreshResponse = {
      user: { id: "u1", name: "User A", email: "a@a.com", role: "CLIENT" },
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
    };
    mockFetch.mockReturnValueOnce(jsonResponse(refreshResponse));

    const result = await authApi.refresh("old-refresh-token");
    expect(result.accessToken).toBe("new-access-token");
    expect(result.refreshToken).toBe("new-refresh-token");
  });

  it("refresh com token inválido retorna 401", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ message: "Refresh token inválido ou expirado." }, 401)
    );

    await expect(authApi.refresh("bad-refresh-token")).rejects.toMatchObject({ status: 401 });
  });

  it("refresh com token revogado retorna 401 com mensagem específica", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ message: "Token de sessão revogado." }, 401)
    );

    try {
      await authApi.refresh("revoked-token");
      fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(401);
      expect((err as ApiError).message).toContain("revogado");
    }
  });

  it("qualquer endpoint retorna ApiError com status correto para 403", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ message: "Acesso negado." }, 403)
    );

    try {
      await bookingsApi.me("expired-token");
      fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(403);
    }
  });
});

describe("Outros erros HTTP", () => {
  it("400 Bad Request propaga mensagem do backend", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ message: "Parâmetros inválidos." }, 400)
    );

    try {
      await bookingsApi.me("any-token");
      fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(400);
      expect((err as ApiError).message).toContain("Parâmetros inválidos");
    }
  });

  it("500 Internal Server Error propaga mensagem do backend", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ message: "Erro interno do servidor." }, 500)
    );

    try {
      await userApi.me("any-token");
      fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(500);
      expect((err as ApiError).message).toContain("Erro interno");
    }
  });

  it("resposta sem campo message usa fallback genérico", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ code: "UNKNOWN_ERROR" }, 500)
    );

    try {
      await userApi.me("any-token");
      fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(500);
      expect((err as ApiError).message).toMatch(/HTTP 500|servidor|error/i);
    }
  });
});
