import { useCallback } from "react";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAppState } from "../state/AppState";
import type { ClientStackParamList } from "../navigation/route-types";

type Nav = NativeStackNavigationProp<ClientStackParamList>;

// Bloco 3 (exclusividade de marketplace): rede de segurança pras telas de
// descoberta — a entrada principal já some da navegação quando o cliente
// tem vínculo ativo, isso aqui só cobre quem chega mesmo assim (deep link,
// tela já aberta antes do vínculo começar, etc). Passe `allowedProviderId`
// quando a tela pode ser vista pro próprio profissional já contratado
// (ex.: ProfessionalDetail do personal atual).
export function useBlockedWhileLocked(allowedProviderId?: string) {
  const navigation = useNavigation<Nav>();
  const { activeEngagement } = useAppState();

  useFocusEffect(
    useCallback(() => {
      if (!activeEngagement?.hasActive) return;
      if (allowedProviderId && allowedProviderId === activeEngagement.providerId) return;
      navigation.navigate("ClientTabs", { screen: "ClientHome" });
    }, [activeEngagement, allowedProviderId, navigation])
  );
}
