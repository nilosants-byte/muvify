import React, { useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, StatusBar, Text, TouchableOpacity, View } from "react-native";

import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientStackParamList } from "../../navigation/route-types";
import { ConsultancyRequest, consultancyApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { formatBRDate } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { C, S, DISPLAY } from "../../theme/v2tokens";
import { PressableScale } from "../../components/polish/PressableScale";
import { SkeletonCard } from "../../components/polish/SkeletonCard";

type Props = NativeStackScreenProps<ClientStackParamList, "ArchivedRequests">;
type ArchivedFilter = "ALL" | "REFUSED" | "EXPIRED" | "EXPIRED_REFUNDED" | "ARCHIVED";

const filterOptions: Array<{ label: string; value: ArchivedFilter }> = [
  { label: "Todos", value: "ALL" },
  { label: "Recusados", value: "REFUSED" },
  { label: "Sem resposta", value: "EXPIRED" },
  { label: "Expirados", value: "EXPIRED_REFUNDED" },
  { label: "Arquivados", value: "ARCHIVED" },
];

function archivedStatusLabel(status: ConsultancyRequest["status"]) {
  if (status === "REFUSED") return "Recusado";
  if (status === "EXPIRED") return "Expirada sem resposta";
  if (status === "EXPIRED_REFUNDED") return "Expirado/Estornado";
  if (status === "ARCHIVED") return "Arquivado";
  return status;
}

function variantFromStatus(status: ConsultancyRequest["status"]): "orange" | "red" | "blue" | "gray" {
  if (status === "REFUSED") return "orange";
  if (status === "EXPIRED") return "orange";
  if (status === "EXPIRED_REFUNDED") return "red";
  if (status === "ARCHIVED") return "blue";
  return "gray";
}

export function ArchivedRequestsScreen({ navigation }: Props) {
  const { showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<ArchivedFilter>("ALL");

  const archivedQuery = useAuthQuery(
    queryKeys.consultancy.myArchivedRequests({ status: filter }),
    (token) => consultancyApi.myArchivedRequests(token, { status: filter })
  );

  const loading = archivedQuery.isLoading;
  const loadError = archivedQuery.isError;
  const items = archivedQuery.data ?? [];
  // Segunda camada, Frente 1, Lote 3 (fechamento): o card inteiro já animava
  // ao toque (efeito padrão de PressableScale) sem nenhum onPress - parecia
  // clicável e não fazia nada. O pedido original do cliente (motivo/
  // limitações) já era buscado da API mas nunca aparecia na tela; expandir
  // o card no toque mostra esse conteúdo em vez de só remover a animação.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (archivedQuery.error) {
      handleScreenError({ error: archivedQuery.error, showToast, fallbackMessage: "Falha ao carregar propostas arquivadas.", navigation });
    }
  }, [archivedQuery.error, showToast, navigation]);

  const orderedItems = useMemo(() =>
    [...items].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [items]
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      {/* Header V2 */}
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityRole="button" accessibilityLabel="Voltar" style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={18} color={theme.text1} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 24, color: theme.text1, letterSpacing: -0.3 }}>Arquivadas</Text>
          <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 11, color: theme.text3, marginTop: 2 }}>propostas recusadas e expiradas</Text>
        </View>
      </View>

      {/* Filtros V2 */}
      <View style={{ paddingHorizontal: S.px, paddingTop: 14, paddingBottom: 8 }}>
        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, marginBottom: 10 }}>
          Histórico de propostas recusadas, expiradas ou arquivadas.
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {filterOptions.map((option) => {
            const active = filter === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                onPress={() => setFilter(option.value)}
                style={{
                  height: 36, paddingHorizontal: 14, borderRadius: S.chipR,
                  backgroundColor: active ? theme.primarySubtle : "rgba(255,255,255,0.04)",
                  borderWidth: 1, borderColor: active ? theme.primarySubtleBorder : theme.border,
                }}
              >
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: active ? theme.primary : theme.text2, lineHeight: 36 }}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {loading && items.length === 0 ? (
        <View style={{ paddingHorizontal: S.px, paddingTop: 12, gap: 10 }}>
          {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
        </View>
      ) : null}
      <FlatList
        contentContainerStyle={{ paddingHorizontal: S.px, paddingBottom: 40, gap: 10 }}
        data={loading && items.length === 0 ? [] : orderedItems}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={archivedQuery.isRefetching} onRefresh={() => void archivedQuery.refetch()} tintColor={theme.primary} colors={[theme.primary]} />}
        renderItem={({ item }) => {
          const bs = variantFromStatus(item.status);
          const badgeColor = bs === "orange" ? C.amber : bs === "red" ? theme.danger : bs === "blue" ? C.sky : theme.text2;
          const badgeBg = bs === "orange" ? C.amberDim : bs === "red" ? theme.dangerSubtle : bs === "blue" ? C.skyDim : "rgba(255,255,255,0.06)";
          const badgeBorder = bs === "orange" ? C.amberBorder : bs === "red" ? theme.dangerSubtleBorder : bs === "blue" ? C.skyBorder : theme.border;
          const hasDetail = Boolean(item.trainingNeedText || item.limitationText || item.extraInfoText);
          const expanded = expandedId === item.id;
          return (
            <PressableScale
              onPress={hasDetail ? () => setExpandedId(expanded ? null : item.id) : undefined}
              style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 8 }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }}>{item.provider?.displayName ?? "Profissional"}</Text>
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2 }}>{item.quotedOffer?.title ?? "Sem oferta vinculada"}</Text>
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3 }}>Atualizada em {formatBRDate(item.updatedAt)}</Text>
                </View>
                <View style={{ backgroundColor: badgeBg, borderWidth: 1, borderColor: badgeBorder, borderRadius: S.chipR, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: badgeColor }}>{archivedStatusLabel(item.status)}</Text>
                </View>
                {hasDetail ? (
                  <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={theme.text3} />
                ) : null}
              </View>
              {item.providerResponseText ? (
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, marginTop: 2 }}>Resposta: {item.providerResponseText}</Text>
              ) : null}
              {expanded ? (
                <View style={{ gap: 4, marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.border }}>
                  {item.trainingNeedText ? (
                    <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2 }}>Objetivo: {item.trainingNeedText}</Text>
                  ) : null}
                  {item.limitationText ? (
                    <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2 }}>Limitações: {item.limitationText}</Text>
                  ) : null}
                  {item.extraInfoText ? (
                    <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2 }}>Outras informações: {item.extraInfoText}</Text>
                  ) : null}
                </View>
              ) : null}
            </PressableScale>
          );
        }}
        ListEmptyComponent={
          !loading ? (
            <View style={{ paddingTop: 40, alignItems: "center", gap: 10 }}>
              <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: loadError ? theme.dangerSubtle : theme.primarySubtle, borderWidth: 1, borderColor: loadError ? theme.dangerSubtleBorder : theme.primarySubtleBorder, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={loadError ? "cloud-offline-outline" : "archive-outline"} size={28} color={loadError ? theme.danger : theme.primary} />
              </View>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3, textAlign: "center" }}>
                {loadError ? "Falha ao carregar. Puxe para atualizar." : "Nenhuma proposta arquivada neste filtro."}
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}
