/**
 * Frente 15 (segunda camada, acessibilidade), Lote 8: excluir horário de
 * disponibilidade era um TouchableOpacity só-ícone (trash-outline) sem
 * accessibilityLabel — ação destrutiva e irreversível anunciada só como
 * "botão" pro leitor de tela.
 */
import React from "react";
import { render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AvailabilityManagerScreen } from "../screens/professional/AvailabilityManagerScreen";
import { availabilityApi } from "../services/api/client";
import { useAppState } from "../state/AppState";

jest.mock("../state/AppState", () => ({
  useAppState: jest.fn()
}));

jest.mock("@react-navigation/native", () => {
  const React = require("react");
  const actual = jest.requireActual("@react-navigation/native");
  return {
    ...actual,
    useFocusEffect: (cb: React.EffectCallback) => { React.useEffect(cb, []); },
  };
});

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("Frente 15, Lote 8 — excluir horário de disponibilidade expõe accessibilityLabel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAppState as jest.Mock).mockReturnValue({
      runWithAuth: jest.fn(async (op: (token: string) => Promise<unknown>) => op("token-test")),
      showToast: jest.fn(),
      user: { id: "provider-1", role: "PROVIDER" }
    });
  });

  it("botão de excluir horário tem accessibilityLabel descrevendo qual horário", async () => {
    jest.spyOn(availabilityApi, "me").mockResolvedValue([
      { id: "slot-1", weekday: 1, startTime: "08:00", endTime: "18:00", isActive: true }
    ] as any);

    const navigation = { goBack: jest.fn(), navigate: jest.fn(), addListener: jest.fn(() => () => {}) };
    const { getByLabelText } = renderWithQueryClient(
      <AvailabilityManagerScreen navigation={navigation as any} route={{} as any} />
    );

    await waitFor(() => expect(getByLabelText("Excluir horário 08:00 às 18:00")).toBeTruthy());
  });
});
