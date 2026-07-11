import React, { useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, TouchableOpacity, View } from "react-native";
import { MvCard, MvText } from "../../components/mv";
import { adminApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { AdminScaffold } from "./AdminScaffold";
import { handleScreenError } from "../shared/api-helpers";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";

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
  const { showToast } = useAppState();
  const { theme } = useMvTheme();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const overviewQuery = useAuthQuery(
    queryKeys.admin.dashboard({ month, year }),
    (token) => adminApi.dashboardOverview(token, { month, year })
  );

  const loading = overviewQuery.isLoading || overviewQuery.isFetching;
  const overview = overviewQuery.data ?? null;

  useEffect(() => {
    if (overviewQuery.error) {
      handleScreenError({ error: overviewQuery.error, showToast, fallbackMessage: "Falha ao carregar painel administrativo.", navigation });
    }
  }, [overviewQuery.error, showToast, navigation]);

  const monthLabel = `${MONTH_LABELS[month - 1]} ${year}`;
  const maxUsersInDay = useMemo(() => {
    if (!overview) return 1;
    const values = (overview.newUsersChart?.data ?? []).map((item) => Number(item.usersCount) || 0).filter((v) => !isNaN(v));
    return Math.max(1, ...values);
  }, [overview]);

  function prevMonth() {
    const now = new Date();
    const minYear = now.getFullYear() - 2;
    if (year <= minYear && month === 1) return;
    if (month === 1) {
      setMonth(12);
      setYear((current) => current - 1);
      return;
    }
    setMonth((current) => current - 1);
  }

  function nextMonth() {
    const now = new Date();
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
    if (isCurrentMonth) return;
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
            refreshing={overviewQuery.isRefetching}
            onRefresh={() => void overviewQuery.refetch()}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
        contentContainerStyle={{ padding: 16, paddingBottom: 90, gap: 12 }}
      >
        <MvCard>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <TouchableOpacity onPress={prevMonth} disabled={year <= new Date().getFullYear() - 2 && month === 1} accessibilityRole="button" accessibilityLabel="Mês anterior">
              <MvText variant="semi3" color={year <= new Date().getFullYear() - 2 && month === 1 ? "tertiary" : "secondary"}>{"<"} Mês anterior</MvText>
            </TouchableOpacity>
            <MvText variant="semi2">{monthLabel}</MvText>
            <TouchableOpacity onPress={nextMonth} disabled={year === new Date().getFullYear() && month === new Date().getMonth() + 1} accessibilityRole="button" accessibilityLabel="Próximo mês">
              <MvText variant="semi3" color={year === new Date().getFullYear() && month === new Date().getMonth() + 1 ? "tertiary" : "secondary"}>Próximo mês {">"}</MvText>
            </TouchableOpacity>
          </View>
        </MvCard>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <MvCard style={{ flex: 1 }}>
            <MvText variant="caption" color="secondary">Usuários ativos</MvText>
            <MvText variant="h2">{overview?.summary?.activeUsers ?? 0}</MvText>
          </MvCard>
          <MvCard style={{ flex: 1 }}>
            <MvText variant="caption" color="secondary">Usuários totais</MvText>
            <MvText variant="h2">{overview?.summary?.totalUsers ?? 0}</MvText>
          </MvCard>
        </View>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <MvCard style={{ flex: 1 }}>
            <MvText variant="caption" color="secondary">Profissionais</MvText>
            <MvText variant="h2">{overview?.summary?.totalProviders ?? 0}</MvText>
          </MvCard>
          <MvCard style={{ flex: 1 }}>
            <MvText variant="caption" color="secondary">Alunos</MvText>
            <MvText variant="h2">{overview?.summary?.totalClients ?? 0}</MvText>
          </MvCard>
        </View>

        <MvCard>
          <MvText variant="semi2">Novos usuários por dia</MvText>
          <MvText variant="body4" color="secondary" style={{ marginTop: 4 }}>
            Total no mês: {overview?.newUsersChart?.total ?? 0}
          </MvText>

          {(overview?.newUsersChart?.total ?? 0) === 0 && (
            <MvText variant="body4" color="secondary" style={{ paddingTop: 8 }}>
              Nenhum novo usuário registrado neste mês.
            </MvText>
          )}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingTop: 10, alignItems: "flex-end", gap: 6 }}
          >
            {(overview?.newUsersChart?.data ?? []).map((point) => {
              const barHeight = Math.max(6, Math.round((point.usersCount / maxUsersInDay) * 90));
              return (
                <View key={point.date} style={{ width: 20, alignItems: "center", gap: 4 }}>
                  <View
                    style={{
                      width: 12,
                      height: barHeight,
                      borderRadius: 8,
                      backgroundColor: theme.primary
                    }}
                  />
                  <MvText variant="caption" color="secondary">{point.day ?? "—"}</MvText>
                </View>
              );
            })}
          </ScrollView>
        </MvCard>

        <MvCard>
          <MvText variant="semi2">Ranking por região</MvText>
          {(overview?.rankings?.byRegion ?? []).slice(0, 5).map((item) => (
            <View
              key={`region-${item.label ?? "unknown"}`}
              style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}
            >
              <MvText variant="body3">{item.label ?? "Não informado"}</MvText>
              <MvText variant="semi3">{item.bookingsCount}</MvText>
            </View>
          ))}
        </MvCard>

        <MvCard>
          <MvText variant="semi2">Ranking por cidade</MvText>
          {(overview?.rankings?.byCity ?? []).slice(0, 5).map((item) => (
            <View
              key={`city-${item.label ?? "unknown"}`}
              style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}
            >
              <MvText variant="body3">{item.label ?? "Não informado"}</MvText>
              <MvText variant="semi3">{item.bookingsCount}</MvText>
            </View>
          ))}
        </MvCard>

        <MvCard>
          <MvText variant="semi2">Ranking por bairro</MvText>
          {(overview?.rankings?.byNeighborhood ?? []).slice(0, 5).map((item) => (
            <View
              key={`neighborhood-${item.label ?? "unknown"}`}
              style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}
            >
              <MvText variant="body3">{item.label ?? "Não informado"}</MvText>
              <MvText variant="semi3">{item.bookingsCount}</MvText>
            </View>
          ))}
        </MvCard>
      </ScrollView>
    </AdminScaffold>
  );
}
