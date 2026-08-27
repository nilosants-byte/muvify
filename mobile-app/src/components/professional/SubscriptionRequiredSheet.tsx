import React from "react";
import { Modal, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMvTheme } from "../../theme/MvThemeContext";
import { PressableScale } from "../polish/PressableScale";
import { MvText } from "../mv";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { providerSubscriptionApi } from "../../services/api/client";
import { formatCurrencyBRL } from "../../utils/formatters";

interface SubscriptionRequiredSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onActivate: () => void;
}

// Bloco 6 (bloqueio por assinatura inativa) — mockup aprovado "Muvify -
// Bloqueio de Assinatura": bottom sheet compacto (não o MvModalSheet
// full-screen usado nos formulários financeiros), tom convidativo, texto
// neutro que não presume que o profissional já usou a ferramenta antes.
// Renderizado uma vez na raiz (root-stack.tsx), controlado por
// SubscriptionGateState — qualquer tela chama showSubscriptionRequiredSheet()
// via useAppState() quando um erro SUBSCRIPTION_REQUIRED chega.
export function SubscriptionRequiredSheet({ visible, onDismiss, onActivate }: SubscriptionRequiredSheetProps) {
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  // Realinhamento com o Will (2026-08-26): preço deixou de ser único
  // (R$29,90 pra todo mundo) — esse texto tinha o valor cravado, errado pra
  // quem não é fundador (R$39,90) e pro fundador depois do 12º mês. Só
  // busca quando o sheet está de fato visível (evita disparar em qualquer
  // usuário logado, inclusive cliente, sem necessidade).
  const subscriptionQuery = useAuthQuery(
    queryKeys.providers.mySubscription(),
    (token) => providerSubscriptionApi.myStatus(token),
    { enabled: visible }
  );
  const priceLabel = subscriptionQuery.data ? formatCurrencyBRL(subscriptionQuery.data.priceCents / 100) : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss} testID="sheet.subscription-required">
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onDismiss} />
        <View
          style={{
            backgroundColor: theme.cardBg,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            borderWidth: 1,
            borderColor: theme.borderMid,
            borderBottomWidth: 0,
            paddingTop: 12,
            paddingHorizontal: 24,
            paddingBottom: insets.bottom + 22,
            alignItems: "center",
            gap: 14
          }}
        >
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.borderMid }} />

          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 20,
              backgroundColor: theme.primarySubtle,
              borderWidth: 1,
              borderColor: theme.primarySubtleBorder,
              alignItems: "center",
              justifyContent: "center",
              marginTop: 8
            }}
          >
            <Ionicons name="lock-closed-outline" size={24} color={theme.primary} />
          </View>

          <MvText variant="h3" style={{ textAlign: "center", lineHeight: 24 }}>
            Essa ferramenta é exclusiva de quem assina o Muvify
          </MvText>

          <Text
            style={{
              fontFamily: "DMSans_400Regular",
              fontSize: 12.5,
              lineHeight: 18,
              color: theme.text2,
              textAlign: "center"
            }}
          >
            {priceLabel ? `${priceLabel}/mês` : "Assinatura mensal"} pra criar ofertas, entregar fichas e configurar sua agenda. Cancela quando quiser.
          </Text>

          <PressableScale
            onPress={onActivate}
            style={{
              width: "100%",
              height: 50,
              borderRadius: 16,
              backgroundColor: theme.primary,
              alignItems: "center",
              justifyContent: "center",
              marginTop: 6
            }}
            testID="button.subscription-required-sheet.activate"
          >
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.textOnPrimary }}>
              Ativar assinatura
            </Text>
          </PressableScale>

          <TouchableOpacity
            onPress={onDismiss}
            style={{ paddingVertical: 10 }}
            testID="button.subscription-required-sheet.dismiss"
          >
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12.5, color: theme.text3 }}>
              Continuar navegando
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
