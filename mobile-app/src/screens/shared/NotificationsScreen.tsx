import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { FlatList, RefreshControl, StatusBar, View } from "react-native";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Booking,
  bookingsApi,
  consultancyApi,
  paymentsApi,
  notificationsApi,
  NotificationInboxItem,
  ProviderServiceOffer,
  providersApi,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { handleScreenError } from "./api-helpers";
import { formatCurrencyBRL } from "../../utils/formatters";
import { MvButton } from "../../components/mv/MvButton";
import { MvText } from "../../components/mv/MvText";
import { PressableScale } from "../../components/polish/PressableScale";
import { C, S } from "../../theme/v2tokens";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvTheme } from "../../theme/MvColors";

const CLIENT_SEARCH_RADIUS_KEY = "@personalapp/clientSearchRadiusKm";
const CLIENT_SEARCH_CENTER_KEY = "@personalapp/clientSearchCenter";
const MARKET_LOOKBACK_DAYS = 21;
const MAX_NEARBY_PROVIDERS = 12;

type NotificationVariant = "green" | "orange" | "red" | "blue" | "gray";

type NotificationAction =
  | { type: "BOOKING_DETAIL"; bookingId: string }
  | { type: "BOOKING_CHAT"; bookingId: string }
  | { type: "BOOKING_PAYMENT_STATUS"; bookingId?: string }
  | { type: "CLIENT_BOOKINGS" }
  | { type: "CLIENT_PAYMENT_METHOD" }
  | { type: "CLIENT_TRAINING" }
  | { type: "CLIENT_ARCHIVED_REQUESTS" }
  | { type: "CLIENT_PROMOTIONS" }
  | { type: "PRESENTIAL_PACKAGE_DETAIL"; packageId: string }
  | { type: "PROVIDER_AGENDA" }
  | { type: "PROVIDER_CONSULTANCY_CENTER" }
  | { type: "PROVIDER_ARCHIVED_REQUESTS" }
  | { type: "PROVIDER_CREDENTIALS" }
  | { type: "PROVIDER_PAYOUT_SETUP" }
  | { type: "SUPPORT" }
  | { type: "NONE" };

type NotificationItem = {
  id: string;
  source: "inbox" | "booking" | "market" | "config";
  title: string;
  body: string;
  timeLabel: string;
  icon: keyof typeof Ionicons.glyphMap;
  variant: NotificationVariant;
  unread: boolean;
  createdAtMs: number;
  action: NotificationAction;
  data?: Record<string, string>;
};

type ScreenCategory = "Todas" | "Agenda" | "Mercado" | "Aviso";
const SCREEN_CATEGORIES: ScreenCategory[] = ["Todas", "Agenda", "Mercado", "Aviso"];

function itemCategory(item: NotificationItem): ScreenCategory {
  if (item.source === "market") return "Mercado";
  if (item.source === "config") return "Aviso";
  return "Agenda";
}

function variantTone(variant: NotificationVariant, theme: MvTheme) {
  if (variant === "green") return { text: theme.primary, border: theme.primarySubtleBorder, bg: theme.primarySubtle };
  if (variant === "orange") return { text: C.amber, border: C.amberBorder, bg: C.amberDim };
  if (variant === "red") return { text: theme.danger, border: "rgba(239,68,68,0.20)", bg: "rgba(239,68,68,0.10)" };
  if (variant === "blue") return { text: C.sky, border: C.skyBorder, bg: C.skyDim };
  return { text: theme.text2, border: theme.border, bg: theme.inputBg };
}

