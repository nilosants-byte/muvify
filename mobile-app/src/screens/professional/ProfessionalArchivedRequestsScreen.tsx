import React, { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { FlatList, StatusBar, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { consultancyApi, ConsultancyRequest } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvCard, MvRefreshControl, MvText } from "../../components/mv";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { handleScreenError } from "../shared/api-helpers";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "ProfessionalArchivedRequests">;
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

export function ProfessionalArchivedRequestsScreen({ navigation }: Props) {
  const { showToast } = useAppState();
  const { theme } = useMvTheme();
  const [filter, setFilter] = useState<ArchivedFilter>("ALL");

  const archivedQuery = useAuthQuery(
    queryKeys.consultancy.providerArchivedRequests({ status: filter }),
    (token) => consultancyApi.providerArchivedRequests(token, { status: filter }),
  );

  const items = (archivedQuery.data ?? []) as ConsultancyRequest[];

  useEffect(() => {
    if (archivedQuery.error) {
      handleScreenError({ error: archivedQuery.error, showToast, fallbackMessage: "Falha ao carregar arquivados do profissional.", navigation });
    }
  }, [archivedQuery.error, showToast, navigation]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <ProfessionalScreenHeader title="Arquivados" onBack={() => navigation.goBack()} />

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
                backgroundColor: filter === option.value ? theme.primarySubtle : theme.chipBg,
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
        refreshControl={<MvRefreshControl refreshing={archivedQuery.isRefetching} onRefresh={() => void archivedQuery.refetch()} />}
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
          !archivedQuery.isLoading ? (
            <View style={{ paddingTop: 40, alignItems: "center", gap: 12 }}>
              <MvText variant="body3" color="secondary">Nenhuma proposta arquivada neste filtro.</MvText>
              <TouchableOpacity
                onPress={() => navigation.navigate("ProfessionalConsultancyCenter")}
                style={{ paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: "rgba(36,230,109,0.25)", backgroundColor: "rgba(36,230,109,0.08)" }}
              >
                <MvText variant="semi3" style={{ color: "#24E66D" }}>Ver central de consultoria</MvText>
              </TouchableOpacity>
            </View>
          ) : null
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
