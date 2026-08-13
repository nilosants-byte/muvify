/**
 * Frente 13 (segunda camada), Lote 17: erro de status da API do Google
 * Places (chave revogada, billing cortado) só era logado em __DEV__ — em
 * produção, se a chave quebrar, a busca de endereço some pra todos os
 * usuários sem nenhum sinal.
 */
import "./_setup-google-places-key";
import { renderHook, waitFor } from "@testing-library/react-native";
import { fetchGooglePlaceCoords, useGooglePlacesSearch } from "../hooks/useGooglePlacesSearch";
import { captureException, captureMessage } from "../observability/sentry";

jest.mock("../observability/sentry", () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  setSentryUser: jest.fn(),
  addNavigationBreadcrumb: jest.fn()
}));

describe("Frente 13, Lote 17 — captura de erro na busca do Google Places", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it("fetchGooglePlaceCoords: status de erro (REQUEST_DENIED) chama captureMessage", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ status: "REQUEST_DENIED" })
    }) as any;

    const result = await fetchGooglePlaceCoords("place-123");

    expect(result).toBeNull();
    expect(captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("REQUEST_DENIED"),
      "warning"
    );
  });

  it("fetchGooglePlaceCoords: exceção de rede chama captureException", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("falha de rede")) as any;

    const result = await fetchGooglePlaceCoords("place-456");

    expect(result).toBeNull();
    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ stage: "google_places_details" })
    );
  });

  it("useGooglePlacesSearch: status de erro (INVALID_REQUEST) do autocomplete chama captureMessage e marca hasError", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ status: "INVALID_REQUEST" })
    }) as any;

    const { result } = renderHook(() =>
      useGooglePlacesSearch("academia", -23.5, -46.6, 10, true)
    );

    await waitFor(() => expect(result.current.hasError).toBe(true), { timeout: 3000 });

    expect(captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("INVALID_REQUEST"),
      "warning"
    );
  });
});
