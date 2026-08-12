import { useEffect, useState } from "react";

// Frente 11 (engenharia mobile), Lote 1: extraído de root-stack.tsx pra ser
// testável isoladamente, sem montar a árvore de navegação inteira. Lógica
// idêntica à que já existia — só isolada.
//
// Duas situações bem diferentes de "sem conexão":
// 1. O app nunca chegou a ficar online nesta sessão (cold start sem sinal) -
//    NavigationContainer nunca foi montado, não existe pilha/formulário/
//    upload em andamento pra perder. Bloqueio de tela cheia é seguro aqui.
// 2. O app JÁ estava em uso (sessão online estabelecida) e a conexão caiu -
//    elevador, garagem, sinal fraco. Bloquear a tela inteira aqui destruía
//    a pilha de navegação inteira (NavigationContainer desmontado), com
//    qualquer formulário em preenchimento, upload em andamento ou fluxo de
//    pagamento em curso perdido, mesmo numa queda de sinal de poucos
//    segundos. Esse caso agora só mostra um aviso não-destrutivo.
export function useOfflineGate(online: boolean, graceMs = 4000) {
  const [hadOnlineSession, setHadOnlineSession] = useState(false);
  const [offlineGraceExpired, setOfflineGraceExpired] = useState(false);

  useEffect(() => {
    if (online) {
      setHadOnlineSession(true);
      setOfflineGraceExpired(false);
      return;
    }

    if (!hadOnlineSession) {
      setOfflineGraceExpired(true);
      return;
    }

    setOfflineGraceExpired(false);
    const timer = setTimeout(() => {
      setOfflineGraceExpired(true);
    }, graceMs);
    return () => clearTimeout(timer);
  }, [online, hadOnlineSession, graceMs]);

  const shouldHardBlockColdStart = !online && !hadOnlineSession && offlineGraceExpired;
  const showOfflineBanner = !online && hadOnlineSession && offlineGraceExpired;

  return { shouldHardBlockColdStart, showOfflineBanner };
}
