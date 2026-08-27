import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

type SubscriptionGateContextValue = {
  subscriptionSheetVisible: boolean;
  showSubscriptionRequiredSheet: () => void;
  hideSubscriptionRequiredSheet: () => void;
};

const SubscriptionGateContext = createContext<SubscriptionGateContextValue | undefined>(undefined);

// Bloco 6 (bloqueio por assinatura inativa): "cadeados" — quando uma ação
// bloqueada é tentada em qualquer tela, mostra o bottom sheet convidativo
// (mockup aprovado "Muvify - Bloqueio de Assinatura") em vez de um toast
// genérico. Context próprio, não dentro de AppStateContext — mesmo motivo já
// documentado em ToastState.tsx: showSubscriptionRequiredSheet é chamada de
// qualquer tela, e só quem realmente renderiza o sheet (root-stack.tsx)
// precisa re-renderizar quando o estado de visibilidade muda.
export function SubscriptionGateProvider({ children }: { children: React.ReactNode }) {
  const [subscriptionSheetVisible, setSubscriptionSheetVisible] = useState(false);

  const showSubscriptionRequiredSheet = useCallback(() => {
    setSubscriptionSheetVisible(true);
  }, []);

  const hideSubscriptionRequiredSheet = useCallback(() => {
    setSubscriptionSheetVisible(false);
  }, []);

  const value = useMemo(
    () => ({ subscriptionSheetVisible, showSubscriptionRequiredSheet, hideSubscriptionRequiredSheet }),
    [subscriptionSheetVisible, showSubscriptionRequiredSheet, hideSubscriptionRequiredSheet]
  );

  return <SubscriptionGateContext.Provider value={value}>{children}</SubscriptionGateContext.Provider>;
}

export function useSubscriptionGate() {
  const ctx = useContext(SubscriptionGateContext);
  if (!ctx) {
    throw new Error("useSubscriptionGate must be used inside SubscriptionGateProvider.");
  }
  return ctx;
}
