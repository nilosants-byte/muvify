import React from "react";
import { act, render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { AppStateProvider, useAppState } from "../state/AppState";
import { ToastProvider, useToast } from "../state/ToastState";

// Frente 11 (engenharia mobile), Lote 4: showToast é chamado em 380+ pontos
// do app. Antes, toast vivia dentro do mesmo valor memoizado do
// AppStateContext (junto com user/role/runWithAuth/etc) — qualquer toast
// trocava a identidade desse valor único e re-renderizava todo mundo que
// consome useAppState(), mesmo quem nunca lê toast. Este teste é a rede de
// segurança contra essa regressão voltar.

jest.mock("../services/notifications/push", () => ({
  getPushRegistrationPayload: jest.fn().mockResolvedValue(null)
}));

let renderCount = 0;
let lastShowToast: ((message: string) => void) | null = null;

function AppStateConsumerProbe() {
  const { bootstrapping, showToast } = useAppState();
  renderCount += 1;
  lastShowToast = showToast;
  return bootstrapping ? null : null;
}

describe("Frente 11, Lote 4 — toast isolado do AppStateContext", () => {
  beforeEach(() => {
    renderCount = 0;
    lastShowToast = null;
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it("showToast não re-renderiza consumidores de useAppState() que não leem toast", async () => {
    render(
      <ToastProvider>
        <AppStateProvider>
          <AppStateConsumerProbe />
        </AppStateProvider>
      </ToastProvider>
    );

    await waitFor(() => expect(lastShowToast).not.toBeNull());
    // Deixa a bootstrapping (checagem de AsyncStorage/SecureStore) assentar
    // de vez antes de medir a linha de base — senão o próprio startup conta
    // como "re-render", mascarando o que queremos medir.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const countAfterMount = renderCount;

    act(() => {
      lastShowToast?.("qualquer mensagem");
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(renderCount).toBe(countAfterMount);
  });

  it("useToast() sozinho atualiza e limpa o payload normalmente", () => {
    let toastValue = {} as ReturnType<typeof useToast>;
    function Probe() {
      toastValue = useToast();
      return null;
    }
    render(
      <ToastProvider>
        <Probe />
      </ToastProvider>
    );

    expect(toastValue.toast).toBeNull();

    act(() => {
      toastValue.showToast("oi", "success");
    });
    expect(toastValue.toast?.message).toBe("oi");
    expect(toastValue.toast?.type).toBe("success");

    act(() => {
      toastValue.clearToast();
    });
    expect(toastValue.toast).toBeNull();
  });

  it("useToast() fora de um ToastProvider lança erro explícito", () => {
    function BareProbe() {
      useToast();
      return null;
    }
    const originalConsoleError = console.error;
    console.error = jest.fn();
    expect(() => render(<BareProbe />)).toThrow("useToast must be used inside ToastProvider.");
    console.error = originalConsoleError;
  });
});