function toMs(value?: string | null) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function formatDateTime(iso?: string | null) {
  if (!iso) return "Agora";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "Agora";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

function stringValue(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function normalizeDataRecord(data?: NotificationInboxItem["data"] | null) {
  if (!data || typeof data !== "object") {
    return {};
  }
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    const normalized = stringValue(value);
    if (normalized) {
      record[key] = normalized;
    }
  }
  return record;
}

function resolveInboxAction(
  data: Record<string, string>,
  role?: "CLIENT" | "PROVIDER" | "ADMIN" | null
): NotificationAction {
  if (role === "ADMIN") {
    return { type: "NONE" };
  }

  const type = (data.type ?? data.event ?? "").toUpperCase();
  const bookingId = data.bookingId;
  const requestId = data.requestId;
  const contractId = data.contractId;
  const packageId = data.packageId;

  if (type === "COMBO_CONSULTANCY_AUTO_REFUND") {
    return packageId
      ? { type: "PRESENTIAL_PACKAGE_DETAIL", packageId }
      : role === "PROVIDER"
        ? { type: "PROVIDER_CONSULTANCY_CENTER" }
        : { type: "CLIENT_TRAINING" };
  }

  if (type === "CHAT_MESSAGE") {
    return bookingId
      ? { type: "BOOKING_CHAT", bookingId }
      : role === "PROVIDER"
        ? { type: "PROVIDER_AGENDA" }
        : { type: "CLIENT_BOOKINGS" };
  }

  if (type.startsWith("BOOKING_")) {
    return bookingId
      ? { type: "BOOKING_DETAIL", bookingId }
      : role === "PROVIDER"
        ? { type: "PROVIDER_AGENDA" }
        : { type: "CLIENT_BOOKINGS" };
  }

  if (type.startsWith("PAYMENT_")) {
    if (bookingId) {
      return { type: "BOOKING_PAYMENT_STATUS", bookingId };
    }
    return role === "PROVIDER"
      ? { type: "PROVIDER_PAYOUT_SETUP" }
      : { type: "CLIENT_PAYMENT_METHOD" };
  }

  if (type === "SUPPORT_REPLY") {
    return { type: "SUPPORT" };
  }

  if (type.startsWith("CREF_")) {
    return { type: "PROVIDER_CREDENTIALS" };
  }

  if (type.startsWith("CONSULTANCY_")) {
    if (type === "CONSULTANCY_REQUEST_RESPONDED" || type === "CONSULTANCY_TRAINING_DELIVERED") {
      return { type: "CLIENT_TRAINING" };
    }
    if (type === "CONSULTANCY_AUTO_REFUND") {
      return { type: "CLIENT_ARCHIVED_REQUESTS" };
    }
    if (type === "CONSULTANCY_CONTRACT_EXPIRED") {
      return { type: "PROVIDER_ARCHIVED_REQUESTS" };
    }
    if (
      type === "CONSULTANCY_REQUEST_CREATED" ||
      type === "CONSULTANCY_PROPOSAL_REFUSED" ||
      type === "CONSULTANCY_CONTRACT_ACCEPTED"
    ) {
      return { type: "PROVIDER_CONSULTANCY_CENTER" };
    }
    return role === "PROVIDER"
      ? { type: "PROVIDER_CONSULTANCY_CENTER" }
      : { type: "CLIENT_TRAINING" };
  }

  if (bookingId) {
    return { type: "BOOKING_DETAIL", bookingId };
  }
  if (requestId || contractId) {
    return role === "PROVIDER"
      ? { type: "PROVIDER_CONSULTANCY_CENTER" }
      : { type: "CLIENT_TRAINING" };
  }
  return role === "PROVIDER" ? { type: "PROVIDER_AGENDA" } : { type: "CLIENT_BOOKINGS" };
}

function toBookingNotification(booking: Booking): NotificationItem {
  const name = booking.provider?.displayName ?? booking.client?.name ?? "Profissional";
  const when = formatDateTime(booking.scheduledAt);
  const createdAtMs = toMs(booking.updatedAt ?? booking.createdAt ?? booking.scheduledAt) ?? Date.now();

  if (booking.status === "PENDING") {
    return {
      id: `booking-pending-${booking.id}`,
      source: "booking",
      title: "Pré-autorização pendente",
      body: `${name} • aguardando confirmação (${when}).`,
      timeLabel: when,
      icon: "time-outline",
      variant: "orange",
      unread: true,
      createdAtMs,
      action: { type: "BOOKING_DETAIL", bookingId: booking.id },
    };
  }
  if (booking.status === "CONFIRMED") {
    return {
      id: `booking-confirmed-${booking.id}`,
      source: "booking",
      title: "Agendamento confirmado",
      body: `${name} confirmou sua sessão (${when}).`,
      timeLabel: when,
      icon: "checkmark-circle-outline",
      variant: "green",
      unread: true,
      createdAtMs,
      action: { type: "BOOKING_DETAIL", bookingId: booking.id },
    };
  }
  if (booking.status === "CANCELLED") {
    return {
      id: `booking-cancelled-${booking.id}`,
      source: "booking",
      title: "Agendamento cancelado",
      body: `${name} cancelou a sessão (${when}).`,
      timeLabel: when,
      icon: "close-circle-outline",
      variant: "red",
      unread: false,
      createdAtMs,
      action: { type: "BOOKING_DETAIL", bookingId: booking.id },
    };
  }
  return {
    id: `booking-completed-${booking.id}`,
    source: "booking",
    title: "Sessão concluída",
    body: `${name} concluiu o atendimento (${when}).`,
    timeLabel: when,
    icon: "flag-outline",
    variant: "blue",
    unread: false,
    createdAtMs,
    action: { type: "BOOKING_DETAIL", bookingId: booking.id },
  };
}

function toInboxNotification(
  item: NotificationInboxItem,
  role?: "CLIENT" | "PROVIDER" | "ADMIN" | null
): NotificationItem {
  const data = normalizeDataRecord(item.data);
  const rawType = String(data.type ?? data.event ?? "").toLowerCase();
  const icon: keyof typeof Ionicons.glyphMap = rawType.includes("chat")
    ? "chatbubble-ellipses-outline"
    : rawType.includes("support")
      ? "help-buoy-outline"
      : rawType.includes("consultancy")
        ? "school-outline"
        : rawType.includes("promo")
    ? "pricetag-outline"
    : rawType.includes("booking")
      ? "calendar-outline"
      : rawType.includes("payment")
        ? "card-outline"
        : "notifications-outline";

  const variant: NotificationVariant = rawType.includes("error") || rawType.includes("failed")
    ? "red"
    : rawType.includes("rejected") || rawType.includes("refused")
    ? "red"
    : rawType.includes("promo")
      ? "green"
      : "blue";

  return {
    id: `inbox-${item.id}`,
    source: "inbox",
    title: item.title,
    body: item.body,
    timeLabel: formatDateTime(item.createdAt),
    icon,
    variant,
    unread: !item.readAt,
    createdAtMs: toMs(item.createdAt) ?? Date.now(),
    action: resolveInboxAction(data, role),
    data,
  };
}

function toMarketNotification(
  providerName: string,
  offer: ProviderServiceOffer,
  nowMs: number
): NotificationItem | null {
  if (!offer.isActive) return null;
  const referenceMs = toMs(offer.updatedAt ?? offer.createdAt) ?? nowMs;
  const lookbackMs = MARKET_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  if (offer.isPromotionActive && offer.promotionPriceCents) {
    const promoValue = formatCurrencyBRL(offer.promotionPriceCents / 100);
    return {
      id: `market-promo-${offer.id}`,
      source: "market",
      title: "Promoção perto de você",
      body: `${providerName} atualizou "${offer.title}" por ${promoValue}.`,
      timeLabel: formatDateTime(offer.updatedAt ?? offer.createdAt),
      icon: "pricetag-outline",
      variant: "green",
      unread: false,
      createdAtMs: referenceMs,
      action: { type: "CLIENT_PROMOTIONS" },
    };
  }

  if (referenceMs >= nowMs - lookbackMs) {
    return {
      id: `market-new-service-${offer.id}`,
      source: "market",
      title: "Novo serviço no seu raio",
      body: `${providerName} adicionou "${offer.title}".`,
      timeLabel: formatDateTime(offer.createdAt ?? offer.updatedAt),
      icon: "sparkles-outline",
      variant: "blue",
      unread: false,
      createdAtMs: referenceMs,
      action: { type: "CLIENT_PROMOTIONS" },
    };
  }

  return null;
}

function uniqueById(items: NotificationItem[]) {
  const map = new Map<string, NotificationItem>();
  for (const item of items) {
    if (!map.has(item.id)) {
      map.set(item.id, item);
    }
  }
  return [...map.values()];
}

export function NotificationsScreen({ navigation }: { navigation?: any }) {
  const { theme } = useMvTheme();
  const { runWithAuth, showToast, role } = useAppState();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const notifQueryKey = ["notifications", "inbox", role] as const;
  const [activeCategory, setActiveCategory] = useState<ScreenCategory>("Todas");

  const loadNearbyMarketNotifications = useCallback(async (): Promise<NotificationItem[]> => {
    if (role !== "CLIENT") return [];
    try {
      const [savedRadius, savedCenter] = await Promise.all([
        AsyncStorage.getItem(CLIENT_SEARCH_RADIUS_KEY),
        AsyncStorage.getItem(CLIENT_SEARCH_CENTER_KEY),
      ]);
      const parsedRadius = Number(savedRadius);
      const radiusKm = Number.isFinite(parsedRadius)
        ? Math.max(1, Math.min(10, Math.round(parsedRadius)))
        : 5;

      let lat: number | null = null;
      let lng: number | null = null;
      if (savedCenter) {
        try {
          const parsed = JSON.parse(savedCenter) as { lat?: number; lng?: number };
          if (typeof parsed.lat === "number" && typeof parsed.lng === "number") {
            lat = parsed.lat;
            lng = parsed.lng;
          }
        } catch { /* ignore */ }
      }

      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.granted) {
        const currentPosition =
          (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null)) ??
          (await Location.getLastKnownPositionAsync().catch(() => null));
        if (currentPosition) {
          lat = currentPosition.coords.latitude;
          lng = currentPosition.coords.longitude;
        }
      }

      if (typeof lat !== "number" || typeof lng !== "number") return [];

      const nearbyProviders = await providersApi.list({ lat, lng, maxDistanceKm: radiusKm });
      if (nearbyProviders.length === 0) return [];

      const providerCatalogs = await Promise.all(
        nearbyProviders.slice(0, MAX_NEARBY_PROVIDERS).map(async (provider) => {
          try {
            const catalog = await consultancyApi.providerCatalog(provider.id);
            return { providerName: catalog.provider.displayName || provider.displayName, offers: catalog.offers };
          } catch {
            return { providerName: provider.displayName, offers: [] as ProviderServiceOffer[] };
          }
        })
      );

      const nowMs = Date.now();
      const marketItems: NotificationItem[] = [];
      for (const catalog of providerCatalogs) {
        for (const offer of catalog.offers) {
          const nextItem = toMarketNotification(catalog.providerName, offer, nowMs);
          if (nextItem) marketItems.push(nextItem);
        }
      }
      return uniqueById(marketItems).sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, 25);
    } catch {
      return [];
    }
  }, [role]);

  const loadPendingConfigNotifications = useCallback(async (): Promise<NotificationItem[]> => {
    const now = Date.now();

    if (role === "CLIENT") {
      const paymentStatus = await runWithAuth((token) => paymentsApi.customerStatus(token)).catch(() => null);
      if (!paymentStatus || paymentStatus.configured) return [] as NotificationItem[];
      return [{
        id: "config-client-payment-method",
        source: "config",
        title: "Configuração pendente",
        body: "Adicione um método de pagamento para concluir solicitações e atualizações de agendamento.",
        timeLabel: "Agora",
        icon: "card-outline",
        variant: "orange" as NotificationVariant,
        unread: true,
        createdAtMs: now,
        action: { type: "CLIENT_PAYMENT_METHOD" as const },
      }];
    }

    if (role === "PROVIDER") {
      const [providerPaymentStatus, credentials] = await runWithAuth((token) =>
        Promise.all([
          paymentsApi.providerStatus(token).catch(() => null),
          providersApi.myCredentials(token).catch(() => null),
        ])
      ).catch(() => [null, null] as const);

      const pending: NotificationItem[] = [];

      if (providerPaymentStatus && !providerPaymentStatus.hasAccount) {
        pending.push({
          id: "config-provider-payout-account",
          source: "config",
          title: "Conta de recebimento pendente",
          body: "Conecte sua conta para receber pelos atendimentos concluídos.",
          timeLabel: "Agora",
          icon: "wallet-outline",
          variant: "orange",
          unread: true,
          createdAtMs: now,
          action: { type: "PROVIDER_PAYOUT_SETUP" },
        });
      }

      if (credentials && credentials.crefValidationStatus !== "APPROVED") {
        const isRejected = credentials?.crefValidationStatus === "REJECTED";
        const isInReview = credentials?.crefValidationStatus === "IN_REVIEW";
        pending.push({
          id: isRejected ? "config-provider-cref-rejected" : isInReview ? "config-provider-cref-in-review" : "config-provider-cref-pending",
          source: "config",
          title: isRejected ? "CREF reprovado" : isInReview ? "CREF em análise" : "CREF pendente",
          body: isRejected
            ? "Seu CREF foi reprovado. Ajuste os documentos para seguir usando os recursos profissionais."
            : "Publicar ofertas depende da aprovação do seu CREF. Valide seus documentos para liberar sua consultoria para os alunos.",
          timeLabel: "Agora",
          icon: "document-text-outline",
          variant: isRejected ? "red" : "orange",
          unread: true,
          createdAtMs: now - 1,
          action: { type: "PROVIDER_CREDENTIALS" },
        });
      }

      return pending;
    }

    return [] as NotificationItem[];
  }, [role, runWithAuth]);

  const { data: notifications = [], isLoading: loading, refetch, error } = useQuery<NotificationItem[]>({
    queryKey: notifQueryKey,
    queryFn: async () => {
      const { bookings, inbox } = await runWithAuth(async (token) => {
        const [bookingResult, inboxResult] = await Promise.all([
          bookingsApi.me(token),
          notificationsApi.inbox(token, 120),
        ]);
        return { bookings: bookingResult, inbox: inboxResult };
      });
      const inboxNotifications = inbox.map((item) => toInboxNotification(item, role));
      const hasBookingContext = inboxNotifications.some((item) =>
        item.action.type === "BOOKING_DETAIL" ||
        item.action.type === "BOOKING_CHAT" ||
        item.action.type === "BOOKING_PAYMENT_STATUS"
      );
      const fallbackBookingNotifications = !hasBookingContext
        ? bookings.slice(0, 12).map(toBookingNotification)
        : [];
      const [marketNotifications, pendingConfigNotifications] = await Promise.all([
        loadNearbyMarketNotifications(),
        loadPendingConfigNotifications(),
      ]);
      return uniqueById([
        ...pendingConfigNotifications,
        ...marketNotifications,
        ...inboxNotifications,
        ...fallbackBookingNotifications,
      ]).sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, 80);
    },
  });

  useEffect(() => {
    if (error) handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar notificações." });
  }, [error, showToast]);

  const unreadCount = useMemo(
    () => notifications.filter((item) => item.unread).length,
    [notifications]
  );

  const clearAll = useCallback(async () => {
    try {
      await runWithAuth((token) => notificationsApi.markAllRead(token));
    } catch { /* best effort */ }
    queryClient.setQueryData(notifQueryKey, []);
  }, [notifQueryKey, queryClient, runWithAuth]);

  const openBookingDetail = useCallback(
    (bookingId: string) => {
      if (!navigation || !bookingId) return;
      if (role === "PROVIDER") {
        navigation.navigate("BookingDetailProfessional", { bookingId });
        return;
      }
      navigation.navigate("ClientBookingDetail", { bookingId });
    },
    [navigation, role]
  );

  const openBookingChat = useCallback(() => {
    if (!navigation) return;
    if (role === "PROVIDER") {
      navigation.navigate("ProfessionalChatList");
    } else {
      navigation.navigate("ClientChatList");
    }
  }, [navigation, role]);

  const handleNotificationPress = useCallback(
    (item: NotificationItem) => {
      queryClient.setQueryData<NotificationItem[]>(notifQueryKey, (old) =>
        (old ?? []).map((entry) => entry.id === item.id ? { ...entry, unread: false } : entry)
      );
      if (!navigation) return;
      switch (item.action.type) {
        case "BOOKING_DETAIL": openBookingDetail(item.action.bookingId); return;
        case "BOOKING_CHAT": openBookingChat(); return;
        case "BOOKING_PAYMENT_STATUS":
          if (role === "PROVIDER") {
            if (item.action.bookingId) navigation.navigate("BookingPaymentStatus", { bookingId: item.action.bookingId });
            else navigation.navigate("PayoutStatus");
            return;
          }
          if (item.action.bookingId) navigation.navigate("BookingPaymentStatus", { bookingId: item.action.bookingId });
          else navigation.navigate("ClientPaymentMethod");
          return;
        case "CLIENT_BOOKINGS":
          if (role === "PROVIDER") navigation.navigate("ProfessionalTabs", { screen: "ProfessionalAgenda" });
          else navigation.navigate("ClientBookings");
          return;
        case "CLIENT_PAYMENT_METHOD": if (role === "CLIENT") navigation.navigate("ClientPaymentMethod"); return;
        case "CLIENT_TRAINING": if (role === "CLIENT") navigation.navigate("ClientTabs", { screen: "MyTraining" }); return;
        case "CLIENT_ARCHIVED_REQUESTS": if (role === "CLIENT") navigation.navigate("ArchivedRequests"); return;
        case "CLIENT_PROMOTIONS": if (role === "CLIENT") navigation.navigate("ClientTabs", { screen: "Promotions" }); return;
        case "PRESENTIAL_PACKAGE_DETAIL":
          if (role === "CLIENT") navigation.navigate("PresentialPackageDetail", { packageId: item.action.packageId });
          return;
        case "PROVIDER_AGENDA": if (role === "PROVIDER") navigation.navigate("ProfessionalTabs", { screen: "ProfessionalAgenda" }); return;
        case "PROVIDER_CONSULTANCY_CENTER": if (role === "PROVIDER") navigation.navigate("ProfessionalConsultancyCenter"); return;
        case "PROVIDER_ARCHIVED_REQUESTS": if (role === "PROVIDER") navigation.navigate("ProfessionalArchivedRequests"); return;
        case "PROVIDER_CREDENTIALS": if (role === "PROVIDER") navigation.navigate("ProfessionalCredentials"); return;
        case "PROVIDER_PAYOUT_SETUP": if (role === "PROVIDER") navigation.navigate("ConnectPayoutAccount"); return;
        case "SUPPORT": navigation.navigate("Support"); return;
        case "NONE": return;
        default: return;
      }
    },
    [navigation, openBookingChat, openBookingDetail, role]
  );

  const filteredNotifications = useMemo(() => {
    if (activeCategory === "Todas") return notifications;
    return notifications.filter((item) => itemCategory(item) === activeCategory);
  }, [notifications, activeCategory]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      {/* Header */}
      <View style={{
        paddingTop: insets.top + 10, paddingHorizontal: S.px, paddingBottom: 12,
        borderBottomWidth: 1, borderBottomColor: theme.border,
      }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
          {navigation?.canGoBack?.() ? (
            <PressableScale
              onPress={() => navigation.goBack()}
              accessibilityRole="button"
              accessibilityLabel="Voltar"
              style={{
                width: 44, height: 44, borderRadius: 12,
                backgroundColor: theme.inputBg,
                alignItems: "center", justifyContent: "center",
                marginTop: 4,
              }}
            >
              <Ionicons name="chevron-back" size={20} color={theme.text1} />
            </PressableScale>
          ) : null}

          <View style={{ flex: 1 }}>
            <MvText variant="badge" style={{ color: theme.primary, letterSpacing: 1 }}>
              Central de avisos
            </MvText>
            <MvText variant="h1" style={{ marginTop: 4 }}>Notificações</MvText>
            {!loading ? (
              <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
                <View style={{
                  backgroundColor: unreadCount > 0 ? theme.primarySubtle : theme.inputBg,
                  borderWidth: 1,
                  borderColor: unreadCount > 0 ? theme.primarySubtleBorder : theme.border,
                  borderRadius: S.chipR, paddingHorizontal: 10, paddingVertical: 3,
                }}>
                  <MvText variant="badge" style={{ color: unreadCount > 0 ? theme.primary : theme.text2 }}>
                    {unreadCount > 0 ? `${unreadCount} não lida${unreadCount !== 1 ? "s" : ""}` : "Em dia"}
                  </MvText>
                </View>
              </View>
            ) : null}
          </View>

          {notifications.length > 0 ? (
            <PressableScale
              onPress={() => void clearAll()}
              accessibilityRole="button"
              accessibilityLabel="Limpar notificações"
              style={{
                width: 44, height: 44, borderRadius: 12,
                backgroundColor: theme.inputBg,
                alignItems: "center", justifyContent: "center",
                marginTop: 4,
              }}
            >
              <Ionicons name="trash-outline" size={16} color={theme.text2} />
            </PressableScale>
          ) : null}
        </View>
      </View>

      {/* Filtros de categoria */}
      <FlatList
        horizontal
        data={SCREEN_CATEGORIES}
        keyExtractor={(item) => item}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: S.px, gap: 6, paddingVertical: 10 }}
        renderItem={({ item }) => {
          const active = activeCategory === item;
          return (
            <PressableScale
              onPress={() => setActiveCategory(item)}
              accessibilityRole="button"
              accessibilityLabel={`Filtrar por ${item}`}
              accessibilityState={{ selected: active }}
              style={{
                minHeight: 44, paddingHorizontal: 14, paddingVertical: 10,
                borderRadius: S.chipR, borderWidth: 1,
                borderColor: active ? theme.primarySubtleBorder : theme.border,
                backgroundColor: active ? theme.primarySubtle : "rgba(255,255,255,0.03)",
                justifyContent: "center",
              }}
            >
              <MvText variant="badge" style={{ color: active ? theme.text1 : theme.text2 }}>
                {item}
              </MvText>
            </PressableScale>
          );
        }}
      />

      {/* Lista de notificações */}
      <FlatList
        contentContainerStyle={{ paddingHorizontal: S.px, paddingBottom: 100, gap: 8 }}
        data={filteredNotifications}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void refetch()}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => {
          const isBookingCreatedClient =
            role === "CLIENT" &&
            item.data?.type === "BOOKING_CREATED" &&
            item.data?.role === "client" &&
            item.data?.bookingId;

          const isBookingCreatedProvider =
            role === "PROVIDER" &&
            item.data?.type === "BOOKING_CREATED" &&
            item.data?.role === "provider" &&
            item.data?.bookingId;

          if (isBookingCreatedClient) {
            return (
              <View style={{
                borderRadius: 20, borderWidth: 1, borderColor: theme.primarySubtleBorder,
                backgroundColor: "rgba(36,230,109,0.05)", padding: 12, gap: 12,
                opacity: item.unread ? 1 : 0.82,
              }}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                  <View style={{
                    width: 38, height: 38, borderRadius: 14,
                    backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder,
                    alignItems: "center", justifyContent: "center",
                  }}>
                    <Ionicons name="calendar-outline" size={18} color={theme.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <MvText variant="semi3" style={{ lineHeight: 18 }}>{item.title}</MvText>
                    <MvText variant="body4" color="secondary" style={{ lineHeight: 16, marginTop: 4, fontSize: 11 }}>{item.body}</MvText>
                    <MvText variant="body4" color="tertiary" style={{ marginTop: 2, fontSize: 10 }}>{item.timeLabel}</MvText>
                  </View>
                  {item.unread ? (
                    <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.primary, shadowColor: theme.primary, shadowOpacity: 1, shadowRadius: 3, elevation: 2, marginTop: 6 }} />
                  ) : null}
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  <PressableScale
                    onPress={() => openBookingChat()}
                    accessibilityRole="button"
                    accessibilityLabel="Abrir conversas"
                    style={{
                      flexDirection: "row", alignItems: "center", gap: 5,
                      backgroundColor: theme.primary, paddingHorizontal: 14,
                      paddingVertical: 12, borderRadius: 12, minHeight: 44,
                    }}
                  >
                    <Ionicons name="chatbubble-ellipses-outline" size={14} color={theme.textOnPrimary} />
                    <MvText variant="semi3" style={{ color: theme.textOnPrimary, fontSize: 12 }}>Abrir Conversas</MvText>
                  </PressableScale>
                  <PressableScale
                    onPress={() => handleNotificationPress(item)}
                    accessibilityRole="button"
                    accessibilityLabel="Ver agendamento"
                    style={{
                      flexDirection: "row", alignItems: "center", gap: 5,
                      borderWidth: 1, borderColor: theme.primarySubtleBorder,
                      paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12, minHeight: 44,
                    }}
                  >
                    <MvText variant="semi3" style={{ color: theme.primary, fontSize: 12 }}>Ver Agendamento</MvText>
                  </PressableScale>
                </View>
              </View>
            );
          }

          if (isBookingCreatedProvider) {
            const clientId = item.data?.clientId;
            const clientName = item.data?.clientName ?? "Aluno";
            const anamnesisStatus = item.data?.anamnesisStatus ?? "NONE";
            const anamnesisLabel =
              anamnesisStatus === "COMPLETED" ? "Ficha preenchida" :
              anamnesisStatus === "DRAFT" ? "Ficha incompleta" :
              "Sem ficha ainda";
            const anamnesisColor =
              anamnesisStatus === "COMPLETED" ? theme.primary :
              anamnesisStatus === "DRAFT" ? C.amber : theme.text3;

            return (
              <View style={{
                borderRadius: 20, borderWidth: 1, borderColor: C.skyBorder,
                backgroundColor: C.skyDim, padding: 12, gap: 12,
                opacity: item.unread ? 1 : 0.82,
              }}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                  <View style={{
                    width: 38, height: 38, borderRadius: 14,
                    backgroundColor: C.skyDim, borderWidth: 1, borderColor: C.skyBorder,
                    alignItems: "center", justifyContent: "center",
                  }}>
                    <Ionicons name="person-add-outline" size={18} color={C.sky} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <MvText variant="semi3" style={{ lineHeight: 18 }}>{item.title}</MvText>
                    <MvText variant="body4" color="secondary" style={{ lineHeight: 16, marginTop: 4, fontSize: 11 }}>{item.body}</MvText>
                    <MvText variant="semi3" style={{ color: anamnesisColor, marginTop: 4, fontSize: 11 }}>{anamnesisLabel}</MvText>
                    <MvText variant="body4" color="tertiary" style={{ marginTop: 2, fontSize: 10 }}>{item.timeLabel}</MvText>
                  </View>
                  {item.unread ? (
                    <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.sky, shadowColor: C.sky, shadowOpacity: 1, shadowRadius: 3, elevation: 2, marginTop: 6 }} />
                  ) : null}
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  <PressableScale
                    onPress={() => openBookingChat()}
                    accessibilityRole="button"
                    accessibilityLabel="Abrir conversas"
                    style={{
                      flexDirection: "row", alignItems: "center", gap: 5,
                      backgroundColor: C.sky, paddingHorizontal: 14,
                      paddingVertical: 12, borderRadius: 12, minHeight: 44,
                    }}
                  >
                    <Ionicons name="chatbubble-ellipses-outline" size={14} color={theme.textOnPrimary} />
                    <MvText variant="semi3" style={{ color: theme.textOnPrimary, fontSize: 12 }}>Conversas</MvText>
                  </PressableScale>
                  {clientId ? (
                    <PressableScale
                      onPress={() => navigation?.navigate("ProfessionalStudentAnamnesis", { clientId, clientName })}
                      accessibilityRole="button"
                      accessibilityLabel="Ver ficha do aluno"
                      style={{
                        flexDirection: "row", alignItems: "center", gap: 5,
                        borderWidth: 1, borderColor: C.skyBorder,
                        paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12, minHeight: 44,
                      }}
                    >
                      <Ionicons name="document-text-outline" size={13} color={C.sky} />
                      <MvText variant="semi3" style={{ color: C.sky, fontSize: 12 }}>Ficha do Aluno</MvText>
                    </PressableScale>
                  ) : null}
                  <PressableScale
                    onPress={() => handleNotificationPress(item)}
                    accessibilityRole="button"
                    accessibilityLabel="Ver detalhes"
                    style={{
                      flexDirection: "row", alignItems: "center", gap: 5,
                      borderWidth: 1, borderColor: theme.border,
                      paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12, minHeight: 44,
                    }}
                  >
                    <MvText variant="semi3" color="secondary" style={{ fontSize: 12 }}>Detalhes</MvText>
                  </PressableScale>
                </View>
              </View>
            );
          }

          const tone = variantTone(item.variant, theme);
          return (
            <PressableScale
              onPress={() => handleNotificationPress(item)}
              accessibilityRole="button"
              style={{
                borderRadius: 20, borderWidth: 1,
                borderColor: item.unread ? tone.border : theme.border,
                backgroundColor: item.unread ? "rgba(36,230,109,0.04)" : "rgba(255,255,255,0.025)",
                padding: 12,
                opacity: item.unread ? 1 : 0.72,
                minHeight: 44,
              }}
            >
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{
                  width: 38, height: 38, borderRadius: 14,
                  backgroundColor: tone.bg, borderWidth: 1, borderColor: tone.border,
                  alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  <Ionicons name={item.icon} size={16} color={tone.text} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
                    <MvText variant="semi3" style={{ lineHeight: 18, flex: 1, fontSize: 13 }} numberOfLines={2}>
                      {item.title}
                    </MvText>
                    <MvText variant="body4" color="tertiary" style={{ flexShrink: 0, fontSize: 10 }}>
                      {item.timeLabel}
                    </MvText>
                  </View>
                  <MvText variant="body4" color="secondary" style={{ lineHeight: 16, marginTop: 4, fontSize: 11 }} numberOfLines={2}>
                    {item.body}
                  </MvText>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                    <View style={{
                      backgroundColor: tone.bg, borderWidth: 1, borderColor: tone.border,
                      borderRadius: S.chipR, paddingHorizontal: 8, paddingVertical: 2,
                    }}>
                      <MvText variant="badge" style={{ color: tone.text, fontSize: 10 }}>{itemCategory(item)}</MvText>
                    </View>
                    {item.unread ? (
                      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.primary, shadowColor: theme.primary, shadowOpacity: 1, shadowRadius: 3, elevation: 2 }} />
                    ) : null}
                  </View>
                </View>
              </View>
            </PressableScale>
          );
        }}
        ListEmptyComponent={
          !loading ? (
            <View style={{ paddingTop: 60, alignItems: "center", gap: 8 }}>
              <Ionicons name="notifications-off-outline" size={38} color={theme.text3} />
              <MvText variant="body4" color="tertiary">Nenhuma notificação encontrada.</MvText>
            </View>
          ) : null
        }
      />

      {/* Footer — Atualizar */}
      <MvButton
        variant="outline"
        label={loading ? "Atualizando..." : "Atualizar"}
        disabled={loading}
        loading={loading}
        onPress={() => void refetch()}
        style={{
          marginHorizontal: S.px,
          marginBottom: Math.max(14, insets.bottom + 14),
        }}
      />
    </View>
  );
}
