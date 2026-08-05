import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { ReconsentGateScreen } from "../screens/shared/ReconsentGateScreen";
import { userApi } from "../services/api/client";
import { useAppState } from "../state/AppState";

// Épico de Frentes, Frente 11, Lote 2: POST /me/consent nunca era chamado
// pelo app - gate bloqueante novo precisa realmente chamar o endpoint e
// sincronizar o usuário (pra limpar needsReconsent) ao aceitar, e oferecer
// saída pra quem não quer aceitar.
jest.mock("../state/AppState", () => ({
  useAppState: jest.fn()
}));

jest.mock("../services/api/client", () => {
  const actual = jest.requireActual("../services/api/client");
  return {
    ...actual,
    userApi: { ...actual.userApi, recordConsent: jest.fn() }
  };
});

describe("ReconsentGateScreen", () => {
  it("aceitar os termos chama recordConsent e sincroniza o usuário", async () => {
    const runWithAuth = jest.fn((operation: (token: string) => Promise<unknown>) => operation("token-123"));
    const syncCurrentUser = jest.fn().mockResolvedValue(null);
    const signOut = jest.fn();
    const showToast = jest.fn();
    (userApi.recordConsent as jest.Mock).mockResolvedValue({
      id: "consent-1",
      termsAcceptedAt: new Date().toISOString(),
      privacyPolicyAcceptedAt: new Date().toISOString(),
      termsVersion: "2026.05"
    });

    (useAppState as jest.Mock).mockReturnValue({
      runWithAuth,
      syncCurrentUser,
      signOut,
      showToast
    });

    const { getByRole } = render(<ReconsentGateScreen />);
    fireEvent.press(getByRole("button", { name: "Aceitar e continuar" }));

    await waitFor(() => expect(userApi.recordConsent).toHaveBeenCalledWith("token-123"));
    expect(syncCurrentUser).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("sair da conta chama signOut sem chamar recordConsent", async () => {
    const runWithAuth = jest.fn();
    const syncCurrentUser = jest.fn();
    const signOut = jest.fn();
    const showToast = jest.fn();

    (useAppState as jest.Mock).mockReturnValue({
      runWithAuth,
      syncCurrentUser,
      signOut,
      showToast
    });

    const { getByRole } = render(<ReconsentGateScreen />);
    fireEvent.press(getByRole("button", { name: "Sair da conta" }));

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(runWithAuth).not.toHaveBeenCalled();
  });

  it("erro ao aceitar exibe toast e não trava em loading", async () => {
    const runWithAuth = jest.fn((operation: (token: string) => Promise<unknown>) => operation("token-123"));
    const syncCurrentUser = jest.fn();
    const signOut = jest.fn();
    const showToast = jest.fn();
    (userApi.recordConsent as jest.Mock).mockRejectedValue(new Error("falhou"));

    (useAppState as jest.Mock).mockReturnValue({
      runWithAuth,
      syncCurrentUser,
      signOut,
      showToast
    });

    const { getByRole } = render(<ReconsentGateScreen />);
    fireEvent.press(getByRole("button", { name: "Aceitar e continuar" }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("Não foi possível registrar seu aceite. Tente novamente.", "error")
    );
    expect(syncCurrentUser).not.toHaveBeenCalled();
  });
});
