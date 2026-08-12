import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

export type ToastType = "success" | "error" | "info";

export type ToastPayload = {
  id: number;
  message: string;
  type: ToastType;
};

type ToastContextValue = {
  toast: ToastPayload | null;
  showToast: (message: string, type?: ToastType) => void;
  clearToast: () => void;
};

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

// Frente 11 (engenharia mobile), Lote 4: toast morava dentro do
// AppStateContext, no mesmo valor memoizado de user/role/runWithAuth/etc.
// Qualquer chamada a showToast (381+ pontos no app inteiro) trocava a
// identidade desse valor único, re-renderizando os ~98 arquivos que
// consomem useAppState() por qualquer outro motivo — mesmo quem nunca lê
// toast. Context próprio: só quem lê `toast` de verdade (hoje só
// root-stack.tsx, via useToast()) re-renderiza quando um toast aparece.
// showToast/clearToast continuam expostos também por useAppState() (ver
// AppState.tsx) — são funções estáveis (useCallback com deps vazias), então
// reexportá-las lá não reintroduz o problema; só o payload `toast` em si
// (que muda de identidade a cada chamada) precisava sair.
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastPayload | null>(null);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    setToast({ id: Date.now() + Math.random() * 100_000, message, type });
  }, []);

  const clearToast = useCallback(() => {
    setToast(null);
  }, []);

  const value = useMemo(() => ({ toast, showToast, clearToast }), [toast, showToast, clearToast]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside ToastProvider.");
  }
  return ctx;
}
