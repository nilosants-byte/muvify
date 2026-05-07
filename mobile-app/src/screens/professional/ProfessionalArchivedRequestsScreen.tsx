import React, { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { FlatList, RefreshControl, StatusBar, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { consultancyApi, ConsultancyRequest } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvCard, MvText } from "../../components/mv";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "ProfessionalArchivedRequests">;
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

export function ProfessionalArchivedRequestsScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<ArchivedFilter>("ALL");
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ConsultancyRequest[]>([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const response = await runWithAuth((token) => consultancyApi.providerArchivedRequests(token, { status: filter }));
      setItems(response);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar arquivados do profissional.", navigation });
    } finally {
      setLoading(false);
    }
  }, [filter, navigation, runWithAuth, showToast]);

  useEffect(() => { void load(); }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: 16, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10 }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </TouchableOpacity>
        <MvText variant="semi1">Arquivados</MvText>
      </View>

      <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
        <MvText variant="body4" color="secondary" style={{ marginBottom: 10 }}>
          Propostas recusadas ou encerradas por prazo.
        </MvText>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {filterOptions.map((option) => (
            <TouchableOpacity
              key={option.value}
              onPress={() => setFilter(option.value)}
              style={{
                paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                backgroundColor: filter === option.value ? "rgba(34,197,94,0.12)" : theme.chipBg,
                borderWidth: 1, borderColor: filter === option.value ? "rgba(34,197,94,0.28)" : theme.border,
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
        data={items}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor="#22C55E" colors={["#22C55E"]} />}
        renderItem={({ item }) => (
          <MvCard>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <MvText variant="semi2">{item.client?.name ?? "Aluno"}</MvText>
                <MvText variant="body4" color="secondary">{item.quotedOffer?.title ?? "Sem oferta vinculada"}</MvText>
              </View>
              <MvBadge label={archivedStatusLabel(item.status)} variant={variantFromStatus(item.status)} />
            </View>
            {item.providerResponseText ? (
              <MvText variant="body4" color="secondary" style={{ marginTop: 4 }}>Sua resposta: {item.providerResponseText}</MvText>
            ) : null}
          </MvCard>
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={{ paddingTop: 40, alignItems: "center" }}>
              <MvText variant="body3" color="secondary">Nenhuma proposta arquivada neste filtro.</MvText>
            </View>
          ) : null
        }
        showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}
      />
    </View>
  );
}
