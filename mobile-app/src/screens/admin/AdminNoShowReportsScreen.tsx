import React, { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { RefreshControl, ScrollView, TouchableOpacity, View } from "react-native";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { MvCard, MvText } from "../../components/mv";
import { adminApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { AdminScaffold } from "./AdminScaffold";
import { handleScreenError } from "../shared/api-helpers";

// Raio-X de pagamentos, Rodada 4, Lote 7: a rota GET /admin/no-show-reports
// já existia com o comentário "cabe a um admin revisar os casos recorrentes
// e decidir manualmente", mas nenhuma tela chamava essa rota — a revisão
// manual prometida no próprio código não era possível pelo app.

type Props = {
  navigation: any;
};

const STRIKE_OPTIONS = [1, 2, 3, 5] as const;

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function AdminNoShowReportsScreen({ navigation }: Props) {
  const { theme } = useMvTheme();
  const { showToast } = useAppState();
  const [minStrikes, setMinStrikes] = useState<number>(2);

  const reportsQuery = useAuthQuery(
    queryKeys.admin.noShowReports({ minStrikes }),
    (token) => adminApi.listNoShowReports(token, minStrikes)
  );

  const loading = reportsQuery.isLoading;
  const items = reportsQuery.data ?? [];

  useEffect(() => {
    if (reportsQuery.error) {
      handleScreenError({
        error: reportsQuery.error,
        showToast,
        fallbackMessage: "Falha ao carregar relatos de falta.",
        navigation
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportsQuery.error, navigation]);

  useFocusEffect(
    useCallback(() => {
      void reportsQuery.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reportsQuery.refetch])
  );

  return (
    <AdminScaffold title="Reincidência de falta" navigation={navigation} currentScreen="AdminNoShowReports">
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={reportsQuery.isRefetching}
            onRefresh={() => void reportsQuery.refetch()}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
        contentContainerStyle={{ padding: 16, paddingBottom: 90, gap: 10 }}
      >
        <MvText variant="body4" color="secondary">
          Relatos de falta (no-show) registrados pelos usuários. Filtre por número mínimo de faltas
          acumuladas pra achar os casos mais recorrentes e decidir manualmente (ex: suspender a conta).
        </MvText>

        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {STRIKE_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option}
              onPress={() => setMinStrikes(option)}
              style={{
                borderWidth: 1,
                borderColor: minStrikes === option ? theme.primary : "rgba(127,127,127,0.35)",
                borderRadius: 20,
                paddingHorizontal: 12,
                paddingVertical: 8
              }}
            >
              <MvText variant="caption">{option}+ faltas</MvText>
            </TouchableOpacity>
          ))}
        </View>

        {items.length === 0 && !loading ? (
          <MvCard>
            <MvText variant="body3">Nenhum relato encontrado para este filtro.</MvText>
          </MvCard>
        ) : null}

        {items.map((item) => (
          <MvCard key={item.id}>
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <MvText variant="semi2">{item.reportedUser.name}</MvText>
                <View style={{
                  backgroundColor: "rgba(239,68,68,0.12)",
                  borderRadius: 12,
                  paddingHorizontal: 10,
                  paddingVertical: 3
                }}>
                  <MvText variant="caption" color="danger">
                    {item.reportedUser.noShowStrikes} falta{item.reportedUser.noShowStrikes === 1 ? "" : "s"}
                  </MvText>
                </View>
              </View>
              <MvText variant="body4" color="secondary">
                {item.reportedUser.email} · {item.reportedUser.role === "PROVIDER" ? "Profissional" : "Aluno"}
              </MvText>
              <MvText variant="body4">Relatado por: {item.reportedByUser.name}</MvText>
              <MvText variant="body4" color="secondary">Registrado em {formatDate(item.createdAt)}</MvText>
              <TouchableOpacity
                onPress={() => navigation.navigate("AdminUserSearch")}
              >
                <MvText variant="caption" color="green">Buscar este usuário para suspender ou investigar →</MvText>
              </TouchableOpacity>
            </View>
          </MvCard>
        ))}
      </ScrollView>
    </AdminScaffold>
  );
}
