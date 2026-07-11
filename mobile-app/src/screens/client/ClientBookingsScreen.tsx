import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, StatusBar, Text, TouchableOpacity, View } from "react-native";
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientTabParamList } from "../../navigation/route-types";
import { bookingsApi, Booking } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { MvAvatar } from "../../components/mv";
import { handleScreenError } from "../shared/api-helpers";
import { resolveMediaUrl } from "../../utils/media";
import { useMvTheme } from "../../theme/MvThemeContext";
import type { MvTheme } from "../../theme/MvColors";
import { C, S, DISPLAY } from "../../theme/v2tokens";
import { ClientBottomNavV2 } from "../../components/navigation/ClientBottomNavV2";
import { PressableScale } from "../../components/polish/PressableScale";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { SkeletonBookingCard } from "../../components/polish/SkeletonCard";
import { formatBRDateTime } from "../../utils/formatters";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";

type Props = BottomTabScreenProps<ClientTabParamList, "ClientBookings">;
type BookingFilter = "upcoming" | "pending" | "history" | "all";

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function isToday(dateIso: string) {
  const d = new Date(dateIso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function useTabNav() {
  const nav = useNavigation() as any;
  return {
    toTab: (screen: keyof ClientTabParamList) => nav.navigate("ClientTabs", { screen }),
    goBack: () => (nav.canGoBack() ? nav.goBack() : nav.navigate("ClientTabs", { screen: "ClientHome" })),
  };
}

function getInitials(name?: string | null): string {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

function badgeStyle(status: Booking["status"], theme: MvTheme): { label: string; color: string; bg: string; border: string } {
  const isDark = theme.mode === "dark";
  if (status === "CONFIRMED") return { label: "Confirmado", color: theme.primary, bg: theme.primarySubtle, border: theme.primarySubtleBorder };
  if (status === "PENDING") return { label: "Pendente", color: C.amber, bg: C.amberDim, border: C.amberBorder };
  if (status === "COMPLETED") return { label: "Concluído", color: theme.text2, bg: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", border: theme.border };
  return { label: "Cancelado", color: theme.danger, bg: isDark ? "rgba(239,68,68,0.12)" : "rgba(220,38,38,0.09)", border: isDark ? "rgba(239,68,68,0.20)" : "rgba(220,38,38,0.15)" };
}

function sortByDateAsc(list: Booking[]) {
  return [...list].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
}
function sortByDateDesc(list: Booking[]) {
  return [...list].sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());
}

export function ClientBookingsScreen({ navigation }: Props) {
  const { showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const { toTab } = useTabNav();
  const [activeFilter, setActiveFilter] = useState<BookingFilter>("upcoming");

  const bookingsQuery = useAuthQuery(queryKeys.bookings.me(), (token) => bookingsApi.me(token));
  const bookings = bookingsQuery.data ?? [];

  useFocusEffect(useCallback(() => { void bookingsQuery.refetch(); return undefined; }, [bookingsQuery.refetch]));

  useEffect(() => {
    if (bookingsQuery.error) {
      handleScreenError({ error: bookingsQuery.error, showToast, fallbackMessage: "Falha ao carregar agenda." });
    }
  }, [bookingsQuery.error, showToast]);

  const goToStack = (screen: string, params?: object) => {
    const parent = navigation.getParent<any>();
    if (parent) parent.navigate(screen, params);
  };

  const goToSearch = () => {
    const parent = navigation.getParent<any>();
    if (parent) parent.navigate("SearchProfessionals");
  };

  const sorted = useMemo(() => sortByDateAsc(bookings), [bookings]);
  const upcoming = useMemo(() => sorted.filter((b) => b.status === "PENDING" || b.status === "CONFIRMED"), [sorted]);
  const pending = useMemo(() => sorted.filter((b) => b.status === "PENDING"), [sorted]);
  const completed = useMemo(() => sortByDateDesc(bookings.filter((b) => b.status === "COMPLETED")), [bookings]);
  const cancelled = useMemo(() => sortByDateDesc(bookings.filter((b) => b.status === "CANCELLED")), [bookings]);
  const history = useMemo(() => sortByDateDesc([...completed, ...cancelled]), [cancelled, completed]);
  const nextBooking = upcoming[0] ?? null;

  const HISTORY_LIMIT = 30;
  const filtered = useMemo(() => {
    if (activeFilter === "upcoming") return upcoming;
    if (activeFilter === "pending") return pending;
    if (activeFilter === "history") return history.slice(0, HISTORY_LIMIT);
    return sorted.slice(0, HISTORY_LIMIT);
  }, [activeFilter, history, pending, sorted, upcoming]);

  const filterOptions: Array<{ key: BookingFilter; label: string; count: number }> = useMemo(() => [
    { key: "upcoming", label: "Próximos", count: upcoming.length },
    { key: "pending", label: "Pendentes", count: pending.length },
    { key: "history", label: "Histórico", count: history.length },
    { key: "all", label: "Todos", count: bookings.length },
  ], [bookings.length, history.length, pending.length, upcoming.length]);

  const emptyText =
    activeFilter === "pending" ? "Tudo em dia. Nenhum agendamento pendente." :
    activeFilter === "history" ? "Seu histórico ainda não possui agendamentos finalizados." :
    activeFilter === "upcoming" ? "Nenhum treino futuro encontrado." :
    "Nenhum agendamento nesta visão.";

  const renderItem = ({ item }: { item: Booking }) => {
    const date = new Date(item.scheduledAt);
    const bs = badgeStyle(item.status, theme);
    const isFinished = item.status === "COMPLETED" || item.status === "CANCELLED";

    return (
      <PressableScale
        onPress={() => goToStack("ClientBookingDetail", { bookingId: item.id })}
        testID={`booking.card.${item.id}`}
        style={{
          flexDirection: "row", alignItems: "center", gap: 12,
          backgroundColor: theme.cardBg, borderWidth: 1, borderColor: theme.border,
          borderRadius: S.cardR, padding: S.cardPad,
          opacity: isFinished ? 0.72 : 1,
        }}
      >
        {/* Data badge V2 */}
        <View style={{
          width: 44, borderRadius: 14,
          backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder,
          paddingVertical: 8, alignItems: "center", flexShrink: 0,
        }}>
          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 18, color: theme.text1, letterSpacing: -0.013 * 18 }}>
            {date.getDate()}
          </Text>
          <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 9, color: theme.text2, textTransform: "uppercase", letterSpacing: 0.5 }}>
            {MONTHS_PT[date.getMonth()]}
          </Text>
        </View>

        <MvAvatar
          initials={getInitials(item.provider?.displayName)}
          photoUri={resolveMediaUrl(item.provider?.photoUrl)}
          tone="green"
          size="md"
        />

        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }} numberOfLines={1}>
            {item.provider?.displayName ?? "Personal"}
          </Text>
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2 }}>
            {formatBRDateTime(item.scheduledAt)}
          </Text>
          <View style={{ backgroundColor: bs.bg, borderWidth: 1, borderColor: bs.border, borderRadius: S.chipR, paddingHorizontal: 8, paddingVertical: 2, alignSelf: "flex-start" }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: bs.color }}>{bs.label}</Text>
          </View>
        </View>

        <Ionicons name="chevron-forward" size={16} color={theme.labelColor} />
      </PressableScale>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.client.bookings">
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      {/* Header V2 */}
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: theme.border, flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 24, color: theme.text1, letterSpacing: -0.3 }}>Agenda</Text>
          <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 11, color: theme.text3, marginTop: 2 }}>somente aulas presenciais</Text>
        </View>
        <TouchableOpacity
          onPress={goToStack.bind(null, "SearchProfessionals")}
          accessibilityRole="button"
          accessibilityLabel="Novo agendamento"
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="add" size={20} color={theme.primary} />
        </TouchableOpacity>
      </View>

      <ScreenEntrance>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingHorizontal: S.px, paddingBottom: 120, paddingTop: 16, gap: 10 }}
        refreshControl={<RefreshControl refreshing={bookingsQuery.isRefetching} onRefresh={() => void bookingsQuery.refetch()} tintColor={theme.primary} colors={[theme.primary]} />}
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 4 }}>
            {/* Hero card panorama V2 */}
            <View style={{ borderRadius: S.cardR, padding: 16, borderWidth: 1, borderColor: theme.primarySubtleBorder, backgroundColor: "rgba(36,230,109,0.09)" }}>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 10, color: theme.primary, letterSpacing: 0.1 * 10, textTransform: "uppercase", fontWeight: "700" }}>
                próximo compromisso
              </Text>
              {nextBooking ? (
                <>
                  <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 22, color: theme.text1, letterSpacing: -0.02 * 22, marginTop: 8 }}>
                    {isToday(nextBooking.scheduledAt)
                      ? `Hoje às ${new Date(nextBooking.scheduledAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}`
                      : new Date(nextBooking.scheduledAt).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short", timeZone: "America/Sao_Paulo" }) +
                        " às " +
                        new Date(nextBooking.scheduledAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}
                  </Text>
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, marginTop: 6 }}>
                    {nextBooking.provider?.displayName ?? "Personal"} · {nextBooking.notes ?? "Aula presencial"}
                  </Text>
                  {nextBooking.status === "PENDING" && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, backgroundColor: C.amberDim, borderWidth: 1, borderColor: C.amberBorder, borderRadius: S.chipR, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" }}>
                      <Ionicons name="time-outline" size={13} color={C.amber} />
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: C.amber }}>Aguardando confirmação do profissional</Text>
                    </View>
                  )}
                </>
              ) : (
                <>
                  <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 22, color: theme.text1, letterSpacing: -0.02 * 22, marginTop: 8 }}>
                    Nenhum treino agendado
                  </Text>
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, marginTop: 6 }}>
                    Encontre um personal e agende sua sessão.
                  </Text>
                  <TouchableOpacity
                    onPress={goToSearch}
                    style={{ marginTop: 12, height: S.btnH, borderRadius: S.btnR, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", shadowColor: theme.primary, shadowOpacity: 0.28, shadowRadius: 10, elevation: 4 }}
                  >
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.textOnPrimary }}>Encontrar personal</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            {/* Stats mini */}
            <View style={{ flexDirection: "row", gap: 8 }}>
              {[
                { label: "Próximos", value: upcoming.length, color: theme.primary },
                { label: "Pendentes", value: pending.length, color: C.amber },
                { label: "Concluídos", value: completed.length, color: theme.text2 },
              ].map((s) => (
                <View key={s.label} style={{ flex: 1, backgroundColor: theme.cardBg, borderWidth: 1, borderColor: theme.border, borderRadius: 16, padding: 10, alignItems: "center" }}>
                  <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 20, color: s.color, letterSpacing: -0.013 * 20 }}>{s.value}</Text>
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 10, color: theme.text3, marginTop: 2 }}>{s.label}</Text>
                </View>
              ))}
            </View>

            {/* Filter tabs V2 */}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {filterOptions.map((item) => {
                const active = item.key === activeFilter;
                return (
                  <TouchableOpacity
                    key={item.key}
                    onPress={() => setActiveFilter(item.key)}
                    style={{
                      height: 36, paddingHorizontal: 14, borderRadius: S.chipR,
                      flexDirection: "row", alignItems: "center", gap: 6,
                      borderWidth: 1,
                      borderColor: active ? theme.primarySubtleBorder : theme.border,
                      backgroundColor: active ? theme.primarySubtle : "rgba(255,255,255,0.04)",
                    }}
                  >
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: active ? theme.primary : theme.text2 }}>{item.label}</Text>
                    <View style={{ backgroundColor: active ? "rgba(36,230,109,0.22)" : "rgba(255,255,255,0.08)", borderRadius: 99, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}>
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: active ? theme.primary : theme.text3 }}>{item.count}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        }
        ListEmptyComponent={
          bookingsQuery.isLoading ? (
            <View style={{ gap: 10, paddingTop: 4 }}>
              {[0, 1, 2].map((i) => <SkeletonBookingCard key={i} />)}
            </View>
          ) : (
            <View style={{ paddingTop: 40, alignItems: "center", gap: 10 }}>
              <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="calendar-outline" size={28} color={theme.primary} />
              </View>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3, textAlign: "center" }}>{emptyText}</Text>
            </View>
          )
        }
        showsVerticalScrollIndicator={false}
      />
      </ScreenEntrance>

      <ClientBottomNavV2
        activeTab="agenda"
        onNavigate={(tab) => {
          if (tab === "home") toTab("ClientHome");
          if (tab === "trainings") toTab("MyTraining");
          if (tab === "community") toTab("Community");
          if (tab === "profile") toTab("ClientProfile");
        }}
      />
    </View>
  );
}
