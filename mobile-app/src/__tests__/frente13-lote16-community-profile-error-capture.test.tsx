/**
 * Frente 13 (segunda camada), Lote 16: comunidade e perfil tinham dezenas
 * de pontos de falha (curtir, comentar, seguir, editar perfil, etc.) só com
 * toast ou 100% silenciosos, sem nenhuma captura no Sentry.
 *
 * Escopo deste arquivo: cobertura direta do padrão mais estrutural do
 * lote — o Promise.all de ClientProfileScreen, onde 6 chamadas de API
 * engoliam a própria falha em silêncio total — e um ponto direto de ação
 * do usuário (salvar nome). CommunityScreen.tsx recebeu o mesmo padrão
 * mecânico de captureException em ~13 pontos, mas não tem harness de teste
 * pré-existente no repo e é grande/complexo demais (1400+ linhas, depende
 * de feed/gamificação/ranking simultâneos) pra montar um do zero só pra
 * esta frente — validado via typecheck + revisão manual de consistência
 * com o mesmo padrão já testado aqui e nos Lotes 10-15.
 */
import React from "react";
import { act, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientProfileScreen } from "../screens/client/ClientProfileScreen";
import { bookingsApi } from "../services/api/client";
import { useAppState } from "../state/AppState";
import { captureException } from "../observability/sentry";

jest.mock("../state/AppState", () => ({
  useAppState: jest.fn()
}));

jest.mock("../observability/sentry", () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  setSentryUser: jest.fn(),
  addNavigationBreadcrumb: jest.fn()
}));

jest.mock("@react-navigation/native", () => {
  const ReactActual = require("react");
  const actual = jest.requireActual("@react-navigation/native");
  return {
    ...actual,
    useFocusEffect: (cb: React.EffectCallback) => { ReactActual.useEffect(cb, []); },
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() })
  };
});

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("Frente 13, Lote 16 — captura de erro no perfil do cliente", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("falha de uma das 6 chamadas do Promise.all do perfil chama captureException com a action certa, sem quebrar a tela", async () => {
    jest.spyOn(bookingsApi, "me").mockRejectedValueOnce(new Error("falha ao buscar agendamentos"));

    const runWithAuth = jest.fn((fn: (token: string) => Promise<unknown>) => fn("test-token"));
    (useAppState as jest.Mock).mockReturnValue({
      showToast: jest.fn(),
      runWithAuth,
      user: { id: "u1", name: "Fallback", email: "fallback@email.com", role: "CLIENT" }
    });

    const navigation = { getParent: () => ({ navigate: jest.fn() }) };
    const ui = renderWithQueryClient(
      <ClientProfileScreen navigation={navigation as any} route={{} as any} />
    );

    // A tela continua funcionando normalmente mesmo com uma das 6 chamadas falhando.
    expect(await ui.findByText("Fallback")).toBeTruthy();

    await waitFor(() =>
      expect(captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ screen: "ClientProfileScreen", action: "bookingsApi.me" })
      )
    );
  });
});
