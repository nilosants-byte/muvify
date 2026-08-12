import React from "react";
import { Alert } from "react-native";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConsultancyRequestScreen } from "../screens/client/ConsultancyRequestScreen";
import { consultancyApi, ProviderConsultancyCatalog } from "../services/api/client";
import { useAppState } from "../state/AppState";

// Frente 11 (engenharia mobile), Lote 9: sair da tela sem confirmar
// descartava as respostas do briefing (trainingNeedText/limitationText/
// extraInfoText) sem aviso — mesmo padrão de risco já corrigido em telas
// irmãs (ClientAnamnesisScreen, ProfessionalTrainingCreationScreen...).

jest.mock("../state/AppState", () => ({
  useAppState: jest.fn()
}));

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function buildCatalog(): ProviderConsultancyCatalog {
  return {
    provider: { id: "provider-1", displayName: "Coach A", photoUrl: null, specialties: [] },
    onlineConsultancyEnabled: true,
    offers: [
      {
        id: "offer-1",
        providerId: "provider-1",
        kind: "ONLINE_CONSULTANCY",
        title: "Consultoria mensal",
        billingCycle: "MONTHLY",
        priceCents: 20000,
        basePriceUpdatedAt: "2026-01-01T00:00:00.000Z",
        isPromotion: false,
        isActive: true
      } as any
    ],
    prebuiltPlanPreviews: []
  };
}

describe("Frente 11, Lote 9 — ConsultancyRequestScreen guarda saída sem enviar", () => {
  let addListenerCallback: ((e: { preventDefault: () => void; data: { action: unknown } }) => void) | null;

  beforeEach(() => {
    addListenerCallback = null;
    (useAppState as jest.Mock).mockReturnValue({
      runWithAuth: jest.fn(async (operation: (token: string) => Promise<unknown>) => operation("token-test")),
      showToast: jest.fn()
    });
    jest.spyOn(consultancyApi, "providerCatalog").mockResolvedValue(buildCatalog());
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function buildNavigation() {
    const navigation = {
      goBack: jest.fn(),
      dispatch: jest.fn(),
      addListener: jest.fn((event: string, cb: typeof addListenerCallback) => {
        if (event === "beforeRemove") addListenerCallback = cb;
        return () => {};
      })
    };
    return navigation;
  }

  it("sem texto preenchido: sair não dispara confirmação nenhuma", async () => {
    const navigation = buildNavigation();
    const ui = renderWithQueryClient(
      <ConsultancyRequestScreen
        navigation={navigation as any}
        route={{ params: { professionalId: "provider-1" } } as any}
      />
    );
    await waitFor(() => expect(consultancyApi.providerCatalog).toHaveBeenCalled());
    await waitFor(() => expect(addListenerCallback).not.toBeNull());

    const preventDefault = jest.fn();
    addListenerCallback?.({ preventDefault, data: { action: "GO_BACK" } });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("com texto preenchido no briefing: sair pede confirmação antes de descartar", async () => {
    const navigation = buildNavigation();
    const ui = renderWithQueryClient(
      <ConsultancyRequestScreen
        navigation={navigation as any}
        route={{ params: { professionalId: "provider-1" } } as any}
      />
    );
    await waitFor(() => expect(consultancyApi.providerCatalog).toHaveBeenCalled());
    await waitFor(() => expect(ui.getByText("Qual tipo de treino você precisa?")).toBeTruthy());

    fireEvent.press(ui.getByText("Qual tipo de treino você precisa?"));
    fireEvent.changeText(ui.getByPlaceholderText("Até 300 caracteres"), "Hipertrofia e força");

    await waitFor(() => expect(addListenerCallback).not.toBeNull());
    const preventDefault = jest.fn();
    addListenerCallback?.({ preventDefault, data: { action: "GO_BACK" } });

    expect(preventDefault).toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      "Sair sem enviar?",
      expect.any(String),
      expect.any(Array)
    );
    ui.unmount();
  });
});
