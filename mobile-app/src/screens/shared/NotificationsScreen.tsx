import React, { useCallback, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { FlatList, RefreshControl, StatusBar, StyleSheet, TouchableOpacity, View } from "react-native";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvCard, MvText } from "../../components/mv";
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
  const { runWithAuth, showToast, role } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [bookingsById, setBookingsById] = useState<Record<string, Booking>>({});
  const [loading, setLoading] = useState(true);

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
        } catch {
          // ignore invalid stored center
        }
      }

      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.granted) {
        const currentPosition =
          (await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          }).catch(() => null)) ??
          (await Location.getLastKnownPositionAsync().catch(() => null));

        if (currentPosition) {
          lat = currentPosition.coords.latitude;
          lng = currentPosition.coords.longitude;
        }
      }

      if (typeof lat !== "number" || typeof lng !== "number") {
        return [];
      }

      const nearbyProviders = await providersApi.list({
        lat,
        lng,
        maxDistanceKm: radiusKm,
      });

      if (nearbyProviders.length === 0) return [];

      const providerCatalogs = await Promise.all(
        nearbyProviders.slice(0, MAX_NEARBY_PROVIDERS).map(async (provider) => {
          try {
            const catalog = await consultancyApi.providerCatalog(provider.id);
            return {
              providerName: catalog.provider.displayName || provider.displayName,
              offers: catalog.offers,
            };
          } catch {
            return {
              providerName: provider.displayName,
              offers: [] as ProviderServiceOffer[],
            };
          }
        })
      );

      const nowMs = Date.now();
      const marketItems: NotificationItem[] = [];
      for (const catalog of providerCatalogs) {
        for (const offer of catalog.offers) {
          const nextItem = toMarketNotification(catalog.providerName, offer, nowMs);
          if (nextItem) {
            marketItems.push(nextItem);
          }
        }
      }

      return uniqueById(marketItems)
        .sort((a, b) => b.createdAtMs - a.createdAtMs)
        .slice(0, 25);
    } catch {
      return [];
    }
  }, [role]);

  const loadPendingConfigNotifications = useCallback(async (): Promise<NotificationItem[]> => {
    const now = Date.now();

    if (role === "CLIENT") {
      const paymentStatus = await runWithAuth((token) => paymentsApi.customerStatus(token)).catch(() => null);
      if (!paymentStatus || paymentStatus.configured) {
        return [] as NotificationItem[];
      }
      return [
        {
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
        },
      ];
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
          id: isRejected
            ? "config-provider-cref-rejected"
            : isInReview
              ? "config-provider-cref-in-review"
              : "config-provider-cref-pending",
          source: "config",
          title: isRejected ? "CREF reprovado" : isInReview ? "CREF em análise" : "CREF pendente",
          body: isRejected
            ? "Seu CREF foi reprovado. Ajuste os documentos para seguir usando os recursos profissionais."
            : "Esta funcionalidade ficará disponível quando seu CREF for aprovado.",
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

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { bookings, inbox } = await runWithAuth(async (token) => {
        const [bookingResult, inboxResult] = await Promise.all([
          bookingsApi.me(token),
          notificationsApi.inbox(token, 120),
        ]);
        return { bookings: bookingResult, inbox: inboxResult };
      });

      setBookingsById(
        bookings.reduce<Record<string, Booking>>((acc, booking) => {
          acc[booking.id] = booking;
          return acc;
        }, {})
      );

      const inboxNotifications = inbox.map((item) => toInboxNotification(item, role));
      const hasBookingContext = inboxNotifications.some((item) => {
        return (
          item.action.type === "BOOKING_DETAIL" ||
          item.action.type === "BOOKING_CHAT" ||
          item.action.type === "BOOKING_PAYMENT_STATUS"
        );
      });
      const fallbackBookingNotifications =
        !hasBookingContext
          ? bookings
            .slice(0, 12)
            .map(toBookingNotification)
          : [];
      const [marketNotifications, pendingConfigNotifications] = await Promise.all([
        loadNearbyMarketNotifications(),
        loadPendingConfigNotifications(),
      ]);

      const merged = uniqueById([
        ...pendingConfigNotifications,
        ...marketNotifications,
        ...inboxNotifications,
        ...fallbackBookingNotifications,
      ]).sort((a, b) => b.createdAtMs - a.createdAtMs);

      setNotifications(merged.slice(0, 80));
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar notificações." });
    } finally {
      setLoading(false);
    }
  }, [loadNearbyMarketNotifications, loadPendingConfigNotifications, role, runWithAuth, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const unreadCount = useMemo(
    () => notifications.filter((item) => item.unread).length,
    [notifications]
  );

  const clearAll = useCallback(async () => {
    try {
      await runWithAuth((token) => notificationsApi.markAllRead(token));
    } catch {
      // best effort
    }
    setNotifications([]);
  }, [runWithAuth]);

  const variantColor = useCallback(
    (variant: NotificationVariant) => {
      if (variant === "green") return "#22C55E";
      if (variant === "orange") return "#FF9800";
      if (variant === "red") return "#f44336";
      if (variant === "blue") return "#2196F3";
      return theme.text3;
    },
    [theme.text3]
  );

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
    // Todos os chats ficam concentrados na tela Conversas
    if (role === "PROVIDER") {
      navigation.navigate("ProfessionalChatList");
    } else {
      navigation.navigate("ClientChatList");
    }
  }, [navigation, role]);

  const handleNotificationPress = useCallback(
    (item: NotificationItem) => {
      setNotifications((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                unread: false,
              }
            : entry
        )
      );

      if (!navigation) return;

      switch (item.action.type) {
        case "BOOKING_DETAIL":
          openBookingDetail(item.action.bookingId);
          return;
        case "BOOKING_CHAT":
          openBookingChat();
          return;
        case "BOOKING_PAYMENT_STATUS":
          if (role === "PROVIDER") {
            if (item.action.bookingId) {
              navigation.navigate("BookingPaymentStatus", { bookingId: item.action.bookingId });
            } else {
              navigation.navigate("PayoutStatus");
            }
            return;
          }
          if (item.action.bookingId) {
            navigation.navigate("BookingPaymentStatus", { bookingId: item.action.bookingId });
          } else {
            navigation.navigate("ClientPaymentMethod");
          }
          return;
        case "CLIENT_BOOKINGS":
          if (role === "PROVIDER") {
            navigation.navigate("ProfessionalTabs", { screen: "ProfessionalAgenda" });
          } else {
            navigation.navigate("ClientBookings");
          }
          return;
        case "CLIENT_PAYMENT_METHOD":
          if (role === "CLIENT") {
            navigation.navigate("ClientPaymentMethod");
          }
          return;
        case "CLIENT_TRAINING":
          if (role === "CLIENT") {
            navigation.navigate("ClientTabs", { screen: "MyTraining" });
          }
          return;
        case "CLIENT_ARCHIVED_REQUESTS":
          if (role === "CLIENT") {
            navigation.navigate("ArchivedRequests");
          }
          return;
        case "CLIENT_PROMOTIONS":
          if (role === "CLIENT") {
            navigation.navigate("ClientTabs", { screen: "Promotions" });
          }
          return;
        case "PROVIDER_AGENDA":
          if (role === "PROVIDER") {
            navigation.navigate("ProfessionalTabs", { screen: "ProfessionalAgenda" });
          }
          return;
        case "PROVIDER_CONSULTANCY_CENTER":
          if (role === "PROVIDER") {
            navigation.navigate("ProfessionalConsultancyCenter");
          }
          return;
        case "PROVIDER_ARCHIVED_REQUESTS":
          if (role === "PROVIDER") {
            navigation.navigate("ProfessionalArchivedRequests");
          }
          return;
        case "PROVIDER_CREDENTIALS":
          if (role === "PROVIDER") {
            navigation.navigate("ProfessionalCredentials");
          }
          return;
        case "PROVIDER_PAYOUT_SETUP":
          if (role === "PROVIDER") {
            navigation.navigate("ConnectPayoutAccount");
          }
          return;
        case "SUPPORT":
          navigation.navigate("Support");
          return;
        case "NONE":
          return;
        default:
          return;
      }
    },
    [navigation, openBookingChat, openBookingDetail, role]
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar
        barStyle={theme.mode === "dark" ? "light-content" : "dark-content"}
        backgroundColor={theme.bg}
      />

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
        {navigation?.canGoBack?.() ? (
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="chevron-back" size={20} color={theme.text2} />
          </TouchableOpacity>
        ) : null}
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <MvText variant="semi1">Notificações</MvText>
          {!loading ? (
            <MvBadge
              label={unreadCount > 0 ? `${unreadCount} nova(s)` : "Em dia"}
              variant={unreadCount > 0 ? (theme.mode === "light" ? "blue" : "orange") : "gray"}
            />
          ) : null}
        </View>
        {notifications.length > 0 ? (
          <TouchableOpacity
            onPress={() => void clearAll()}
            style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="trash-outline" size={16} color={theme.text3} />
          </TouchableOpacity>
        ) : null}
      </View>

      <FlatList
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 80, gap: 8 }}
        data={notifications}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={load}
            tintColor="#22C55E"
            colors={["#22C55E"]}
          />
        }
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
            const bookingId = item.data!.bookingId!;
            return (
              <MvCard style={[ntfStyles.specialCard, ntfStyles.clientBookingCard, { opacity: item.unread ? 1 : 0.82 }]}>
                <View style={ntfStyles.specialRow}>
                  <View style={[ntfStyles.specialIcon, { backgroundColor: "rgba(34,197,94,0.12)" }]}>
                    <Ionicons name="calendar-outline" size={22} color="#22C55E" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <MvText variant="semi3">{item.title}</MvText>
                    <MvText variant="body4" color="secondary" style={{ marginTop: 2 }}>{item.body}</MvText>
                    <MvText variant="body4" color="tertiary" style={{ marginTop: 2 }}>{item.timeLabel}</MvText>
                  </View>
                  {item.unread ? <MvBadge label="Novo" variant="green" /> : null}
                </View>
                <View style={ntfStyles.ctaRow}>
                  <TouchableOpacity
                    style={ntfStyles.ctaBtn}
                    onPress={() => openBookingChat()}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="chatbubble-ellipses-outline" size={15} color="#fff" />
                    <MvText variant="semi3" style={{ color: "#fff", fontSize: 13 }}>Abrir Conversas</MvText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[ntfStyles.ctaSecondaryBtn, { borderColor: "#22C55E" }]}
                    onPress={() => handleNotificationPress(item)}
                    activeOpacity={0.8}
                  >
                    <MvText variant="semi3" style={{ color: "#22C55E", fontSize: 13 }}>Ver Agendamento</MvText>
                  </TouchableOpacity>
                </View>
              </MvCard>
            );
          }

          if (isBookingCreatedProvider) {
            const bookingId = item.data!.bookingId!;
            const clientId = item.data?.clientId;
            const clientName = item.data?.clientName ?? "Aluno";
            const anamnesisStatus = item.data?.anamnesisStatus ?? "NONE";
            const anamnesisLabel =
              anamnesisStatus === "COMPLETED" ? "Ficha preenchida" :
              anamnesisStatus === "DRAFT" ? "Ficha incompleta" :
              "Sem ficha ainda";
            const anamnesisColor =
              anamnesisStatus === "COMPLETED" ? "#22C55E" :
              anamnesisStatus === "DRAFT" ? "#FF9800" : "#9E9E9E";

            return (
              <MvCard style={[ntfStyles.specialCard, ntfStyles.providerBookingCard, { opacity: item.unread ? 1 : 0.82, borderColor: "rgba(33,150,243,0.3)" }]}>
                <View style={ntfStyles.specialRow}>
                  <View style={[ntfStyles.specialIcon, { backgroundColor: "rgba(33,150,243,0.12)" }]}>
                    <Ionicons name="person-add-outline" size={22} color="#2196F3" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <MvText variant="semi3">{item.title}</MvText>
                    <MvText variant="body4" color="secondary" style={{ marginTop: 2 }}>{item.body}</MvText>
                    <MvText variant="body4" style={{ color: anamnesisColor, marginTop: 4, fontSize: 12 }}>
                      {anamnesisLabel}
                    </MvText>
                    <MvText variant="body4" color="tertiary" style={{ marginTop: 2 }}>{item.timeLabel}</MvText>
                  </View>
                  {item.unread ? <MvBadge label="Novo" variant="blue" /> : null}
                </View>
                <View style={ntfStyles.ctaRow}>
                  <TouchableOpacity
                    style={[ntfStyles.ctaBtn, { backgroundColor: "#2196F3" }]}
                    onPress={() => openBookingChat()}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="chatbubble-ellipses-outline" size={15} color="#fff" />
                    <MvText variant="semi3" style={{ color: "#fff", fontSize: 13 }}>Conversas</MvText>
                  </TouchableOpacity>
                  {clientId ? (
                    <TouchableOpacity
                      style={[ntfStyles.ctaSecondaryBtn, { borderColor: "#2196F3" }]}
                      onPress={() => {
                        if (!navigation) return;
                        navigation.navigate("ProfessionalStudentAnamnesis", { clientId, clientName });
                      }}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="document-text-outline" size={14} color="#2196F3" />
                      <MvText variant="semi3" style={{ color: "#2196F3", fontSize: 13 }}>Ficha do Aluno</MvText>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    style={[ntfStyles.ctaSecondaryBtn, { borderColor: "#9E9E9E" }]}
                    onPress={() => handleNotificationPress(item)}
                    activeOpacity={0.8}
                  >
                    <MvText variant="semi3" style={{ color: "#9E9E9E", fontSize: 13 }}>Detalhes</MvText>
                  </TouchableOpacity>
                </View>
              </MvCard>
            );
          }

          return (
            <TouchableOpacity
              activeOpacity={0.86}
              onPress={() => handleNotificationPress(item)}
            >
              <MvCard style={{ opacity: item.unread ? 1 : 0.78 }}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      backgroundColor: theme.chipBg,
                      borderWidth: 1,
                      borderColor: theme.border,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name={item.icon} size={18} color={variantColor(item.variant)} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <MvText variant="semi3">{item.title}</MvText>
                    <MvText variant="body4" color="secondary">
                      {item.body}
                    </MvText>
                    <MvText variant="body4" color="tertiary">
                      {item.timeLabel}
                    </MvText>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 6 }}>
                    <MvBadge
                      label={item.unread ? "Novo" : "Lido"}
                      variant={item.unread ? item.variant : "gray"}
                    />
                    <Ionicons name="chevron-forward" size={16} color={theme.text3} />
                  </View>
                </View>
              </MvCard>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          !loading ? (
            <View style={{ paddingTop: 60, alignItems: "center", gap: 8 }}>
              <Ionicons name="notifications-outline" size={38} color={theme.text3} />
              <MvText variant="body3" color="secondary">
                Nenhuma notificação encontrada.
              </MvText>
            </View>
          ) : null
        }
        showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}
      />

      <TouchableOpacity
        disabled={loading}
        onPress={load}
        style={{
          marginHorizontal: 14,
          marginBottom: insets.bottom + 14,
          borderRadius: 10,
          paddingVertical: 12,
          alignItems: "center",
          flexDirection: "row",
          justifyContent: "center",
          gap: 6,
          borderWidth: 1,
          borderColor: theme.borderSub,
          backgroundColor: "transparent",
          opacity: loading ? 0.4 : 1,
        }}
      >
        <Ionicons name="refresh-outline" size={15} color={theme.text3} />
        <MvText variant="semi3" color="secondary">{loading ? "Atualizando..." : "Atualizar"}</MvText>
      </TouchableOpacity>
    </View>
  );
}

const ntfStyles = StyleSheet.create({
  specialCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  clientBookingCard: {
    borderColor: "rgba(34,197,94,0.28)",
  },
  providerBookingCard: {
    borderColor: "rgba(33,150,243,0.3)",
  },
  specialRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  specialIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  ctaBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#22C55E",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  ctaSecondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
});
