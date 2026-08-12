import { useCallback, useRef } from "react";
import { useFocusEffect } from "@react-navigation/native";

// Frente 11 (engenharia mobile), Lote 6: useAuthQuery já busca sozinho ao
// montar a tela (staleTime:0 no queryClient faz o TanStack buscar em
// segundo plano assim que a query é observada pela primeira vez).
// useFocusEffect roda seu callback logo nesse MESMO mount (o primeiro foco
// de uma tela É o mount), então um `useFocusEffect(() => query.refetch())`
// somado a isso disparava duas chamadas de API quase simultâneas só na
// primeira vez que a tela abria. Substituto direto de useFocusEffect que
// pula apenas essa primeira chamada — a partir do segundo foco (usuário
// voltando de outra tela), roda normalmente, que é quando de fato vale a
// pena buscar de novo.
export function useFocusEffectSkippingFirst(callback: () => void | (() => void)) {
  const hasFocusedOnceRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedOnceRef.current) {
        hasFocusedOnceRef.current = true;
        return;
      }
      return callback();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [callback])
  );
}
