import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, TouchableOpacity, View } from "react-native";
import { MvCard, MvText } from "../../components/mv";
import { adminApi, AdminDashboardOverview } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { AdminScaffold } from "./AdminScaffold";
import { handleScreenError } from "../shared/api-helpers";

const MONTH_LABELS = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez"
];

type Props = {
  navigation: any;
};

export function AdminHomeScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<AdminDashboardOverview | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const payload = await runWithAuth((token) =>
        adminApi.dashboardOverview(token, { month, year })
      );
      setOverview(payload);
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao carregar painel administrativo.",
        navigation
      });
    } finally {
      setLoading(false);
    }
  }, [month, navigation, runWithAuth, showToast, year]);

  useEffect(() => {
    void load();
  }, [load]);

  const monthLabel = `${MONTH_LABELS[month - 1]} ${year}`;
  const maxUsersInDay = useMemo(() => {
    if (!overview) return 1;
    const values = overview.newUsersChart.data.map((item) => item.usersCount);
    return Math.max(1, ...values);
  }, [overview]);

  function prevMonth() {
    if (month === 1) {
      setMonth(12);
      setYear((current) => current - 1);
      return;
    }
    setMonth((current) => current - 1);
  }

  function nextMonth() {
    if (month === 12) {
      setMonth(1);
      setYear((current) => current + 1);
      return;
    }
    setMonth((current) => current + 1);
  }

  return (
    <AdminScaffold title="Administrador" navigation={navigation} currentScreen="AdminHome">
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void load()}
            tintColor="#4CAF50"
            colors={["#4CAF50"]}
          />
        }
        contentContainerStyle={{ padding: 16, paddingBottom: 90, gap: 12 }}
      >
        <MvCard>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <TouchableOpacity onPress={prevMonth}>
              <MvText variant="semi3" color="secondary">{"<"} Mes anterior</MvText>
            </TouchableOpacity>
            <MvText variant="semi2">{monthLabel}</MvText>
            <TouchableOpacity onPress={nextMonth}>
              <MvText variant="semi3" color="secondary">Próximo mês {">"}</MvText>
            </TouchableOpacity>
          </View>
        </MvCard>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <MvCard style={{ flex: 1 }}>
            <MvText variant="caption" color="secondary">Usuarios ativos</MvText>
            <MvText variant="h2">{overview?.summary.activeUsers ?? 0}</MvText>
          </MvCard>
          <MvCard style={{ flex: 1 }}>
            <MvText variant="caption" color="secondary">Usuarios totais</MvText>
            <MvText variant="h2">{overview?.summary.totalUsers ?? 0}</MvText>
          </MvCard>
        </View>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <MvCard style={{ flex: 1 }}>
            <MvText variant="caption" color="secondary">Personais</MvText>
            <MvText variant="h2">{overview?.summary.totalProviders ?? 0}</MvText>
          </MvCard>
          <MvCard style={{ flex: 1 }}>
            <MvText variant="caption" color="secondary">Alunos</MvText>
            <MvText variant="h2">{overview?.summary.totalClients ?? 0}</MvText>
          </MvCard>
        </View>

        <MvCard>
          <MvText variant="semi2">Novos usuários por dia</MvText>
          <MvText variant="body4" color="secondary" style={{ marginTop: 4 }}>
            Total no mês: {overview?.newUsersChart.total ?? 0}
          </MvText>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingTop: 10, alignItems: "flex-end", gap: 6 }}
          >
            {(overview?.newUsersChart.data ?? []).map((point) => {
              const barHeight = Math.max(6, Math.round((point.usersCount / maxUsersInDay) * 90));
              return (
                <View key={point.date} style={{ width: 20, alignItems: "center", gap: 4 }}>
                  <View
                    style={{
                      width: 12,
                      height: barHeight,
                      borderRadius: 8,
                      backgroundColor:
                        theme.mode === "dark" ? "rgba(76,175,80,0.9)" : "rgba(76,175,80,0.85)"
                    }}
                  />
                  <MvText variant="caption" color="secondary">{point.day}</MvText>
                </View>
              );
            })}
          </ScrollView>
        </MvCard>

        <MvCard>
          <MvText variant="semi2">Ranking por regiao</MvText>
          {(overview?.rankings.byRegion ?? []).slice(0, 5).map((item) => (
            <View
              key={`region-${item.label}`}
              style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}
            >
              <MvText variant="body3">{item.label}</MvText>
              <MvText variant="semi3">{item.bookingsCount}</MvText>
            </View>
          ))}
        </MvCard>

        <MvCard>
          <MvText variant="semi2">Ranking por cidade</MvText>
          {(overview?.rankings.byCity ?? []).slice(0, 5).map((item) => (
            <View
              key={`city-${item.label}`}
              style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}
            >
              <MvText variant="body3">{item.label}</MvText>
              <MvText variant="semi3">{item.bookingsCount}</MvText>
            </View>
          ))}
        </MvCard>

        <MvCard>
          <MvText variant="semi2">Ranking por bairro</MvText>
          {(overview?.rankings.byNeighborhood ?? []).slice(0, 5).map((item) => (
            <View
              key={`neighborhood-${item.label}`}
              style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}
            >
              <MvText variant="body3">{item.label}</MvText>
              <MvText variant="semi3">{item.bookingsCount}</MvText>
            </View>
          ))}
        </MvCard>
      </ScrollView>
    </AdminScaffold>
  );
}
