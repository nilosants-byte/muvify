import { renderHook } from "@testing-library/react-native";
import { useFocusEffectSkippingFirst } from "../hooks/useFocusEffectSkippingFirst";

// Frente 11 (engenharia mobile), Lote 6: useAuthQuery já busca sozinho ao
// montar — useFocusEffect(refetch) rodando nesse mesmo mount duplicava a
// chamada de API na primeira abertura da tela. Este hook pula só essa
// primeira chamada.

let capturedFocusCallback: (() => void | (() => void)) | null = null;

jest.mock("@react-navigation/native", () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    capturedFocusCallback = cb;
  }
}));

describe("Frente 11, Lote 6 — useFocusEffectSkippingFirst", () => {
  beforeEach(() => {
    capturedFocusCallback = null;
  });

  it("primeiro foco (mount inicial): NÃO executa o callback — useAuthQuery já buscou sozinho", () => {
    const callback = jest.fn();
    renderHook(() => useFocusEffectSkippingFirst(callback));

    capturedFocusCallback?.();

    expect(callback).not.toHaveBeenCalled();
  });

  it("do segundo foco em diante (voltando de outra tela): executa o callback normalmente", () => {
    const callback = jest.fn();
    renderHook(() => useFocusEffectSkippingFirst(callback));

    capturedFocusCallback?.(); // primeiro foco — ignorado
    capturedFocusCallback?.(); // segundo foco — executa
    expect(callback).toHaveBeenCalledTimes(1);

    capturedFocusCallback?.(); // terceiro foco — executa de novo
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("repassa o valor de retorno do callback (função de limpeza) normalmente a partir do segundo foco", () => {
    const cleanup = jest.fn();
    const callback = jest.fn(() => cleanup);
    renderHook(() => useFocusEffectSkippingFirst(callback));

    capturedFocusCallback?.(); // primeiro foco — ignorado, sem cleanup
    const returned = capturedFocusCallback?.();
    expect(returned).toBe(cleanup);
  });
});
