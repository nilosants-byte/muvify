import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  RefreshControl,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientTabParamList } from "../../navigation/route-types";
import { bookingsApi, Booking } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvAvatar, MvBadge, MvBottomNav, MvButton, MvCard, MvText } from "../../components/mv";
import { handleScreenError } from "../shared/api-helpers";
import { resolveMediaUrl } from "../../utils/media";

type Props = BottomTabScreenProps<ClientTabParamList, "ClientBookings">;
type BookingFilter = "upcoming" | "pending" | "history" | "all";

function useTabNav() {
  const nav = useNavigation() as any;
  return {
    toTab: (screen: keyof ClientTabParamList) => nav.navigate("ClientTabs", { screen }),
    goBack: () => (nav.canGoBack() ? nav.goBack() : nav.navigate("ClientTabs", { screen: "ClientHome" })),
  };
}

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function getInitials(name?: string | null): string {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

function bookingBadge(status: Booking["status"]): { label: string; variant: "green" | "orange" | "gray" | "red" } {
  switch (status) {
    case "CONFIRMED":
      return { label: "Confirmado", variant: "green" };
    case "PENDING":
      return { label: "Pendente", variant: "orange" };
    case "COMPLETED":
      return { label: "Concluido", variant: "gray" };
    default:
      return { label: "Cancelado", variant: "red" };
  }
}

function sortByDateAsc(list: Booking[]) {
  return [...list].sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
  );
}

