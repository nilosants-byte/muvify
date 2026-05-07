import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, StatusBar, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientStackParamList } from "../../navigation/route-types";
import { ConsultancyRequest, consultancyApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvCard, MvText } from "../../components/mv";
import { formatBRDate } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ClientStackParamList, "ArchivedRequests">;
type ArchivedFilter = "ALL" | "REFUSED" | "EXPIRED_REFUNDED" | "ARCHIVED";

const filterOptions: Array<{ label: string; value: ArchivedFilter }> = [
  { label: "Todos", value: "ALL" },
  { label: "Recusados", value: "REFUSED" },
  { label: "Expirados", value: "EXPIRED_REFUNDED" },
  { label: "Arquivados", value: "ARCHIVED" },
];

function archivedStatusLabel(status: ConsultancyRequest["status"]) {
  if (status === "REFUSED") return "Recusado";
  if (status === "EXPIRED_REFUNDED") return "Expirado/Estornado";
  if (status === "ARCHIVED") return "Arquivado";
  return status;
}

function variantFromStatus(status: ConsultancyRequest["status"]): "orange" | "red" | "blue" | "gray" {
  if (status === "REFUSED") return "orange";
  if (status === "EXPIRED_REFUNDED") return "red";
  if (status === "ARCHIVED") return "blue";
  return "gray";
}

export function ArchivedRequestsScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<ArchivedFilter>("ALL");
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ConsultancyRequest[]>([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const result = await runWithAuth((token) => consultancyApi.myArchivedRequests(token, { status: filter }));
      setItems(result);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar propostas arquivadas.", navigation });
    } finally {
      setLoading(false);
    }
  }, [filter, navigation, runWithAuth, showToast]);

  useEffect(() => { void load(); }, [load]);

  const orderedItems = useMemo(() =>
    [...items].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [items]
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 14, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.borderSub }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </TouchableOpacity>
        <MvText variant="h4">Solicitações arquivadas</MvText>
      </View>

      <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
        <MvText variant="body4" color="secondary" style={{ marginBottom: 10 }}>
          Histórico de propostas recusadas, expiradas ou arquivadas.
        </MvText>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {filterOptions.map((option) => (
            <TouchableOpacity
              key={option.value}
              onPress={() => setFilter(option.value)}
              style={{
                paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                backgroundColor: filter === option.value ? "rgba(76,175,80,0.12)" : theme.chipBg,
                borderWidth: 1, borderColor: filter === option.value ? "rgba(76,175,80,0.30)" : theme.border,
              }}
            >
              <MvText variant="body4" style={{ color: filter === option.value ? theme.textGreen : theme.chipText }}>
                {option.label}
              </MvText>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <FlatList
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 8 }}
        data={orderedItems}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor="#4CAF50" colors={["#4CAF50"]} />}
        renderItem={({ item }) => (
          <MvCard>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <MvText variant="semi2">{item.provider?.displayName ?? "Profissional"}</MvText>
                <MvText variant="body4" color="secondary">{item.quotedOffer?.title ?? "Sem oferta vinculada"}</MvText>
                <MvText variant="body4" color="tertiary">
                  Atualizada em {formatBRDate(item.updatedAt)}
                </MvText>
              </View>
              <MvBadge label={archivedStatusLabel(item.status)} variant={variantFromStatus(item.status)} />
            </View>
            {item.providerResponseText ? (
              <MvText variant="body4" color="secondary" style={{ marginTop: 6 }}>Resposta: {item.providerResponseText}</MvText>
            ) : null}
          </MvCard>
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={{ paddingTop: 40, alignItems: "center", gap: 8 }}>
              <MvText variant="body3" color="secondary">Nenhuma proposta arquivada neste filtro.</MvText>
            </View>
          ) : null
        }
      />
    </View>
  );
}
