import { act, renderHook } from "@testing-library/react-native";
import { useOfflineGate } from "../state/useOfflineGate";

// Frente 11 (engenharia mobile), Lote 1: antes, perder sinal por alguns
// segundos em QUALQUER tela desmontava a navegação inteira (perdendo
// formulário/upload em andamento). Agora só o cold start sem sessão online
// nenhuma bloqueia a tela cheia — o resto vira um aviso não-destrutivo.

describe("Frente 11, Lote 1 — useOfflineGate", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("cold start offline (nunca ficou online): bloqueia tela cheia imediatamente, sem aviso de banner", () => {
    const { result } = renderHook<ReturnType<typeof useOfflineGate>, { online: boolean }>(
      ({ online }) => useOfflineGate(online, 4000),
      { initialProps: { online: false } }
    );

    expect(result.current.shouldHardBlockColdStart).toBe(true);
    expect(result.current.showOfflineBanner).toBe(false);
  });

  it("app já esteve online e perde conexão: NÃO bloqueia tela cheia, nem durante a janela de tolerância nem depois", () => {
    const { result, rerender } = renderHook<ReturnType<typeof useOfflineGate>, { online: boolean }>(
      ({ online }) => useOfflineGate(online, 4000),
      { initialProps: { online: true } }
    );

    expect(result.current.shouldHardBlockColdStart).toBe(false);
    expect(result.current.showOfflineBanner).toBe(false);

    rerender({ online: false });
    // Dentro da janela de tolerância: nenhum aviso ainda.
    expect(result.current.showOfflineBanner).toBe(false);
    expect(result.current.shouldHardBlockColdStart).toBe(false);

    act(() => {
      jest.advanceTimersByTime(4000);
    });

    // Passada a tolerância: aviso de banner aparece, mas a navegação nunca é bloqueada.
    expect(result.current.showOfflineBanner).toBe(true);
    expect(result.current.shouldHardBlockColdStart).toBe(false);
  });

  it("reconecta: aviso de banner some assim que online volta a true", () => {
    const { result, rerender } = renderHook<ReturnType<typeof useOfflineGate>, { online: boolean }>(
      ({ online }) => useOfflineGate(online, 4000),
      { initialProps: { online: true } }
    );

    rerender({ online: false });
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    expect(result.current.showOfflineBanner).toBe(true);

    rerender({ online: true });
    expect(result.current.showOfflineBanner).toBe(false);
    expect(result.current.shouldHardBlockColdStart).toBe(false);
  });
});
