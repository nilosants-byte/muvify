import React, { useCallback, useEffect } from "react";
import { RefreshControl, ScrollView, StatusBar, Text, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientStackParamList } from "../../navigation/route-types";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { MyDisputeCase, userApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { formatCurrencyBRL, formatBRDate } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";
import { S, DISPLAY, C } from "../../theme/v2tokens";

type Props = NativeStackScreenProps<ClientStackParamList, "MyDisputes">;

// Raio-X de pagamentos, Rodada 4, Lote 11: cliente não tinha nenhum lugar
// central pra acompanhar as próprias disputas em andamento — só via um
// texto genérico "está em análise" em outro fluxo, sem histórico nenhum.

const TYPE_LABEL: Record<MyDisputeCase["type"], string> = {
  NO_SHOW_CONTESTED: "Falta contestada",
  CHARGEBACK: "Contestação de cobrança",
  REFUND_FAILED: "Falha no reembolso",
  DELIVERY_CONTESTED: "Ficha de treino contestada",
  AUTO_CAPTURE_CONTESTED: "Cobrança automática contestada",
  CAPTURE_FAILED: "Falha na cobrança",
  CONFIRMATION_DEADLOCK: "Sessão pendente por falha técnica"
};

function statusInfo(dispute: MyDisputeCase) {
  if (dispute.status === "OPEN") {
    return { label: "Em análise", color: C.amber, bg: C.amberDim, border: C.amberBorder };
  }
  if (dispute.resolution === "REFUNDED") {
    return { label: "Resolvido: reembolsado", color: "#22C55E", bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.2)" };
  }
  if (dispute.resolution === "DENIED") {
    return { label: "Resolvido: reembolso negado", color: "#EF4444", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.2)" };
  }
  return { label: "Resolvido", color: "#22C55E", bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.2)" };
}

export function MyDisputesScreen({ navigation }: Props) {
  const { showToast, user } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const disputesQuery = useAuthQuery(queryKeys.disputes.mine(), (token) => userApi.myDisputes(token));
  const disputes = disputesQuery.data ?? [];

  useFocusEffect(useCallback(() => { void disputesQuery.refetch(); return undefined; }, [disputesQuery.refetch]));

  useEffect(() => {
    if (disputesQuery.error) {
      handleScreenError({ error: disputesQuery.error, showToast, fallbackMessage: "Falha ao carregar suas disputas." });
    }
  }, [disputesQuery.error, showToast]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={18} color={theme.text1} />
        </TouchableOpacity>
        <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 22, color: theme.text1, letterSpacing: -0.3 }}>
          Minhas disputas
        </Text>
      </View>

      <ScrollView
        refreshControl={
          <RefreshControl refreshing={disputesQuery.isRefetching} onRefresh={() => void disputesQuery.refetch()} tintColor={theme.primary} colors={[theme.primary]} />
        }
        contentContainerStyle={{ padding: S.px, gap: 12, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {disputes.length === 0 && !disputesQuery.isLoading ? (
          <View style={{ alignItems: "center", padding: 24, gap: 10 }}>
            <Ionicons name="checkmark-circle-outline" size={36} color={theme.text3} />
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }}>Nenhuma disputa</Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3, textAlign: "center" }}>
              Você não tem nenhuma disputa em andamento ou no histórico.
            </Text>
          </View>
        ) : null}

        {disputes.map((dispute) => {
          const status = statusInfo(dispute);
          const isClientSide = dispute.clientId === user?.id;
          return (
            <View
              key={dispute.id}
              style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 8 }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1, flex: 1 }}>
                  {TYPE_LABEL[dispute.type] ?? dispute.type}
                </Text>
                <View style={{ backgroundColor: status.bg, borderWidth: 1, borderColor: status.border, borderRadius: S.chipR, paddingHorizontal: 10, paddingVertical: 3 }}>
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: status.color }}>{status.label}</Text>
                </View>
              </View>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2 }}>
                {isClientSide ? `Com ${dispute.provider.displayName}` : `Com ${dispute.client.name}`} · {formatCurrencyBRL(dispute.amountCents / 100)}
              </Text>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3 }}>
                Aberta em {formatBRDate(dispute.createdAt)}
                {dispute.resolvedAt ? ` · resolvida em ${formatBRDate(dispute.resolvedAt)}` : ""}
              </Text>
              {dispute.status === "RESOLVED" && dispute.resolutionNote ? (
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, marginTop: 2 }}>
                  {dispute.resolutionNote}
                </Text>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
