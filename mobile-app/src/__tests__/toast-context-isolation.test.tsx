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

// Frente 12 (segunda camada), Lote 10: antes esperava um número fixo de
// `await Promise.resolve()` pra deixar o bootstrap "assentar" — frágil,
// já que um hop a mais na cadeia de promises do bootstrap (ex: mais um
// await na checagem de AsyncStorage/SecureStore) faria esse teste contar
// um render de startup como se fosse causado pelo showToast, e falhar por
// motivo errado. Espera até renderCount parar de mudar por um período,
// baseado em estado observável em vez de profundidade exata de microtask.
async function waitForRenderCountToStabilize() {
  let lastSeen = -1;
  await waitFor(() => {
    if (renderCount === lastSeen) return;
    lastSeen = renderCount;
    throw new Error("renderCount ainda mudando");
  });
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
    await waitForRenderCountToStabilize();
    const countAfterMount = renderCount;

    act(() => {
      lastShowToast?.("qualquer mensagem");
    });
    await waitForRenderCountToStabilize();

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
