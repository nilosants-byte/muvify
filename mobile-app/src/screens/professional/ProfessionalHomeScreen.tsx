import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import {
  Alert,
  Animated,
  Dimensions,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { ProfessionalTabParamList } from "../../navigation/route-types";
import {
  ApiError,
  Availability,
  availabilityApi,
  Booking,
  bookingsApi,
  chatApi,
  notificationsApi,
  ProviderTimelineResponse,
  providersApi,
  userApi,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvAvatar, MvBadge, MvCard, MvRefreshControl, MvText, MvToggle } from "../../components/mv";
import { PressableScale } from "../../components/polish/PressableScale";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { AnimatedNumber } from "../../components/polish/AnimatedNumber";
import { SkeletonHomeScreen } from "../../components/polish/SkeletonCard";
import { ProfessionalBottomNav } from "../../components/navigation/ProfessionalBottomNav";
import { ActivityItem, WeeklyBarChart } from "../../components/professional/HomeWidgets";
import { AppLogoText } from "../../components/ui/AppLogoText";
import { formatCurrencyBRL } from "../../utils/formatters";
import { resolveMediaUrl } from "../../utils/media";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { handleScreenError } from "../shared/api-helpers";
import { MetricPill, UrgencyCard } from "../../components/professional/UXReformComponents";
import { ProfessionalNotificationsDrawer } from "./components/ProfessionalNotificationsDrawer";
import { ProfessionalOnboardingWizard } from "./components/ProfessionalOnboardingWizard";
import {
  countUnreadNotifications,
  loadDismissedNotificationIds,
  loadSeenNotificationIds,
} from "../../utils/notificationsReadState";

type Props = BottomTabScreenProps<ProfessionalTabParamList, "ProfessionalHome">;

type WeatherIconData = { name: keyof typeof Ionicons.glyphMap; color: string };

function getWeatherIcon(code: number, isNight: boolean): WeatherIconData {
  if (code === 0)  return isNight ? { name: "moon",         color: "#94A3B8" } : { name: "sunny",        color: "#F5A623" };
  if (code === 1)  return isNight ? { name: "moon-outline", color: "#94A3B8" } : { name: "partly-sunny", color: "#F5A623" };
  if (code === 2)  return isNight ? { name: "cloudy-night-outline", color: "#9CA3AF" } : { name: "partly-sunny", color: "#9CA3AF" };
  if (code === 3)  return { name: "cloudy",       color: "#9CA3AF" };
  if (code >= 45 && code <= 48) return { name: "cloudy",       color: "#9CA3AF" };
  if (code >= 51 && code <= 67) return { name: "rainy",        color: "#60A5FA" };
  if (code >= 71 && code <= 77) return { name: "snow-outline", color: "#BAE6FD" };
  if (code >= 80 && code <= 82) return { name: "rainy",        color: "#60A5FA" };
  if (code >= 95 && code <= 99) return { name: "thunderstorm", color: "#818CF8" };
  return isNight ? { name: "moon", color: "#94A3B8" } : { name: "sunny", color: "#F5A623" };
}

function timeBasedWeatherIcon(): WeatherIconData {
  const h = new Date().getHours();
  return h < 6 || h >= 19
    ? { name: "moon", color: "#94A3B8" }
    : { name: "sunny", color: "#F5A623" };
}

function isNightTime() {
  const h = new Date().getHours();
  return h < 6 || h >= 19;
}

const BRAZIL_STATE_CODES: Record<string, string> = {
  acre:"AC", alagoas:"AL", amapa:"AP", amazonas:"AM", bahia:"BA", ceara:"CE",
  "distrito federal":"DF", "espirito santo":"ES", goias:"GO", maranhao:"MA",
  "mato grosso":"MT", "mato grosso do sul":"MS", "minas gerais":"MG", para:"PA",
  paraiba:"PB", parana:"PR", pernambuco:"PE", piaui:"PI", "rio de janeiro":"RJ",
  "rio grande do norte":"RN", "rio grande do sul":"RS", rondonia:"RO", roraima:"RR",
  "santa catarina":"SC", "sao paulo":"SP", sergipe:"SE", tocantins:"TO",
};

function formatCityLabel(place?: { city?: string | null; subregion?: string | null; district?: string | null; region?: string | null } | null): string | null {
  if (!place) return null;
  const city = place.city?.trim() || place.subregion?.trim() || place.district?.trim() || "";
  if (!city) return null;
  const regionRaw = (place.region ?? "").trim();
  const regionNorm = regionRaw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const stateCode = /^[a-z]{2}$/i.test(regionRaw) ? regionRaw.toUpperCase() : (BRAZIL_STATE_CODES[regionNorm] ?? null);
  return stateCode ? `${city}-${stateCode}` : city;
}

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
  if (status === "COMPLETED") return { label: "Concluído", variant: "gray" as const };
  if (status === "CANCELLED") return { label: "Cancelado", variant: "red" as const };
  if (status === "CONFIRMED") return { label: "Confirmado", variant: "green" as const };
  return { label: "Pendente", variant: "orange" as const };
}

