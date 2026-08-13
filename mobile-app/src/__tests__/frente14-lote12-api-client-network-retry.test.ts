import { apiRequest, ApiError } from "../services/api/client";

// Frente 14 (segunda camada, carga real), Lote 12: apiRequest tinha uma
// única tentativa de fetch — qualquer soluço transitório de rede (troca
// wifi→4G, elevador, sinal fraco) ia direto pra tela sem nenhuma tentativa
// de recuperação automática. Só GET passou a ser retentado (naturalmente
// idempotente); POST/PUT/PATCH/DELETE continuam com tentativa única, pra
// não arriscar duplicar uma operação que já chegou no servidor.

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  } as unknown as Response;
}

describe("Frente 14, Lote 12 — apiRequest retenta falha transitória de rede só em GET", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("GET: falha de rede nas 2 primeiras tentativas, sucesso na 3ª — retorna o payload normalmente", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await apiRequest<{ ok: boolean }>("/health");

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("GET: falha de rede em TODAS as tentativas — propaga ApiError(status 0) depois de esgotar os retries", async () => {
    fetchMock.mockRejectedValue(new TypeError("Network request failed"));

    await expect(apiRequest("/health")).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 tentativa inicial + 2 retries
  });

  it("GET bem-sucedido de primeira não sofre nenhum retry desnecessário", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await apiRequest("/health");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("POST: falha de rede NÃO é retentada — uma única tentativa, pra não arriscar duplicar a operação", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Network request failed"));

    await expect(
      apiRequest("/bookings", { method: "POST", body: { providerId: "x" } })
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