function sortByDateDesc(list: Booking[]) {
  return [...list].sort(
    (a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()
  );
}

export function ClientBookingsScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const { toTab, goBack } = useTabNav();

  const iconColor = theme.mode === "dark" ? "#D8E0D8" : "#394239";

  const [loading, setLoading] = useState(true);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [activeFilter, setActiveFilter] = useState<BookingFilter>("upcoming");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await runWithAuth((token) => bookingsApi.me(token));
      setBookings(data);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar agenda." });
    } finally {
      setLoading(false);
    }
  }, [runWithAuth, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const goToStack = (screen: string, params?: object) => {
    const parent = navigation.getParent<any>();
    if (parent) parent.navigate(screen, params);
  };

  const goToSearch = () => {
    const parent = navigation.getParent<any>();
    if (parent) parent.navigate("SearchProfessionals");
  };

  const sortedBookings = useMemo(() => sortByDateAsc(bookings), [bookings]);
  const upcomingBookings = useMemo(
    () => sortedBookings.filter((item) => item.status === "PENDING" || item.status === "CONFIRMED"),
    [sortedBookings]
  );
  const pendingBookings = useMemo(
    () => sortedBookings.filter((item) => item.status === "PENDING"),
    [sortedBookings]
  );
  const completedBookings = useMemo(
    () => sortByDateDesc(bookings.filter((item) => item.status === "COMPLETED")),
    [bookings]
  );
  const cancelledBookings = useMemo(
    () => sortByDateDesc(bookings.filter((item) => item.status === "CANCELLED")),
    [bookings]
  );
  const historyBookings = useMemo(
    () => sortByDateDesc([...completedBookings, ...cancelledBookings]),
    [cancelledBookings, completedBookings]
  );
  const nextBooking = upcomingBookings[0] ?? null;

  const filteredBookings = useMemo(() => {
    if (activeFilter === "upcoming") return upcomingBookings;
    if (activeFilter === "pending") return pendingBookings;
    if (activeFilter === "history") return historyBookings;
    return sortedBookings;
  }, [activeFilter, historyBookings, pendingBookings, sortedBookings, upcomingBookings]);

  const filterOptions: Array<{
    key: BookingFilter;
    label: string;
    count: number;
  }> = useMemo(
    () => [
      { key: "upcoming", label: "Próximos", count: upcomingBookings.length },
      { key: "pending", label: "Pendentes", count: pendingBookings.length },
      { key: "history", label: "Histórico", count: historyBookings.length },
      { key: "all", label: "Todos", count: bookings.length },
    ],
    [bookings.length, historyBookings.length, pendingBookings.length, upcomingBookings.length]
  );

  const renderFilterChip = (item: (typeof filterOptions)[number]) => {
    const selected = item.key === activeFilter;
    return (
      <TouchableOpacity
        key={item.key}
        activeOpacity={0.85}
        onPress={() => setActiveFilter(item.key)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: selected ? "rgba(76,175,80,0.35)" : theme.border,
          backgroundColor: selected ? "rgba(76,175,80,0.12)" : theme.inputBg,
          paddingHorizontal: 10,
          paddingVertical: 7,
        }}
      >
        <MvText variant="body4" style={{ color: selected ? theme.textGreen : theme.text2 }}>
          {item.label}
        </MvText>
        <View
          style={{
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: selected ? "rgba(76,175,80,0.24)" : theme.backBtn,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 4,
          }}
        >
          <MvText variant="caption" style={{ color: selected ? theme.textGreen : theme.text2 }}>
            {item.count}
          </MvText>
        </View>
      </TouchableOpacity>
    );
  };

  const renderItem = ({ item }: { item: Booking }) => {
    const date = new Date(item.scheduledAt);
    const badge = bookingBadge(item.status);
    const isFinished = item.status === "COMPLETED" || item.status === "CANCELLED";

    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => goToStack("ClientBookingDetail", { bookingId: item.id })}
        testID={`booking.card.${item.id}`}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          backgroundColor: theme.cardBg,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 12,
          padding: 11,
          marginBottom: 8,
          opacity: isFinished ? 0.75 : 1,
        }}
      >
        <View
          style={{
            width: 40,
            borderRadius: 10,
            backgroundColor: theme.mode === "dark" ? "rgba(76,175,80,0.10)" : "rgba(76,175,80,0.09)",
            borderWidth: 1,
            borderColor: theme.mode === "dark" ? "rgba(76,175,80,0.25)" : "rgba(76,175,80,0.22)",
            paddingVertical: 7,
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <Text style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 16, color: theme.textGreen, lineHeight: 20 }}>
            {date.getDate()}
          </Text>
          <Text
            style={{
              fontFamily: "SpaceGrotesk-Regular",
              fontSize: 9,
              color: theme.text3,
              textTransform: "uppercase",
              letterSpacing: 0.4,
            }}
          >
            {MONTHS_PT[date.getMonth()]}
          </Text>
        </View>

        <MvAvatar
          initials={getInitials(item.provider?.displayName)}
          photoUri={resolveMediaUrl(item.provider?.photoUrl)}
          size={42}
          borderRadius={21}
          color="green"
        />

        <View style={{ flex: 1, gap: 4 }}>
          <MvText variant="semi1">{item.provider?.displayName ?? "Personal"}</MvText>
          <MvText variant="body4" color="secondary">
            {date.toLocaleDateString("pt-BR")} as{" "}
            {date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </MvText>
          <MvBadge label={badge.label} variant={badge.variant} />
        </View>

        <Ionicons name="chevron-forward" size={16} color={theme.text3} />
      </TouchableOpacity>
    );
  };

  const navItems = [
    { key: "home", icon: "compass-outline", label: "Início" },
    { key: "bookings", icon: "calendar-clear-outline", label: "Agenda" },
    { key: "promotions", icon: "flash-outline", label: "Promoções" },
    { key: "training", icon: "barbell-outline", label: "Treino" },
    { key: "profile", icon: "person-circle-outline", label: "Perfil" },
  ];

  const listEmptyText =
    activeFilter === "pending"
      ? "Tudo em dia. Nenhum agendamento pendente."
      : activeFilter === "history"
      ? "Seu histórico ainda não possui agendamentos finalizados."
      : activeFilter === "upcoming"
      ? "Nenhum treino futuro encontrado."
      : "Nenhum agendamento encontrado nesta visão.";

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.client.bookings">
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      <View
        style={{
          paddingTop: insets.top + 10,
          paddingHorizontal: 14,
          paddingBottom: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          borderBottomWidth: 1,
          borderBottomColor: theme.borderSub,
        }}
      >
        <TouchableOpacity
          onPress={goBack}
          style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <MvText variant="semi1">Agenda</MvText>
          <MvText variant="body4" color="secondary">
            Organize seus agendamentos e próximos treinos.
          </MvText>
        </View>
        <MvBadge label={`${upcomingBookings.length} ativos`} variant={upcomingBookings.length ? "green" : "gray"} />
      </View>

      <FlatList
        data={filteredBookings}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 90, paddingTop: 4 }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor="#4CAF50" colors={["#4CAF50"]} />
        }
        ListHeaderComponent={
          <View style={{ gap: 10, marginBottom: 8 }}>
            <MvCard style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <MvText variant="semi2">Panorama da semana</MvText>
                <Ionicons name="calendar-outline" size={16} color={iconColor} />
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 8, backgroundColor: theme.inputBg }}>
                  <MvText variant="h3" style={{ color: theme.textGreen }}>
                    {upcomingBookings.length}
                  </MvText>
                  <MvText variant="caption" color="secondary">
                    Proximos
                  </MvText>
                </View>
                <View style={{ flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 8, backgroundColor: theme.inputBg }}>
                  <MvText variant="h3" style={{ color: theme.textGreen }}>
                    {pendingBookings.length}
                  </MvText>
                  <MvText variant="caption" color="secondary">
                    Pendentes
                  </MvText>
                </View>
                <View style={{ flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 8, backgroundColor: theme.inputBg }}>
                  <MvText variant="h3" style={{ color: theme.textGreen }}>
                    {completedBookings.length}
                  </MvText>
                  <MvText variant="caption" color="secondary">
                    Concluidos
                  </MvText>
                </View>
              </View>

              {nextBooking ? (
                <View
                  style={{
                    borderWidth: 1,
                    borderColor: "rgba(76,175,80,0.30)",
                    borderRadius: 10,
                    backgroundColor: theme.mode === "dark" ? "rgba(76,175,80,0.08)" : "rgba(76,175,80,0.10)",
                    padding: 10,
                    gap: 3,
                  }}
                >
                  <MvText variant="caption" color="secondary">
                    Proximo treino
                  </MvText>
                  <MvText variant="semi3">{nextBooking.provider?.displayName ?? "Personal"}</MvText>
                  <MvText variant="body4" color="secondary">
                    {new Date(nextBooking.scheduledAt).toLocaleDateString("pt-BR")} as{" "}
                    {new Date(nextBooking.scheduledAt).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </MvText>
                </View>
              ) : (
                  <MvText variant="body4" color="secondary">
                    Você ainda não tem treinos futuros. Encontre um novo personal para seguir evoluindo.
                  </MvText>
                )}

              <MvButton variant="outline" label="Encontrar personal" onPress={goToSearch} />
            </MvCard>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {filterOptions.map((item) => renderFilterChip(item))}
            </View>
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <View style={{ paddingTop: 34, alignItems: "center", gap: 8 }}>
              <View
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: theme.cardBg,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="calendar-outline" size={25} color={theme.textGreen} />
              </View>
              <MvText variant="body3" color="secondary">
                {listEmptyText}
              </MvText>
            </View>
          ) : null
        }
        showsVerticalScrollIndicator={false}
      />

      <MvBottomNav
        items={navItems}
        activeKey="bookings"
        onPress={(key) => {
          if (key === "home") toTab("ClientHome");
          if (key === "promotions") toTab("Promotions");
          if (key === "training") toTab("MyTraining");
          if (key === "profile") toTab("ClientProfile");
        }}
      />
    </View>
  );
}