type ShortcutKey = "newTraining" | "newConsultancy" | "addSlot" | "addFinancial";


const DAY_LABELS = ["D", "S", "T", "Q", "Q", "S", "S"];
const MONTHLY_GOAL_KEY = "@muvify:provider_monthly_goal";

// ─── Main screen ─────────────────────────────────────────────────────────────
export function ProfessionalHomeScreen({ navigation }: Props) {
  const { runWithAuth, setCurrentUser, showToast, user, signOut } = useAppState();
  const { theme, isDark, toggleTheme } = useMvTheme();
  const isLight = theme.mode === "light";
  const insets = useSafeAreaInsets();
  const SCREEN_W = Dimensions.get("window").width;
  const DRAWER_W = Math.min(SCREEN_W * 0.82, 320);

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [timeline, setTimeline] = useState<ProviderTimelineResponse | null>(null);
  const [availabilities, setAvailabilities] = useState<Availability[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showCrefBanner, setShowCrefBanner] = useState(false);
  const [showProfileBanner, setShowProfileBanner] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [providerPhotoUrl, setProviderPhotoUrl] = useState<string | null>(
    () => resolveMediaUrl(user?.providerProfile?.photoUrl, true)
  );
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [notificationsDrawerOpen, setNotificationsDrawerOpen] = useState(false);
  const [sideDrawerOpen, setSideDrawerOpen] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [monthlyGoal, setMonthlyGoal] = useState(0);
  const [weatherIcon, setWeatherIcon] = useState<WeatherIconData>(timeBasedWeatherIcon);
  const [locationCity, setLocationCity] = useState<string | null>(null);
  const drawerAnim = useRef(new Animated.Value(-DRAWER_W)).current;
  const crefChecked = useRef(false);
  const profileChecked = useRef(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(false);
      const [bookingResponse, me, credentials, timelineResponse, availabilitiesResponse] =
        await Promise.all([
          runWithAuth((token) => bookingsApi.me(token)).catch(() => [] as Booking[]),
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
      setTimeline(timelineResponse);
      setAvailabilities(availabilitiesResponse);

      if (me) setCurrentUser(me);

      const profile = me?.providerProfile ?? null;
      setProviderPhotoUrl(resolveMediaUrl(profile?.photoUrl, true));

      if (!Boolean(profile) && !profileChecked.current) {
        setShowProfileBanner(true);
        profileChecked.current = true;
      }
      if (Boolean(profile)) setShowProfileBanner(false);
      const crefStatus = credentials?.crefValidationStatus ?? "PENDING";
      const crefApproved = crefStatus === "APPROVED";
      if (Boolean(profile) && !crefChecked.current && credentials && !crefApproved) {
        setShowCrefBanner(true);
        crefChecked.current = true;
      }
      if (Boolean(profile) && crefApproved) {
        setShowCrefBanner(false);
      }
    } catch (error) {
      setLoadError(true);
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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await load();
    setRefreshing(false);
  }, [load]);

  useEffect(() => {
    setProviderPhotoUrl(resolveMediaUrl(user?.providerProfile?.photoUrl, true));
  }, [user?.name, user?.providerProfile]);

  const refreshUnreadNotificationCount = useCallback(async () => {
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

  const refreshUnreadChatCount = useCallback(async () => {
    try {
      const chats = await runWithAuth((token) => chatApi.myChats(token));
      const count = chats.filter((c) => c.unreadCount > 0).length;
      setUnreadChatCount(count);
    } catch {
      // best effort
    }
  }, [runWithAuth]);

  useFocusEffect(
    useCallback(() => {
      void refreshUnreadNotificationCount();
      void refreshUnreadChatCount();
      const timer = setInterval(() => void refreshUnreadChatCount(), 15000);
      return () => clearInterval(timer);
    }, [refreshUnreadNotificationCount, refreshUnreadChatCount])
  );

  useEffect(() => {
    AsyncStorage.getItem(MONTHLY_GOAL_KEY).then((v) => {
      const n = parseFloat(v ?? "0");
      if (!isNaN(n) && n > 0) setMonthlyGoal(n);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted") return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const { latitude, longitude } = pos.coords;

        // Reverse geocode para mostrar cidade ao lado do emoji
        const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
        setLocationCity(formatCityLabel(place));

        // Buscar tempo real com coordenadas precisas e timeout de 5s
        const controller = new AbortController();
        const weatherTimeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=weather_code&timezone=auto`,
          { signal: controller.signal }
        );
        clearTimeout(weatherTimeout);
        if (!res.ok) return;
        const data = await res.json() as { current?: { weather_code?: number } };
        const code = data.current?.weather_code;
        if (code != null) setWeatherIcon(getWeatherIcon(code, isNightTime()));
      } catch {
        // mantém fallback por hora do dia
      }
    })();
  }, []);

  // ── Derived data ────────────────────────────────────────────────────────────
  const fullProfessionalName = useMemo(() => {
    const n = user?.providerProfile?.displayName?.trim() || user?.name?.trim();
    return n || "Profissional";
  }, [user?.name, user?.providerProfile?.displayName]);

  const greetingName = useMemo(
    () => fullProfessionalName.split(/\s+/)[0]?.trim() || "Profissional",
    [fullProfessionalName]
  );


  const initials = useMemo(() => {
    const parts = fullProfessionalName.trim().split(/\s+/);
    return parts.length === 1
      ? (parts[0]?.slice(0, 2) ?? "PR").toUpperCase()
      : `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }, [fullProfessionalName]);

  const todayBookings = useMemo(
    () =>
      bookings
        .filter((b) => {
          if (!["CONFIRMED", "PENDING", "COMPLETED"].includes(b.status)) return false;
          const dateRef = b.status === "COMPLETED" ? (b.completedAt ?? b.scheduledAt) : b.scheduledAt;
          return isToday(dateRef);
        })
        .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()),
    [bookings]
  );

  const nextBooking = useMemo(
    () => todayBookings.find((b) => b.status === "CONFIRMED" || b.status === "PENDING") ?? null,
    [todayBookings]
  );

  const canConclude = useMemo(
    () =>
      nextBooking != null &&
      nextBooking.status === "CONFIRMED" &&
      nowMs >= new Date(nextBooking.scheduledAt).getTime() + 30 * 60 * 1000,
    [nextBooking, nowMs]
  );

  const confirmedToday = useMemo(
    () => bookings.filter((b) => b.status === "CONFIRMED" && isToday(b.scheduledAt)).length,
    [bookings]
  );

  const completedToday = useMemo(
    () => bookings.filter((b) => b.status === "COMPLETED" && isToday(b.completedAt ?? b.scheduledAt)).length,
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

  const todayRevenue = useMemo(
    () =>
      bookings
        .filter((b) => b.status === "COMPLETED" && isToday(b.completedAt ?? b.scheduledAt))
        .reduce((s, b) => s + (b.priceCents ?? 0), 0) / 100,
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
    const startOfThisWeek = new Date(now);
    startOfThisWeek.setHours(0, 0, 0, 0);
    startOfThisWeek.setDate(now.getDate() - now.getDay());
    const startOfLastWeek = new Date(startOfThisWeek);
    startOfLastWeek.setDate(startOfThisWeek.getDate() - 7);
    const cents = bookings
      .filter((b) => {
        if (b.status !== "COMPLETED") return false;
        const d = new Date(b.completedAt ?? b.scheduledAt);
        return d >= startOfLastWeek && d < startOfThisWeek;
      })
      .reduce((s, b) => s + (b.priceCents ?? 0), 0);
    return cents / 100;
  }, [bookings]);

  const weeklyRevenueChange = useMemo(() => {
    if (lastWeekRevenue === 0) return null;
    return ((weeklyRevenue - lastWeekRevenue) / lastWeekRevenue) * 100;
  }, [weeklyRevenue, lastWeekRevenue]);

  const currentMonthGross = useMemo(() => {
    const now = new Date();
    return bookings
      .filter((b) => {
        if (b.status !== "COMPLETED") return false;
        const d = new Date(b.completedAt ?? b.scheduledAt);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      })
      .reduce((s, b) => s + (b.priceCents ?? 0), 0) / 100;
  }, [bookings]);

  const weeklyChartData = useMemo(() => {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setHours(0, 0, 0, 0);
    startOfWeek.setDate(now.getDate() - now.getDay());
    return DAY_LABELS.map((label, i) => {
      const dayStart = new Date(startOfWeek);
      dayStart.setDate(startOfWeek.getDate() + i);
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
      return { label, revenue, isToday: i === now.getDay() };
    });
  }, [bookings]);

  const todayFreeSlots = useMemo(() => {
    const now = new Date();
    const todayWeekday = now.getDay();
    const currentHHMM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    return availabilities
      .filter((a) => a.weekday === todayWeekday && a.isActive && a.startTime > currentHHMM)
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
    if (key === "newTraining") goToStack("TrainingCreation");
    else if (key === "newConsultancy") goToStack("ProfessionalConsultancyCenter");
    else if (key === "addSlot") goToStack("AvailabilityManager");
    else if (key === "addFinancial") goToStack("PayoutStatus");
  };

  // ── Colors ───────────────────────────────────────────────────────────────────
  // ── Drawer lateral ──────────────────────────────────────────────────────────
  const APP_STORE_ID = "000000000";
  const PLAY_STORE_ID = "com.muvify.app";

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

  const drawerText  = text1;
  const drawerSub   = text2;
  const drawerMuted = text3;
  const drawerDivider = theme.border;

  // ── Subtitle dinâmica — prioridades reais + sugestões contextuais ────────────
  const headerSubtitle = useMemo(() => {
    if (loading) return "...";

    // Mensagens prioritárias (algo pendente ou relevante agora)
    const urgent: string[] = [];
    if (showProfileBanner) urgent.push("Configure seu perfil para aparecer nas buscas");
    if (showCrefBanner) urgent.push("Valide seu CREF para receber clientes");
    if (pendingCount > 0) urgent.push(`${pendingCount} solicitaç${pendingCount > 1 ? "ões" : "ão"} aguarda${pendingCount > 1 ? "m" : ""} confirmação`);
    if (unreadChatCount > 0) urgent.push(`${unreadChatCount} mensagem${unreadChatCount > 1 ? "ns" : ""} não lida${unreadChatCount > 1 ? "s" : ""}`);
    if (confirmedToday > 0) urgent.push(`${confirmedToday} atendimento${confirmedToday > 1 ? "s" : ""} confirmado${confirmedToday > 1 ? "s" : ""} hoje`);
    if (urgent.length > 0) return urgent[new Date().getDate() % urgent.length]!;

    // Sugestões contextuais — adaptadas ao perfil real do usuário
    const tips: string[] = [];
    if (nextBooking) tips.push("Confira os próximos compromissos na agenda");
    if (availabilities.length === 0) {
      tips.push("Adicione horários disponíveis para receber alunos");
    } else if (todayFreeSlots.length > 0) {
      tips.push(`${todayFreeSlots.length} horário${todayFreeSlots.length > 1 ? "s" : ""} livre${todayFreeSlots.length > 1 ? "s" : ""} disponíve${todayFreeSlots.length > 1 ? "is" : "l"} hoje`);
    }
    if (activeStudents > 0) {
      tips.push(`Crie novos treinos para seus ${activeStudents} aluno${activeStudents > 1 ? "s" : ""}`);
    } else {
      tips.push("Crie ofertas para atrair seus primeiros alunos");
    }
    tips.push("Verifique e atualize seu controle financeiro");
    tips.push("Crie ou atualize seus planos de treino");
    tips.push("Compartilhe seu perfil para atrair novos alunos");

    return tips[new Date().getDate() % tips.length]!;
  }, [loading, showProfileBanner, showCrefBanner, pendingCount, unreadChatCount, confirmedToday, nextBooking, availabilities, todayFreeSlots, activeStudents]);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: bg }} testID="screen.professional.home">
      <StatusBar barStyle={isLight ? "dark-content" : "light-content"} backgroundColor={bg} />

      {/* ── HEADER ── */}
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: 16, paddingBottom: 10 }}>
        {/* Row 1: Avatar | Logo centralizada | Bell */}
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <PressableScale onPress={openDrawer} scale={0.92} accessibilityLabel="Abrir menu">
            <MvAvatar
              initials={initials}
              size={40}
              borderRadius={20}
              color="green"
              photoUri={providerPhotoUrl}
            />
          </PressableScale>

          <View style={{ flex: 1, alignItems: "center" }} pointerEvents="none">
            <AppLogoText size={22} />
          </View>

          <View style={{ flexDirection: "row", gap: 8 }}>
            <PressableScale
              onPress={() => { setUnreadChatCount(0); goToStack("ProfessionalChatList"); }}
              scale={0.92}
              accessibilityLabel="Conversas"
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: isLight ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.08)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="chatbubbles-outline" size={20} color={isLight ? "#222" : "#ccc"} />
              {unreadChatCount > 0 ? (
                <View style={{
                  position: "absolute", top: -3, right: -3,
                  minWidth: 16, height: 16, borderRadius: 8,
                  backgroundColor: "#f44336",
                  borderWidth: 1.5, borderColor: isLight ? "#fff" : "#080e08",
                  alignItems: "center", justifyContent: "center", paddingHorizontal: 3,
                }}>
                  <Text style={{ color: "#fff", fontSize: 9, fontWeight: "700", lineHeight: 12 }}>
                    {unreadChatCount > 99 ? "99+" : String(unreadChatCount)}
                  </Text>
                </View>
              ) : null}
            </PressableScale>

            <PressableScale
              onPress={() => setNotificationsDrawerOpen(true)}
              scale={0.92}
              accessibilityLabel="Notificações"
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: isLight ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.08)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="notifications-outline" size={20} color={isLight ? "#222" : "#ccc"} />
              {unreadNotifCount > 0 ? (
                <View style={{
                  position: "absolute", top: -3, right: -3,
                  minWidth: 18, height: 18, borderRadius: 9,
                  backgroundColor: "#f44336",
                  borderWidth: 1.5, borderColor: isLight ? "#fff" : "#080e08",
                  alignItems: "center", justifyContent: "center", paddingHorizontal: 3,
                }}>
                  <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700", lineHeight: 13 }}>
                    {unreadNotifCount > 99 ? "99+" : String(unreadNotifCount)}
                  </Text>
                </View>
              ) : null}
            </PressableScale>
          </View>
        </View>

        {/* Row 2: Saudação */}
        <View style={{ paddingTop: 16, paddingBottom: 16 }}>
          <Text
            style={{
              fontFamily: "PlusJakartaSans_800ExtraBold",
              fontWeight: "800",
              fontSize: 28,
              letterSpacing: -0.4,
              lineHeight: 34,
            }}
          >
            <Text style={{ color: text1 }}>Olá, </Text>
            <Text style={{ color: green }}>{greetingName}!</Text>
          </Text>
          <View style={{ gap: 0, marginTop: 6 }}>
            {/* Cidade + clima */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              {locationCity ? (
                <MvText variant="body4" color="secondary" numberOfLines={1}>{locationCity}</MvText>
              ) : null}
              <Ionicons name={weatherIcon.name} size={14} color={weatherIcon.color} />
            </View>

            {/* Status chip — destaque da mensagem */}
            <View style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 7,
              marginTop: 8,
              paddingHorizontal: 11,
              paddingVertical: 6,
              borderRadius: 99,
              alignSelf: "flex-start",
              backgroundColor: isLight ? "rgba(22,163,74,0.08)" : "rgba(34,197,94,0.09)",
              borderWidth: 1,
              borderColor: isLight ? "rgba(22,163,74,0.18)" : "rgba(34,197,94,0.18)",
            }}>
              <View style={{
                width: 6, height: 6, borderRadius: 3,
                backgroundColor: green,
                shadowColor: green,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.7,
                shadowRadius: 4,
              }} />
              <Text style={{
                fontFamily: "DMSans_700Bold",
                fontSize: 12.5,
                color: isLight ? "#0A2E12" : "#D6F5E3",
                letterSpacing: -0.1,
              }} numberOfLines={1}>
                {headerSubtitle}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* ── CONTENT ── */}
      {loading ? (
        <SkeletonHomeScreen />
      ) : loadError ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 16 }}>
          <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: "rgba(239,68,68,0.08)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="cloud-offline-outline" size={30} color={theme.danger} />
          </View>
          <MvText variant="semi2" style={{ textAlign: "center" }}>Não foi possível carregar</MvText>
          <MvText variant="body4" color="secondary" style={{ textAlign: "center", lineHeight: 20 }}>
            Verifique sua conexão e tente novamente.
          </MvText>
          <PressableScale
            onPress={() => void load()}
            scale={0.96}
            style={{ paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, backgroundColor: theme.primary }}
          >
            <MvText variant="semi3" style={{ color: theme.textOnPrimary }}>Tentar novamente</MvText>
          </PressableScale>
        </View>
      ) : (
      <ScreenEntrance>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, gap: 14 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <MvRefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={{ gap: 14 }}>

          {/* ── WIZARD: ONBOARDING PROFISSIONAL ── */}
          <ProfessionalOnboardingWizard
            onNavigateProfile={() => navigation.navigate("ProfessionalProfileEditor" as never)}
            onNavigateAvailability={() => navigation.navigate("AvailabilityManager" as never)}
            onNavigateCref={() => navigation.navigate("ProfessionalCredentials" as never)}
          />

          {/* ── BANNER: PERFIL INCOMPLETO ── */}
          {showProfileBanner ? (
            <UrgencyCard
              icon="person-circle-outline"
              tone="amber"
              subtitle="perfil incompleto"
              title="Complete seu perfil para aparecer para alunos"
              cta="Completar"
              onPress={() => { setShowProfileBanner(false); navigation.navigate("ProfessionalProfileEditor" as never); }}
            />
          ) : null}

          {/* ── BANNER: CREF PENDENTE ── */}
          {showCrefBanner ? (
            <UrgencyCard
              icon="ribbon-outline"
              tone="amber"
              subtitle="cref pendente"
              title="Valide seu CREF para desbloquear todos os recursos"
              cta="Validar"
              onPress={() => { setShowCrefBanner(false); goToStack("ProfessionalCredentials"); }}
            />
          ) : null}


          {/* ── DIA LIVRE ── */}
          {!nextBooking && todayBookings.length === 0 ? (
            <PressableScale
              scale={0.97}
              onPress={() => goToStack("AvailabilityManager")}
              style={{
                borderRadius: 18, padding: 18, borderWidth: 1,
                backgroundColor: isLight ? "rgba(34,197,94,0.04)" : "rgba(34,197,94,0.06)",
                borderColor: "rgba(34,197,94,0.18)",
                alignItems: "center", gap: 10,
              }}
            >
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(34,197,94,0.12)", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="sunny-outline" size={26} color={green} />
              </View>
              <MvText variant="semi2" style={{ color: text1 }}>Dia livre</MvText>
              <MvText variant="body4" color="secondary" style={{ textAlign: "center", lineHeight: 20 }}>
                Você não tem sessões hoje. Adicione horários disponíveis para receber novos alunos.
              </MvText>
              <View style={{ paddingHorizontal: 20, paddingVertical: 9, borderRadius: 12, backgroundColor: "rgba(34,197,94,0.12)", borderWidth: 1, borderColor: "rgba(34,197,94,0.28)" }}>
                <MvText variant="semi3" style={{ color: green }}>+ Adicionar horário</MvText>
              </View>
            </PressableScale>
          ) : null}

          {/* ── PRÓXIMA SESSÃO ── */}
          {nextBooking ? (
            <PressableScale
              scale={0.97}
              onPress={() => goToStack("BookingDetailProfessional", { bookingId: nextBooking.id })}
              style={{
                borderRadius: 16,
                borderWidth: 1,
                backgroundColor: isLight ? "rgba(34,197,94,0.06)" : "rgba(34,197,94,0.08)",
                borderColor: "rgba(34,197,94,0.22)",
                overflow: "hidden",
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: green, flexShrink: 0, shadowColor: green, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 6 }} />
                <MvAvatar
                  initials={(nextBooking.client?.name?.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("") || "AL").toUpperCase()}
                  size={40}
                  borderRadius={20}
                  color="green"
                  photoUri={nextBooking.client?.photoUrl ?? null}
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <MvText variant="semi3" numberOfLines={1}>{nextBooking.client?.name ?? "Cliente"}</MvText>
                  <MvText variant="body4" color="secondary">
                    {new Date(nextBooking.scheduledAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}
                    {nextBooking.sessionLocation ? ` · ${nextBooking.sessionLocation}` : ""}
                  </MvText>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <MvBadge label={bookingStatusBadge(nextBooking.status).label} variant={bookingStatusBadge(nextBooking.status).variant} />
                  <Ionicons name="chevron-forward" size={14} color={text3} />
                </View>
              </View>

              {canConclude ? (
                <TouchableOpacity
                  onPress={(e) => {
                    e.stopPropagation();
                    goToStack("ProfessionalConfirmCompletion", { bookingId: nextBooking.id });
                  }}
                  activeOpacity={0.8}
                  style={{
                    borderTopWidth: 1,
                    borderTopColor: "rgba(34,197,94,0.18)",
                    paddingVertical: 10,
                    paddingHorizontal: 14,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    backgroundColor: "rgba(34,197,94,0.08)",
                  }}
                >
                  <Ionicons name="checkmark-circle-outline" size={15} color={green} />
                  <MvText variant="semi3" style={{ color: green, fontSize: 13 }}>Validar presença</MvText>
                  <Ionicons name="arrow-forward" size={13} color={green} />
                </TouchableOpacity>
              ) : null}
            </PressableScale>
          ) : null}

          {/* ── MÉTRICAS DO DIA ── */}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <MetricPill label="Confirmados hoje" value={confirmedToday} tone={confirmedToday > 0 ? "green" : "sky"} />
            <MetricPill label="Solicitações" value={pendingCount} tone={pendingCount > 0 ? "amber" : "green"} />
            <MetricPill label="Horários livres" value={todayFreeSlots.length} tone="sky" />
          </View>

          {/* ── AGENDA DE HOJE ── */}
          {todayBookings.length > 1 ? (
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
                  <Ionicons name="calendar-outline" size={17} color={green} />
                </View>
                <View style={{ flex: 1 }}>
                  <MvText variant="semi3">Agenda de hoje</MvText>
                  <MvText variant="body4" color="secondary">
                    {todayBookings.length} sessão{todayBookings.length > 1 ? "s" : ""} no dia
                  </MvText>
                </View>
              </View>
              <View style={{ gap: 8 }}>
                {todayBookings.map((b) => (
                  <PressableScale
                    key={b.id}
                    scale={0.97}
                    onPress={() => goToStack("BookingDetailProfessional", { bookingId: b.id })}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderRadius: 12,
                      backgroundColor: inputBg,
                      borderWidth: 1,
                      borderColor: border,
                    }}
                  >
                    <MvText variant="semi3" style={{ color: green, width: 44, flexShrink: 0 }}>
                      {new Date(b.scheduledAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}
                    </MvText>
                    <MvAvatar
                      initials={(b.client?.name?.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("") || "AL").toUpperCase()}
                      size={28}
                      borderRadius={14}
                      color="green"
                      photoUri={b.client?.photoUrl ?? null}
                    />
                    <MvText variant="semi3" numberOfLines={1} style={{ flex: 1 }}>
                      {b.client?.name ?? "Cliente"}
                    </MvText>
                    <MvBadge label={bookingStatusBadge(b.status).label} variant={bookingStatusBadge(b.status).variant} />
                    <TouchableOpacity
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={(e) => {
                        e.stopPropagation();
                        goToStack("ProfessionalStudentAnamnesis", {
                          clientId: b.client?.id,
                          clientName: b.client?.name,
                        });
                      }}
                    >
                      <Ionicons name="document-text-outline" size={16} color={text3} />
                    </TouchableOpacity>
                    <Ionicons name="chevron-forward" size={14} color={text3} />
                  </PressableScale>
                ))}
              </View>
            </View>
          ) : null}

          {/* ── ATALHOS RÁPIDOS ── */}
          <View style={{ gap: 8 }}>
            <MvText variant="semi2">Atalhos rápidos</MvText>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {([
                { key: "newTraining" as const,    icon: "barbell-outline" as const,   label: "Treinos" },
                { key: "newConsultancy" as const, icon: "flash-outline" as const,     label: "Oferta" },
                { key: "addSlot" as const,        icon: "time-outline" as const,      label: "Horários e\nLocais" },
                { key: "addFinancial" as const,   icon: "stats-chart-outline" as const, label: "Controle\nFinanceiro" },
              ] as const).map((s) => (
                <TouchableOpacity
                  key={s.key}
                  activeOpacity={0.75}
                  onPress={() => handleShortcut(s.key)}
                  style={{ flex: 1, borderRadius: 14, borderWidth: 1, borderColor: border, backgroundColor: cardBg, paddingVertical: 12, paddingHorizontal: 4, alignItems: "center", gap: 6 }}
                >
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(34,197,94,0.12)", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name={s.icon} size={18} color={green} />
                  </View>
                  <MvText variant="semi3" style={{ color: text1, fontSize: 10, textAlign: "center" }}>{s.label}</MvText>
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

              {timeline.upcomingNow.map((b) => (
                <ActivityItem
                  key={b.id}
                  iconName="alarm-outline"
                  iconColor={theme.danger}
                  iconBg={isLight ? "rgba(239,68,68,0.04)" : "rgba(239,68,68,0.06)"}
                  borderColor="rgba(239,68,68,0.18)"
                  title={b.client?.name ?? "Cliente"}
                  subtitle="Agora · próximas horas"
                  timeLabel={new Date(b.scheduledAt).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "America/Sao_Paulo",
                  })}
                  onPress={() => goToStack("BookingDetailProfessional", { bookingId: b.id })}
                />
              ))}

              {timeline.recentNew.slice(0, 3).map((b) => (
                <ActivityItem
                  key={b.id}
                  iconName="calendar-outline"
                  iconColor={green}
                  iconBg={isLight ? "rgba(34,197,94,0.04)" : "rgba(34,197,94,0.06)"}
                  borderColor="rgba(34,197,94,0.18)"
                  title={b.client?.name ?? "Cliente"}
                  subtitle="Novo agendamento"
                  timeLabel={new Date(b.scheduledAt).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "America/Sao_Paulo",
                  })}
                  onPress={() => goToStack("BookingDetailProfessional", { bookingId: b.id })}
                />
              ))}

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

              {timeline.upcomingNow.length === 0 &&
                timeline.recentNew.length === 0 &&
                timeline.studentsWithIncompleteAnamnesis.length === 0 && (
                  <View
                    style={{
                      borderRadius: 16,
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

          {/* ── RECEITA DO MÊS ── */}
          <PressableScale
            onPress={() => goToStack("PayoutStatus")}
            scale={0.97}
            style={{ borderRadius: 16, padding: 20, borderWidth: 1, backgroundColor: heroBg, borderColor: heroBorder }}
          >
            <MvText variant="caption" color="secondary">RECEITA DO MÊS</MvText>
            <MvText variant="hero" style={{ color: green, marginTop: 4, letterSpacing: -0.5 }}>
              {formatCurrencyBRL(currentMonthGross)}
            </MvText>
            <MvText variant="body4" color="secondary" style={{ marginTop: 2 }}>
              {formatCurrencyBRL(todayRevenue)} hoje
            </MvText>

            {monthlyGoal > 0 && (
              <View style={{ marginTop: 14, gap: 6 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <MvText variant="body4" color="secondary">Meta do mês</MvText>
                  <MvText variant="semi3" style={{ color: green }}>
                    {Math.min(Math.round((currentMonthGross / monthlyGoal) * 100), 100)}%
                  </MvText>
                </View>
                <View style={{ height: 4, borderRadius: 99, backgroundColor: barBg, overflow: "hidden" }}>
                  <View style={{
                    height: 4, borderRadius: 99, backgroundColor: green,
                    width: `${Math.min((currentMonthGross / monthlyGoal) * 100, 100)}%` as any,
                  }} />
                </View>
                <MvText variant="body4" color="secondary">{formatCurrencyBRL(monthlyGoal)} definida</MvText>
              </View>
            )}

            <WeeklyBarChart data={weeklyChartData} primaryColor={green} barBg={barBg} />
          </PressableScale>

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
              <AnimatedNumber
                value={activeStudents}
                style={{ fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 24, fontWeight: "800", letterSpacing: -0.3, lineHeight: 30, color: text1 }}
              />
              <MvText variant="body4" color="secondary" style={{ marginTop: 2 }}>
                Alunos ativos
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
              <MvText style={{ fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 22, fontWeight: "800", letterSpacing: -0.2, lineHeight: 28, color: text1 }}>
                {completedToday}/{confirmedToday + completedToday}
              </MvText>
              <MvText variant="body4" color="secondary" style={{ marginTop: 2 }}>
                Feitas hoje
              </MvText>
            </View>
          </View>

        </View>
      </ScrollView>
      </ScreenEntrance>
      )}

      {/* ── BOTTOM NAV ── */}
      <ProfessionalBottomNav
        activeKey="home"
        onPress={(key) => {
          if (key === "home") { navigation.navigate("ProfessionalHome"); return; }
          if (key === "agenda") { navigation.navigate("ProfessionalAgenda"); return; }
          if (key === "consultoria") { navigation.navigate("ProfessionalConsultancyCenter"); return; }
          if (key === "alunos") { goToStack("ProfessionalStudents"); return; }
          if (key === "financeiro") { goToStack("PayoutStatus"); }
        }}
      />

      {/* ── SIDE DRAWER ── */}
      {sideDrawerOpen ? (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 }}>
          {/* Backdrop transparente — apenas para capturar toque e fechar */}
          <Pressable
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "transparent" }}
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
              shadowColor: theme.textOnPrimary,
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
                    <View style={{ marginTop: 4, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder }}>
                      <MvText variant="badge" style={{ color: theme.textGreen, fontSize: 10 }}>Profissional</MvText>
                    </View>
                  </View>
                </View>

                {/* ─ Grupo: Conta ─ */}
                <MvText variant="caption" style={{ color: drawerMuted, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 4, letterSpacing: 0.8 }}>
                  CONTA
                </MvText>
                {([
                  { icon: "person-outline" as const, label: "Meu perfil", onPress: () => { closeDrawer(); (navigation as any).navigate("ProfessionalTabs", { screen: "ProfessionalProfileEditor" }); } },
                  { icon: "lock-closed-outline" as const, label: "Segurança", onPress: () => { closeDrawer(); goToStack("Security"); } },
                  { icon: "card-outline" as const, label: "Conta de recebimento", onPress: () => { closeDrawer(); goToStack("ConnectPayoutAccount"); } },
                ] as const).map((item) => (
                  <TouchableOpacity
                    key={item.label}
                    onPress={item.onPress}
                    activeOpacity={0.75}
                    style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: drawerDivider }}
                  >
                    <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name={item.icon} size={16} color={theme.textGreen} />
                    </View>
                    <MvText variant="semi2" style={{ flex: 1, color: drawerText }}>{item.label}</MvText>
                    <Ionicons name="chevron-forward" size={15} color={drawerMuted} />
                  </TouchableOpacity>
                ))}

                {/* ─ Grupo: Preferências ─ */}
                <MvText variant="caption" style={{ color: drawerMuted, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 4, letterSpacing: 0.8 }}>
                  PREFERÊNCIAS
                </MvText>
                <TouchableOpacity
                  activeOpacity={1}
                  style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: drawerDivider }}
                >
                  <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name={isLight ? "sunny-outline" : "moon-outline"} size={16} color={theme.textGreen} />
                  </View>
                  <MvText variant="semi2" style={{ flex: 1, color: drawerText }}>Modo light</MvText>
                  <MvToggle value={isLight} onValueChange={() => toggleTheme()} />
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={1}
                  style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: drawerDivider }}
                >
                  <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="notifications-outline" size={16} color={theme.textGreen} />
                  </View>
                  <MvText variant="semi2" style={{ flex: 1, color: drawerText }}>Notificações</MvText>
                  <MvToggle value={pushEnabled} onValueChange={setPushEnabled} />
                </TouchableOpacity>

                {/* ─ Grupo: Mais ─ */}
                <MvText variant="caption" style={{ color: drawerMuted, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 4, letterSpacing: 0.8 }}>
                  MAIS
                </MvText>
                {([
                  { icon: "help-circle-outline" as const, label: "Suporte", onPress: () => { closeDrawer(); goToStack("Support"); } },
                  { icon: "share-social-outline" as const, label: "Indicar o app", onPress: () => { closeDrawer(); handleShareApp(); } },
                  { icon: "star-outline" as const, label: "Avalie o app", onPress: () => { closeDrawer(); handleRateApp(); } },
                ] as const).map((item) => (
                  <TouchableOpacity
                    key={item.label}
                    onPress={item.onPress}
                    activeOpacity={0.75}
                    style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: drawerDivider }}
                  >
                    <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name={item.icon} size={16} color={theme.textGreen} />
                    </View>
                    <MvText variant="semi2" style={{ flex: 1, color: drawerText }}>{item.label}</MvText>
                    <Ionicons name="chevron-forward" size={15} color={drawerMuted} />
                  </TouchableOpacity>
                ))}

                {/* ─ Sair ─ */}
                <TouchableOpacity
                  onPress={handleSignOut}
                  activeOpacity={0.75}
                  style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingVertical: 15, marginTop: 12 }}
                >
                  <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: "rgba(239,68,68,0.10)", borderWidth: 1, borderColor: "rgba(239,68,68,0.25)", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="log-out-outline" size={16} color={theme.danger} />
                  </View>
                  <MvText variant="semi2" style={{ color: theme.danger }}>Sair</MvText>
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

    </View>
  );
}
