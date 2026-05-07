import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StatusBar,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Rect } from "react-native-svg";
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProfessionalTabParamList } from "../../navigation/route-types";
import {
  ApiError,
  Availability,
  availabilityApi,
  Booking,
  bookingsApi,
  consultancyApi,
  notificationsApi,
  ProviderServiceOffer,
  ProviderTimelineResponse,
  providersApi,
  userApi,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvAvatar, MvBadge, MvCard, MvText, MvToggle } from "../../components/mv";
import { ProfessionalBottomNav } from "../../components/navigation/ProfessionalBottomNav";
import { AppLogoText } from "../../components/ui/AppLogoText";
import { formatCurrencyBRL } from "../../utils/formatters";
import { resolveMediaUrl } from "../../utils/media";
import { handleScreenError } from "../shared/api-helpers";
import { ServiceAreaInlineSection } from "./components/ServiceAreaInlineSection";
import { ProfessionalNotificationsDrawer } from "./components/ProfessionalNotificationsDrawer";
import {
  countUnreadNotifications,
  loadDismissedNotificationIds,
  loadSeenNotificationIds,
} from "../../utils/notificationsReadState";

type Props = BottomTabScreenProps<ProfessionalTabParamList, "ProfessionalHome">;

function isToday(dateIso: string) {
  const date = new Date(dateIso);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function isCurrentWeek(dateIso: string) {
  const date = new Date(dateIso);
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(now.getDate() - now.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return date >= start && date < end;
}

function bookingStatusBadge(status: Booking["status"]) {
  if (status === "COMPLETED") return { label: "Concluído", variant: "green" as const };
  if (status === "CANCELLED") return { label: "Cancelado", variant: "red" as const };
  if (status === "CONFIRMED") return { label: "Confirmado", variant: "green" as const };
  return { label: "Pendente", variant: "orange" as const };
}

type ShortcutKey = "addStudent" | "newTraining" | "addSlot" | "newConsultancy";

const SHORTCUTS: Array<{
  key: ShortcutKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { key: "addStudent",     label: "Adicionar\naluno",     icon: "person-add-outline" },
  { key: "newTraining",    label: "Novo\ntreino",         icon: "barbell-outline" },
  { key: "addSlot",        label: "Adicionar\nhorário",   icon: "calendar-outline" },
  { key: "newConsultancy", label: "Nova\nconsultoria",    icon: "chatbubble-ellipses-outline" },
];

const DAY_LABELS = ["D", "S", "T", "Q", "Q", "S", "S"];

// ─── Mini bar chart ───────────────────────────────────────────────────────────
function WeeklyBarChart({
  data,
  primaryColor,
  barBg,
}: {
  data: { label: string; revenue: number; isToday: boolean }[];
  primaryColor: string;
  barBg: string;
}) {
  const maxRevenue = Math.max(...data.map((d) => d.revenue), 1);
  const chartH = 52;
  const barW = 18;
  const gap = 10;
  const totalW = data.length * (barW + gap) - gap;

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: gap, marginTop: 8 }}>
      {data.map((d, i) => {
        const barH = Math.max(4, Math.round((d.revenue / maxRevenue) * chartH));
        return (
          <View key={i} style={{ alignItems: "center", gap: 4 }}>
            <Svg width={barW} height={chartH}>
              {/* background track */}
              <Rect
                x={0}
                y={0}
                width={barW}
                height={chartH}
                rx={5}
                fill={barBg}
              />
              {/* filled bar */}
              <Rect
                x={0}
                y={chartH - barH}
                width={barW}
                height={barH}
                rx={5}
                fill={d.isToday ? primaryColor : `${primaryColor}80`}
              />
            </Svg>
            <Text
              style={{
                fontSize: 10,
                color: d.isToday ? primaryColor : "#6B7280",
                fontFamily: "DMSans-Medium",
                lineHeight: 12,
              }}
            >
              {d.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ─── Activity timeline item ───────────────────────────────────────────────────
function ActivityItem({
  iconName,
  iconColor,
  iconBg,
  title,
  subtitle,
  timeLabel,
  valueLabel,
  onPress,
  borderColor,
}: {
  iconName: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle?: string;
  timeLabel: string;
  valueLabel?: string;
  onPress?: () => void;
  borderColor: string;
}) {
  const inner = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor,
        backgroundColor: iconBg,
        paddingHorizontal: 14,
        paddingVertical: 12,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: `${iconColor}22`,
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Ionicons name={iconName} size={18} color={iconColor} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <MvText variant="semi3" numberOfLines={1}>{title}</MvText>
        {subtitle ? (
          <MvText variant="body4" color="secondary" numberOfLines={1}>{subtitle}</MvText>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        {valueLabel ? (
          <MvText variant="semi3" style={{ color: "#22C55E" }}>{valueLabel}</MvText>
        ) : null}
        <MvText variant="body4" color="secondary">{timeLabel}</MvText>
      </View>
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.8} onPress={onPress}>
        {inner}
      </TouchableOpacity>
    );
  }
  return inner;
}

function getProfessionalGreeting() {
  const h = new Date().getHours();
  if (h < 12) return { text: "Bom dia", icon: "sunny-outline" as const };
  if (h < 18) return { text: "Boa tarde", icon: "partly-sunny-outline" as const };
  return { text: "Boa noite", icon: "moon-outline" as const };
}

// ─── Main screen ─────────────────────────────────────────────────────────────
export function ProfessionalHomeScreen({ navigation }: Props) {
  const { runWithAuth, setCurrentUser, showToast, user, signOut } = useAppState();
  const { theme, isDark, toggleTheme } = useMvTheme();
  const isLight = theme.mode === "light";
  const insets = useSafeAreaInsets();
  const SCREEN_W = Dimensions.get("window").width;
  const DRAWER_W = Math.min(SCREEN_W * 0.82, 320);

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [offers, setOffers] = useState<ProviderServiceOffer[]>([]);
  const [timeline, setTimeline] = useState<ProviderTimelineResponse | null>(null);
  const [availabilities, setAvailabilities] = useState<Availability[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCrefPopup, setShowCrefPopup] = useState(false);
  const [showProfileSetupPopup, setShowProfileSetupPopup] = useState(false);
  const [providerProfileMfssfng, setProviderProffleMfssfng] = useState(false);
  const [providerPhotoUrl, setProviderPhotoUrl] = useState<string | null>(
    () => resolveMediaUrl(user?.providerProfile?.photoUrl, true)
  );
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [notificationsDrawerOpen, setNotificationsDrawerOpen] = useState(false);
  const [sideDrawerOpen, setSideDrawerOpen] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(true);
  const drawerAnim = useRef(new Animated.Value(-DRAWER_W)).current;
  const crefChecked = useRef(false);
  const profileChecked = useRef(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [bookingResponse, offersResponse, me, credentials, timelineResponse, availabilitiesResponse] =
        await Promise.all([
          runWithAuth((token) => bookingsApi.me(token)).catch(() => [] as Booking[]),
          runWithAuth((token) => consultancyApi.providerOffers(token)).catch(
            () => [] as ProviderServiceOffer[]
          ),
          runWithAuth((token) => userApi.me(token)).catch(() => null),
          runWithAuth((token) => providersApi.myCredentials(token)).catch((error) => {
            if (error instanceof ApiError && error.status === 404) return null;
            throw error;
          }),
          runWithAuth((token) => providersApi.getTimeline(token)).catch(() => null),
          runWithAuth((token) => availabilityApi.me(token)).catch(() => [] as Availability[]),
        ]);

      const mine = bookingResponse.filter((item) => item.provider?.user?.id === user?.id);
      setBookings(mine);
      setOffers(offersResponse);
      setTimeline(timelineResponse);
      setAvailabilities(availabilitiesResponse);

      if (me) setCurrentUser(me);

      const profile = me?.providerProfile ?? null;
      setProviderPhotoUrl(resolveMediaUrl(profile?.photoUrl, true));
      setProviderProffleMfssfng(!Boolean(profile));

      if (!Boolean(profile) && !profileChecked.current) {
        setShowProfileSetupPopup(true);
        profileChecked.current = true;
      }
      if (Boolean(profile)) setShowProfileSetupPopup(false);
      const crefStatus = credentials?.crefValidationStatus ?? "PENDING";
      const crefApproved = crefStatus === "APPROVED";
      if (Boolean(profile) && !crefChecked.current && credentials && !crefApproved) {
        setShowCrefPopup(true);
        crefChecked.current = true;
      }
      if (Boolean(profile) && crefApproved) {
        setShowCrefPopup(false);
      }
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao carregar painel profissional.",
        navigation,
      });
    } finally {
      setLoading(false);
    }
  }, [navigation, runWithAuth, setCurrentUser, showToast, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setProviderPhotoUrl(resolveMediaUrl(user?.providerProfile?.photoUrl, true));
  }, [user?.name, user?.providerProfile]);

  const refreshUnreadNotfffcatfonCount = useCallback(async () => {
    try {
      const userId = user?.id ?? "anonymous";
      const [inbox, seenIds, dismissedIds] = await Promise.all([
        runWithAuth((token) => notificationsApi.inbox(token, 120)),
        loadSeenNotificationIds(userId),
        loadDismissedNotificationIds(userId),
      ]);
      setUnreadNotifCount(countUnreadNotifications(inbox, seenIds, dismissedIds));
    } catch {
      // best effort
    }
  }, [runWithAuth, user?.id]);

  useFocusEffect(
    useCallback(() => {
      void refreshUnreadNotfffcatfonCount();
    }, [refreshUnreadNotfffcatfonCount])
  );

  // ── Derfved data ────────────────────────────────────────────────────────────
  const fullProfessionalName = useMemo(() => {
    const n = user?.providerProfile?.displayName?.trim() || user?.name?.trim();
    return n || "Profissional";
  }, [user?.name, user?.providerProfile?.displayName]);

  const greetingName = useMemo(
    () => fullProfessionalName.split(/\s+/)[0]?.trim() || "Profissional",
    [fullProfessionalName]
  );

  const greeting = useMemo(() => getProfessionalGreeting(), []);

  const initials = useMemo(() => {
    const parts = fullProfessionalName.trim().split(/\s+/);
    return parts.length === 1
      ? (parts[0]?.slice(0, 2) ?? "PR").toUpperCase()
      : `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }, [fullProfessionalName]);

  const todayBookings = useMemo(
    () =>
      bookings
        .filter((b) => (b.status === "CONFIRMED" || b.status === "PENDING") && isToday(b.scheduledAt))
        .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()),
    [bookings]
  );

  const nextBooking = useMemo(() => todayBookings[0] ?? null, [todayBookings]);

  const confirmedToday = useMemo(
    () => bookings.filter((b) => b.status === "CONFIRMED" && isToday(b.scheduledAt)).length,
    [bookings]
  );

  const activeStudents = useMemo(
    () =>
      new Set(
        bookings
          .filter((b) => b.status === "CONFIRMED" || b.status === "COMPLETED")
          .map((b) => b.client?.id)
          .filter(Boolean)
      ).size,
    [bookings]
  );

  const weeklyRevenue = useMemo(() => {
    const cents = bookings
      .filter((b) => b.status === "COMPLETED" && isCurrentWeek(b.completedAt ?? b.scheduledAt))
      .reduce((s, b) => s + (b.priceCents ?? 0), 0);
    return cents / 100;
  }, [bookings]);

  const lastWeekRevenue = useMemo(() => {
    const now = new Date();
    const startOfThfsWeek = new Date(now);
    startOfThfsWeek.setHours(0, 0, 0, 0);
    startOfThfsWeek.setDate(now.getDate() - now.getDay());
    const startOfLastWeek = new Date(startOfThfsWeek);
    startOfLastWeek.setDate(startOfThfsWeek.getDate() - 7);
    const cents = bookings
      .filter((b) => {
        if (b.status !== "COMPLETED") return false;
        const d = new Date(b.completedAt ?? b.scheduledAt);
        return d >= startOfLastWeek && d < startOfThfsWeek;
      })
      .reduce((s, b) => s + (b.priceCents ?? 0), 0);
    return cents / 100;
  }, [bookings]);

  const weeklyRevenueChange = useMemo(() => {
    if (lastWeekRevenue === 0) return null;
    return ((weeklyRevenue - lastWeekRevenue) / lastWeekRevenue) * 100;
  }, [weeklyRevenue, lastWeekRevenue]);

  const weeklyChartData = useMemo(() => {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setHours(0, 0, 0, 0);
    startOfWeek.setDate(now.getDate() - now.getDay());
    return DAY_LABELS.map((label, f) => {
      const dayStart = new Date(startOfWeek);
      dayStart.setDate(startOfWeek.getDate() + f);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayStart.getDate() + 1);
      const revenue =
        bookings
          .filter((b) => {
            if (b.status !== "COMPLETED") return false;
            const d = new Date(b.completedAt ?? b.scheduledAt);
            return d >= dayStart && d < dayEnd;
          })
          .reduce((s, b) => s + (b.priceCents ?? 0), 0) / 100;
      return { label, revenue, isToday: f === now.getDay() };
    });
  }, [bookings]);

  const todayFreeSlots = useMemo(() => {
    const todayWeekday = new Date().getDay();
    return availabilities
      .filter((a) => a.weekday === todayWeekday && a.isActive)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [availabilities]);

  const pendingCount = useMemo(
    () => bookings.filter((b) => b.status === "PENDING").length,
    [bookings]
  );

  // ── Navigation helpers ───────────────────────────────────────────────────────
  const goToStack = (screen: string, params?: object) => {
    const parent = navigation.getParent<any>();
    if (parent) parent.navigate(screen, params);
  };

  const goHome = () => navigation.navigate("ProfessionalHome");

  const handleShortcut = (key: ShortcutKey) => {
    if (key === "addStudent") goToStack("ProfessionalStudents");
    else if (key === "newTraining") goToStack("TrainingCreation");
    else if (key === "addSlot") goToStack("AvailabilityManager");
    else if (key === "newConsultancy") goToStack("ProfessionalConsultancyCenter");
  };

  // ── Colors ───────────────────────────────────────────────────────────────────
  // ── Drawer lateral ──────────────────────────────────────────────────────────
  const APP_STORE_ID = "000000000";
  const PLAY_STORE_ID = "com.personalapp.mobile";

  const openDrawer = () => {
    setSideDrawerOpen(true);
    Animated.spring(drawerAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
  };

  const closeDrawer = () => {
    Animated.timing(drawerAnim, {
      toValue: -DRAWER_W,
      duration: 220,
      useNativeDriver: true,
    }).start(() => setSideDrawerOpen(false));
  };

  const handleSignOut = () => {
    Alert.alert("Sair da conta", "Tem certeza que deseja sair?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Sair", style: "destructive", onPress: () => { closeDrawer(); void signOut(); } },
    ]);
  };

  const handleShareApp = () => {
    void Share.share({
      message: "Conheça o Muvify, o app para personal trainers gerenciarem seus alunos e agenda!",
      title: "Muvify",
    });
  };

  const handleRateApp = () => {
    const url = Platform.OS === "ios"
      ? `itms-apps://itunes.apple.com/app/id${APP_STORE_ID}?action=write-review`
      : `market://details?id=${PLAY_STORE_ID}`;
    Linking.openURL(url).catch(() => {
      const fallback = Platform.OS === "ios"
        ? `https://apps.apple.com/app/id${APP_STORE_ID}`
        : `https://play.google.com/store/apps/details?id=${PLAY_STORE_ID}`;
      Linking.openURL(fallback);
    });
  };

  const bg = theme.bg;
  const cardBg = theme.cardBg;
  const green = theme.textGreen;
  const border = theme.border;
  const borderSub = theme.borderSub;
  const text1 = theme.text1;
  const text2 = theme.text2;
  const text3 = theme.text3;
  const inputBg = theme.inputBg;
  const barBg = isLight ? "rgba(15,23,42,0.06)" : "rgba(255,255,255,0.06)";
  const heroBg = isLight ? "rgba(34,197,94,0.05)" : "#0F1A12";
  const heroBorder = isLight ? "rgba(34,197,94,0.18)" : "rgba(34,197,94,0.18)";

  // Paleta do drawer lateral — branco no light, tema normal no dark
  const drawerText  = isLight ? "#FFFFFF" : text1;
  const drawerSub   = isLight ? "rgba(255,255,255,0.80)" : text2;
  const drawerMuted = isLight ? "rgba(255,255,255,0.55)" : text3;
  const drawerDivider = isLight ? "rgba(21,128,61,0.10)" : "rgba(255,255,255,0.06)";

  // ── Subtitle dfnâmica ────────────────────────────────────────────────────────
  const headerSubtitle = useMemo(() => {
    if (pendingCount > 0)
      return `${pendingCount} pendente${pendingCount > 1 ? "s" : ""} para confirmar`;
    if (confirmedToday > 0)
      return `Você tem ${confirmedToday} atendimento${confirmedToday > 1 ? "s" : ""} hoje`;
    return "Tudo em dia por enquanto";
  }, [pendingCount, confirmedToday]);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: bg }} testID="screen.professional.home">
      <StatusBar barStyle={isLight ? "dark-content" : "light-content"} backgroundColor={bg} />

      {/* ── HEADER ── */}
      <View
        style={{
          paddingTop: insets.top + 14,
          paddingHorizontal: 16,
          paddingBottom: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <TouchableOpacity onPress={openDrawer} activeOpacity={0.8}>
          <MvAvatar
            initials={initials}
            size={40}
            borderRadius={20}
            color="green"
            photoUri={providerPhotoUrl}
          />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <MvText variant="semi2">{greeting.text}, {greetingName}</MvText>
            <Ionicons name={greeting.icon} size={15} color={green} />
          </View>
          <MvText variant="body4" color="secondary" numberOfLines={1}>
            {headerSubtitle}
          </MvText>
        </View>

        <TouchableOpacity onPress={goHome} activeOpacity={0.7}>
          <AppLogoText size={18} />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setNotificationsDrawerOpen(true)}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: isLight ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.08)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="notifications-outline" size={20} color={isLight ? "#222" : "#ccc"} />
          {unreadNotifCount > 0 ? (
            <View
              style={{
                position: "absolute",
                top: -3,
                right: -3,
                minWidth: 18,
                height: 18,
                borderRadius: 9,
                backgroundColor: "#f44336",
                borderWidth: 1.5,
                borderColor: isLight ? "#fff" : "#080e08",
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 3,
              }}
            >
              <Text
                style={{
                  color: "#fff",
                  fontSize: 10,
                  fontWeight: "700",
                  lineHeight: 13,
                }}
              >
                {unreadNotifCount > 99 ? "99+" : String(unreadNotifCount)}
              </Text>
            </View>
          ) : null}
        </TouchableOpacity>
      </View>

      {/* ── CONTENT ── */}
      <FlatList
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, gap: 14 }}
        data={[]}
        keyExtractor={() => ""}
        renderItem={null}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={load}
            tintColor={green}
            colors={[green]}
          />
        }
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={{ gap: 14 }}>

            {/* ── ServiceArea (compacto, sem destaque visual) ── */}
            <ServiceAreaInlineSection onSaved={() => void load()} />

            {/* ── HERO: RECEITA SEMANAL ── */}
            <TouchableOpacity
              activeOpacity={0.88}
              onPress={() => goToStack("PayoutStatus")}
              style={{
                borderRadius: 16,
                padding: 20,
                borderWidth: 1,
                backgroundColor: heroBg,
                borderColor: heroBorder,
              }}
            >
              {/* Cabeçalho do card */}
              <View
                style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}
              >
                <View style={{ flex: 1 }}>
                  <MvText variant="caption" color="secondary">
                    RECEITA SEMANAL
                  </MvText>
                  <MvText
                    variant="hero"
                    style={{ color: green, marginTop: 4, letterSpacing: -1 }}
                  >
                    {formatCurrencyBRL(weeklyRevenue)}
                  </MvText>
                </View>

                {weeklyRevenueChange !== null ? (
                  <View
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      borderRadius: 20,
                      backgroundColor:
                        weeklyRevenueChange >= 0
                          ? "rgba(34,197,94,0.15)"
                          : "rgba(239,68,68,0.12)",
                      borderWidth: 1,
                      borderColor:
                        weeklyRevenueChange >= 0
                          ? "rgba(34,197,94,0.25)"
                          : "rgba(239,68,68,0.20)",
                      alignSelf: "flex-start",
                      marginTop: 4,
                    }}
                  >
                    <MvText
                      variant="body4"
                      style={{
                        color: weeklyRevenueChange >= 0 ? green : "#EF4444",
                        fontFamily: "DMSans-SemiBold",
                      }}
                    >
                      {weeklyRevenueChange >= 0 ? "+" : ""}
                      {weeklyRevenueChange.toFixed(1)}% vs sem. passada
                    </MvText>
                  </View>
                ) : null}
              </View>

              {/* Gráfico de barras */}
              <WeeklyBarChart
                data={weeklyChartData}
                primaryColor={green}
                barBg={barBg}
              />
            </TouchableOpacity>

            {/* ── GRID DE MÉTRICAS ── */}
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View
                style={{
                  flex: 1,
                  borderRadius: 16,
                  padding: 16,
                  borderWidth: 1,
                  backgroundColor: cardBg,
                  borderColor: border,
                }}
              >
                <MvText variant="h1" style={{ color: text1 }}>
                  {activeStudents}
                </MvText>
                <MvText variant="body4" color="secondary" style={{ marginTop: 2 }}>
                  Alunos atfvos
                </MvText>
              </View>
              <View
                style={{
                  flex: 1,
                  borderRadius: 16,
                  padding: 16,
                  borderWidth: 1,
                  backgroundColor: cardBg,
                  borderColor: border,
                }}
              >
                <MvText variant="h1" style={{ color: text1 }}>
                  {confirmedToday}
                </MvText>
                <MvText variant="body4" color="secondary" style={{ marginTop: 2 }}>
                  Sessões hoje
                </MvText>
              </View>
            </View>

            {/* ── PRÓXIMO ATENDIMENTO ── */}
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <MvText variant="semi2">Próximo atendimento</MvText>
                <TouchableOpacity onPress={() => navigation.navigate("ProfessionalAgenda")}>
                  <MvText variant="body4" style={{ color: green }}>
                    Ver agenda
                  </MvText>
                </TouchableOpacity>
              </View>

              {nextBooking ? (
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() =>
                    goToStack("BookingDetailProfessional", { bookingId: nextBooking.id })
                  }
                >
                  <View
                    style={{
                      borderRadius: 16,
                      padding: 16,
                      borderWidth: 1,
                      backgroundColor: cardBg,
                      borderColor: border,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <MvAvatar
                      initials={(nextBooking.client?.name?.trim().split(/\s+/).slice(0,2).map((w) => w[0] ?? "").join("") || "AL").toUpperCase()}
                      size={44}
                      borderRadius={22}
                      color="green"
                      photoUri={nextBooking.client?.photoUrl ?? null}
                    />
                    <View style={{ flex: 1, gap: 3 }}>
                      <MvText variant="semi2" numberOfLines={1}>
                        {nextBooking.client?.name ?? "Cliente"}
                      </MvText>
                      <MvText variant="body4" color="secondary" numberOfLines={1}>
                        {new Date(nextBooking.scheduledAt).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {nextBooking.sessionLocation ? ` · ${nextBooking.sessionLocation}` : ""}
                      </MvText>
                    </View>
                    <MvBadge
                      label={bookingStatusBadge(nextBooking.status).label}
                      variant={bookingStatusBadge(nextBooking.status).variant}
                    />
                    <Ionicons name="chevron-forward" size={16} color={text3} />
                  </View>
                </TouchableOpacity>
              ) : (
                <View
                  style={{
                    borderRadius: 16,
                    padding: 16,
                    borderWidth: 1,
                    backgroundColor: cardBg,
                    borderColor: border,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      backgroundColor: "rgba(107,114,128,0.10)",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name="calendar-outline" size={20} color={text3} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <MvText variant="semi3" color="secondary">Nenhum atendimento próximo</MvText>
                    <TouchableOpacity onPress={() => goToStack("AvailabilityManager")}>
                      <MvText variant="body4" style={{ color: green, marginTop: 2 }}>
                        + Adicionar horário disponível
                      </MvText>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>

            {/* ── HORÁRIOS LIVRES HOJE ── */}
            <View
              style={{
                borderRadius: 16,
                padding: 16,
                borderWidth: 1,
                backgroundColor: cardBg,
                borderColor: border,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    backgroundColor: "rgba(34,197,94,0.12)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="time-outline" size={17} color={green} />
                </View>
                <View style={{ flex: 1 }}>
                  <MvText variant="semi3">Horários livres hoje</MvText>
                  <MvText variant="body4" color="secondary">
                    {todayFreeSlots.length > 0
                      ? `${todayFreeSlots.length} horário${todayFreeSlots.length > 1 ? "s" : ""} disponível${todayFreeSlots.length > 1 ? "s" : ""}`
                      : "Nenhum horário configurado"}
                  </MvText>
                </View>
                <TouchableOpacity onPress={() => goToStack("AvailabilityManager")}>
                  <Ionicons name="chevron-forward" size={16} color={text3} />
                </TouchableOpacity>
              </View>

              {todayFreeSlots.length > 0 ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {todayFreeSlots.slice(0, 6).map((slot) => (
                    <View
                      key={slot.id}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 8,
                        borderRadius: 20,
                        backgroundColor: inputBg,
                        borderWidth: 1,
                        borderColor: border,
                      }}
                    >
                      <MvText variant="semi3" style={{ fontSize: 13 }}>
                        {slot.startTime}
                      </MvText>
                    </View>
                  ))}
                  {todayFreeSlots.length > 6 ? (
                    <View
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 8,
                        borderRadius: 20,
                        backgroundColor: inputBg,
                        borderWidth: 1,
                        borderColor: border,
                      }}
                    >
                      <MvText variant="body4" color="secondary">
                        +{todayFreeSlots.length - 6}
                      </MvText>
                    </View>
                  ) : null}
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => goToStack("AvailabilityManager")}
                  style={{
                    paddingVertical: 10,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: "rgba(34,197,94,0.25)",
                    backgroundColor: "rgba(34,197,94,0.06)",
                    alignItems: "center",
                  }}
                >
                  <MvText variant="semi3" style={{ color: green }}>
                    + Configurar disponibilidade
                  </MvText>
                </TouchableOpacity>
              )}
            </View>

            {/* ── ATALHOS RÁPIDOS ── */}
            <View style={{ gap: 10 }}>
              <MvText variant="semi2">Atalhos rápidos</MvText>
              <View style={{ flexDirection: "row", gap: 10 }}>
                {SHORTCUTS.map((shortcut) => (
                  <TouchableOpacity
                    key={shortcut.key}
                    onPress={() => handleShortcut(shortcut.key)}
                    activeOpacity={0.8}
                    style={{
                      flex: 1,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: border,
                      backgroundColor: cardBg,
                      paddingVertical: 14,
                      paddingHorizontal: 8,
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <View
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 11,
                        backgroundColor: "rgba(34,197,94,0.12)",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name={shortcut.icon} size={19} color={green} />
                    </View>
                    <MvText
                      variant="body4"
                      numberOfLines={2}
                      adjustsFontSizeToFit
                      minimumFontScale={0.9}
                      style={{
                        textAlign: "center",
                        color: text1,
                        lineHeight: 14,
                        fontSize: 10,
                        minHeight: 28,
                      }}
                    >
                      {shortcut.label}
                    </MvText>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* ── ATIVIDADES RECENTES ── */}
            {timeline && (
              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <MvText variant="semi2">Atividades recentes</MvText>
                  <TouchableOpacity onPress={() => setNotificationsDrawerOpen(true)}>
                    <MvText variant="body4" style={{ color: green }}>
                      Ver todas
                    </MvText>
                  </TouchableOpacity>
                </View>

                {/* Agora / próximas horas */}
                {timeline.upcomingNow.map((b) => (
                  <ActivityItem
                    key={b.id}
                    iconName="alarm-outline"
                    iconColor="#EF4444"
                    iconBg={isLight ? "rgba(239,68,68,0.04)" : "rgba(239,68,68,0.06)"}
                    borderColor="rgba(239,68,68,0.18)"
                    title={b.client.name}
                    subtitle="Agora · próximas horas"
                    timeLabel={new Date(b.scheduledAt).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    onPress={() => goToStack("BookingDetailProfessional", { bookingId: b.id })}
                  />
                ))}

                {/* Novos agendamentos */}
                {timeline.recentNew.slice(0, 3).map((b) => (
                  <ActivityItem
                    key={b.id}
                    iconName="calendar-outline"
                    iconColor={green}
                    iconBg={isLight ? "rgba(34,197,94,0.04)" : "rgba(34,197,94,0.06)"}
                    borderColor="rgba(34,197,94,0.18)"
                    title={b.client.name}
                    subtitle="Novo agendamento"
                    timeLabel={new Date(b.scheduledAt).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    onPress={() => goToStack("BookingDetailProfessional", { bookingId: b.id })}
                  />
                ))}

                {/* Fichas de anamnese pendentes */}
                {timeline.studentsWithIncompleteAnamnesis.slice(0, 3).map((s) => (
                  <ActivityItem
                    key={s.id}
                    iconName="document-text-outline"
                    iconColor="#F59E0B"
                    iconBg={isLight ? "rgba(245,158,11,0.04)" : "rgba(245,158,11,0.06)"}
                    borderColor="rgba(245,158,11,0.18)"
                    title={s.name}
                    subtitle="Ficha de anamnese pendente"
                    timeLabel="Pendente"
                    onPress={() =>
                      goToStack("ProfessionalStudentAnamnesis", {
                        clientId: s.id,
                        clientName: s.name,
                      })
                    }
                  />
                ))}

                {/* Estado vazio da timeline */}
                {timeline.upcomingNow.length === 0 &&
                  timeline.recentNew.length === 0 &&
                  timeline.studentsWithIncompleteAnamnesis.length === 0 && (
                    <View
                      style={{
                        borderRadius: 14,
                        padding: 14,
                        borderWidth: 1,
                        backgroundColor: cardBg,
                        borderColor: border,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <Ionicons name="checkmark-circle-outline" size={20} color={green} />
                      <MvText variant="body4" color="secondary">
                        Tudo em dia! Sem alertas no momento.
                      </MvText>
                    </View>
                  )}
              </View>
            )}

            {/* Aviso de perfil incompleto (compacto) */}
            {providerProfileMfssfng ? (
              <View
                style={{
                  borderRadius: 14,
                  padding: 14,
                  borderWidth: 1,
                  backgroundColor: "rgba(245,158,11,0.06)",
                  borderColor: "rgba(245,158,11,0.20)",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <Ionicons name="person-circle-outline" size={20} color="#F59E0B" />
                <View style={{ flex: 1 }}>
                  <MvText variant="semi3" style={{ color: "#F59E0B" }}>
                    Perfil incompleto
                  </MvText>
                  <MvText variant="body4" color="secondary">
                    Complete seu perfil para liberar todos os recursos.
                  </MvText>
                </View>
                <TouchableOpacity
                  onPress={() => navigation.navigate("ProfessionalProfileEditor" as never)}
                >
                  <MvText variant="body4" style={{ color: green }}>
                    Completar
                  </MvText>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        }
      />

      {/* ── BOTTOM NAV ── */}
      <ProfessionalBottomNav
        activeKey="home"
        onPress={(key) => {
          if (key === "home") { navigation.navigate("ProfessionalHome"); return; }
          if (key === "agenda") { navigation.navigate("ProfessionalAgenda"); return; }
          if (key === "conversas") { goToStack("ProfessionalChatList"); return; }
          if (key === "alunos") { goToStack("ProfessionalStudents"); return; }
          if (key === "financeiro") { goToStack("PayoutStatus"); }
        }}
      />

      {/* ── SIDE DRAWER ── */}
      {sideDrawerOpen ? (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 }}>
          {/* Backdrop */}
          <Pressable
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.48)" }}
            onPress={closeDrawer}
          />
          {/* Drawer panel com BlurView */}
          <Animated.View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              bottom: 0,
              width: DRAWER_W,
              borderRightWidth: 1,
              borderRightColor: isLight ? "rgba(22,163,74,0.12)" : "rgba(34,197,94,0.14)",
              transform: [{ translateX: drawerAnim }],
              overflow: "hidden",
              shadowColor: "#000",
              shadowOpacity: 0.28,
              shadowRadius: 24,
              shadowOffset: { width: 10, height: 0 },
              elevation: 20,
            }}
          >
            <BlurView
              intensity={isLight ? 60 : 72}
              tint={isLight ? "light" : "dark"}
              style={{ flex: 1 }}
            >
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
              >
                {/* ─ Perfil do usuário ─ */}
                <View
                  style={{
                    paddingTop: insets.top + 20,
                    paddingHorizontal: 20,
                    paddingBottom: 20,
                    borderBottomWidth: 1,
                    borderBottomColor: isLight ? "rgba(21,128,61,0.12)" : "rgba(34,197,94,0.12)",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <MvAvatar
                    initials={initials}
                    photoUri={providerPhotoUrl}
                    size={64}
                    borderRadius={32}
                    color="green"
                  />
                  <View style={{ alignItems: "center", gap: 3 }}>
                    <MvText variant="semi1" style={{ fontSize: 17, color: drawerText }}>{greetingName}</MvText>
                    <MvText variant="body4" style={{ color: drawerSub }}>Personal Trainer</MvText>
                    <View style={{ marginTop: 4, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, backgroundColor: isLight ? "rgba(21,128,61,0.10)" : "rgba(34,197,94,0.12)", borderWidth: 1, borderColor: isLight ? "rgba(21,128,61,0.28)" : "rgba(34,197,94,0.25)" }}>
                      <MvText variant="badge" style={{ color: isLight ? "#FFFFFF" : green, fontSize: 10 }}>Profissional</MvText>
                    </View>
                  </View>
                </View>

                {/* ─ Menu items ─ */}
                {([
                  { icon: "person-outline" as const, label: "Meu perfil", onPress: () => { closeDrawer(); (navigation as any).navigate("ProfessionalTabs", { screen: "ProfessionalProfileEditor" }); } },
                  { icon: "shield-checkmark-outline" as const, label: "CREF e documentos", onPress: () => { closeDrawer(); goToStack("ProfessionalCredentials"); } },
                  { icon: "card-outline" as const, label: "Conta bancária", onPress: () => { closeDrawer(); goToStack("ConnectPayoutAccount"); } },
                  { icon: "lock-closed-outline" as const, label: "Segurança", onPress: () => { closeDrawer(); goToStack("Security"); } },
                  { icon: "help-circle-outline" as const, label: "Suporte", onPress: () => { closeDrawer(); goToStack("Support"); } },
                  { icon: "share-social-outline" as const, label: "Indicar o app", onPress: () => { closeDrawer(); handleShareApp(); } },
                  { icon: "star-outline" as const, label: "Avalie o app", onPress: () => { closeDrawer(); handleRateApp(); } },
                ] as const).map((item) => (
                  <TouchableOpacity
                    key={item.label}
                    onPress={item.onPress}
                    activeOpacity={0.75}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 14,
                      paddingHorizontal: 20,
                      paddingVertical: 15,
                      borderBottomWidth: 1,
                      borderBottomColor: drawerDivider,
                    }}
                  >
                    <View style={{
                      width: 36, height: 36, borderRadius: 10,
                      backgroundColor: isLight ? "rgba(21,128,61,0.10)" : "rgba(34,197,94,0.12)",
                      alignItems: "center", justifyContent: "center",
                    }}>
                      <Ionicons name={item.icon} size={18} color={isLight ? "#FFFFFF" : "#22C55E"} />
                    </View>
                    <MvText variant="semi2" style={{ flex: 1, color: drawerText }}>{item.label}</MvText>
                    <Ionicons name="chevron-forward" size={15} color={drawerMuted} />
                  </TouchableOpacity>
                ))}

                {/* ─ Toggles ─ */}
                <TouchableOpacity
                  activeOpacity={1}
                  style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: drawerDivider }}
                >
                  <View style={{
                    width: 36, height: 36, borderRadius: 10,
                    backgroundColor: isLight ? "rgba(21,128,61,0.10)" : "rgba(34,197,94,0.12)",
                    alignItems: "center", justifyContent: "center",
                  }}>
                    <Ionicons name={isLight ? "sunny-outline" : "moon-outline"} size={18} color={isLight ? "#FFFFFF" : "#22C55E"} />
                  </View>
                  <MvText variant="semi2" style={{ flex: 1, color: drawerText }}>Modo light</MvText>
                  <MvToggle value={isLight} onValueChange={() => toggleTheme()} />
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={1}
                  style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: drawerDivider }}
                >
                  <View style={{
                    width: 36, height: 36, borderRadius: 10,
                    backgroundColor: isLight ? "rgba(21,128,61,0.10)" : "rgba(34,197,94,0.12)",
                    alignItems: "center", justifyContent: "center",
                  }}>
                    <Ionicons name="notifications-outline" size={18} color={isLight ? "#FFFFFF" : "#22C55E"} />
                  </View>
                  <MvText variant="semi2" style={{ flex: 1, color: drawerText }}>Notificações</MvText>
                  <MvToggle value={pushEnabled} onValueChange={setPushEnabled} />
                </TouchableOpacity>

                {/* ─ Sair ─ */}
                <TouchableOpacity
                  onPress={handleSignOut}
                  activeOpacity={0.75}
                  style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingVertical: 15, marginTop: 8 }}
                >
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(239,68,68,0.08)", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="log-out-outline" size={18} color="#EF4444" />
                  </View>
                  <MvText variant="semi2" style={{ color: "#EF4444" }}>Sair</MvText>
                </TouchableOpacity>
              </ScrollView>
            </BlurView>
          </Animated.View>
        </View>
      ) : null}

      {/* ── NOTIFICATIONS DRAWER ── */}
      <ProfessionalNotificationsDrawer
        visible={notificationsDrawerOpen}
        navigation={navigation.getParent<any>() ?? navigation}
        onClose={() => setNotificationsDrawerOpen(false)}
        onUnreadCountChange={setUnreadNotifCount}
      />

      {/* ── POPUP: PERFIL NÃO CRIADO ── */}
      <Modal
        animationType="fade"
        transparent
        visible={showProfileSetupPopup}
        onRequestClose={() => setShowProfileSetupPopup(false)}
      >
        <Pressable
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.60)",
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
          onPress={() => {
            setShowProfileSetupPopup(false);
            showToast("Complete seu perfil para melhorar sua visibilidade no app.", "info");
          }}
        >
          <Pressable
            style={{
              width: "100%",
              maxWidth: 360,
              borderRadius: 20,
              overflow: "hidden",
              backgroundColor: isLight ? "#fff" : "#0d1a0d",
              borderWidth: 1,
              borderColor: "rgba(34,197,94,0.30)",
            }}
            onPress={(e) => e.stopPropagation()}
          >
            <View
              style={{
                backgroundColor: isLight ? "rgba(34,197,94,0.10)" : "rgba(34,197,94,0.12)",
                borderBottomWidth: 1,
                borderBottomColor: "rgba(34,197,94,0.18)",
                padding: 20,
                alignItems: "center",
                gap: 6,
              }}
            >
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  backgroundColor: "rgba(34,197,94,0.15)",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 4,
                }}
              >
                <MvText style={{ fontSize: 24, lineHeight: 30 }}>👤</MvText>
              </View>
              <MvText variant="h2" style={{ textAlign: "center" }}>
                Crie seu perfil profissional
              </MvText>
              <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>
                Preencha seus dados para aparecer corretamente para alunos e configurar seus
                serviços.
              </MvText>
            </View>

            <View style={{ padding: 20, gap: 10 }}>
              {[
                "Complete suas informações básicas",
                "Defina área de atendimento e disponibilidade",
                "Depois disso, finalize o CREF para publicar ofertas",
              ].map((item) => (
                <View key={item} style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      backgroundColor: "rgba(34,197,94,0.15)",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <MvText style={{ fontSize: 11, lineHeight: 14, color: green }}>✓</MvText>
                  </View>
                  <MvText variant="body4" color="secondary">
                    {item}
                  </MvText>
                </View>
              ))}

              <TouchableOpacity
                onPress={() => {
                  setShowProfileSetupPopup(false);
                  navigation.navigate("ProfessionalProfileEditor" as never);
                }}
                style={{
                  marginTop: 6,
                  paddingVertical: 14,
                  borderRadius: 12,
                  backgroundColor: green,
                  alignItems: "center",
                }}
              >
                <MvText variant="semi2" style={{ color: "#fff" }}>
                  Criar perfil agora
                </MvText>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setShowProfileSetupPopup(false);
                  showToast("Você pode criar seu perfil quando quiser em 'Meu Perfil'.", "info");
                }}
                style={{ paddingVertical: 10, alignItems: "center" }}
              >
                <MvText variant="body4" color="tertiary">
                  Lembrar depois
                </MvText>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── POPUP: CREF PENDENTE ── */}
      <Modal
        animationType="fade"
        transparent
        visible={showCrefPopup}
        onRequestClose={() => setShowCrefPopup(false)}
      >
        <Pressable
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.62)",
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
          onPress={() => {
            setShowCrefPopup(false);
            showToast("Seu CREF precisa ser aprovado para liberar esta funcionalidade.", "info");
          }}
        >
          <Pressable
            style={{
              width: "100%",
              maxWidth: 360,
              borderRadius: 20,
              overflow: "hidden",
              backgroundColor: isLight ? "#ffffff" : "#0c1a0e",
              borderWidth: 1,
              borderColor: isLight ? "rgba(34,197,94,0.18)" : "rgba(34,197,94,0.25)",
            }}
            onPress={(e) => e.stopPropagation()}
          >
            {/* Header com ícone e título */}
            <View
              style={{
                backgroundColor: isLight ? "rgba(34,197,94,0.07)" : "rgba(34,197,94,0.10)",
                borderBottomWidth: 1,
                borderBottomColor: isLight ? "rgba(34,197,94,0.12)" : "rgba(34,197,94,0.18)",
                padding: 24,
                alignItems: "center",
                gap: 10,
              }}
            >
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 16,
                  backgroundColor: isLight ? "rgba(34,197,94,0.11)" : "rgba(34,197,94,0.15)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="ribbon-outline" size={28} color="#22C55E" />
              </View>
              <MvText variant="h3" style={{ textAlign: "center" }}>
                CREF pendente
              </MvText>
              <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>
                Aprove seu CREF para desbloquear todos os recursos
              </MvText>
            </View>

            {/* Corpo com benefícios e ações */}
            <View style={{ padding: 20, gap: 10 }}>
              {[
                { icon: "search-outline" as const, label: "Apareça em mais buscas de alunos" },
                { icon: "shield-checkmark-outline" as const, label: "Badge de verificado no seu perfil" },
                { icon: "trending-up-outline" as const, label: "Maior taxa de conversão e agendamentos" },
              ].map((item) => (
                <View key={item.label} style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      backgroundColor: isLight ? "rgba(34,197,94,0.09)" : "rgba(34,197,94,0.14)",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Ionicons name={item.icon} size={16} color="#22C55E" />
                  </View>
                  <MvText variant="body4" color="secondary" style={{ flex: 1 }}>
                    {item.label}
                  </MvText>
                </View>
              ))}

              <TouchableOpacity
                onPress={() => {
                  setShowCrefPopup(false);
                  goToStack("ProfessionalCredentials");
                }}
                style={{
                  marginTop: 6,
                  paddingVertical: 14,
                  borderRadius: 12,
                  backgroundColor: "#22C55E",
                  alignItems: "center",
                }}
              >
                <MvText variant="semi2" style={{ color: "#fff" }}>
                  Completar agora
                </MvText>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setShowCrefPopup(false);
                  showToast("Seu CREF precisa ser aprovado para liberar esta funcionalidade.", "info");
                }}
                style={{ paddingVertical: 10, alignItems: "center" }}
              >
                <MvText variant="body4" color="tertiary">
                  Lembrar depois
                </MvText>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
