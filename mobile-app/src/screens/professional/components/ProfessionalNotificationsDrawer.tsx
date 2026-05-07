import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  FlatList,
  Pressable,
  TouchableOpacity,
  View,
  ViewToken,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NotificationInboxItem, notificationsApi } from "../../../services/api/client";
import { useAppState } from "../../../state/AppState";
import { useMvTheme } from "../../../theme/MvThemeContext";
import { MvBadge, MvCard, MvText } from "../../../components/mv";
import {
  countUnreadNotifications,
  loadDismissedNotificationIds,
  loadSeenNotificationIds,
  saveDismissedNotificationIds,
  saveSeenNotificationIds,
} from "../../../utils/notificationsReadState";

type DrawerNotification = NotificationInboxItem & {
  unread: boolean;
  createdAtMs: number;
  dataRecord: Record<string, string>;
};

interface ProfessionalNotificationsDrawerProps {
  visible: boolean;
  navigation: any;
  onClose: () => void;
  onUnreadCountChange?: (count: number) => void;
}

function toMs(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDataRecord(data?: NotificationInboxItem["data"] | null) {
  if (!data || typeof data !== "object") return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string" && value.trim()) {
      result[key] = value.trim();
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      result[key] = String(value);
    }
  }
  return result;
}

function formatTimeLabel(iso: string) {
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

export function ProfessionalNotificationsDrawer({
  visible,
  navigation,
  onClose,
  onUnreadCountChange,
}: ProfessionalNotificationsDrawerProps) {
  const { runWithAuth, user } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const panelWidth = Math.min(Dimensions.get("window").width * 0.67, 340);
  const slideAnim = useRef(new Animated.Value(panelWidth)).current;

  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<DrawerNotification[]>([]);
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const loadSeqRef = useRef(0);

  const userId = user?.id ?? "anonymous";

  const updateUnreadCount = useCallback(
    (items: NotificationInboxItem[], seen: Set<string>, dismissed: Set<string>) => {
      const unread = countUnreadNotifications(items, seen, dismissed);
      onUnreadCountChange?.(unread);
    },
    [onUnreadCountChange]
  );

  const loadNotifications = useCallback(async () => {
    const loadSeq = ++loadSeqRef.current;
    try {
      setLoading(true);
      const [inbox, initialSeen, initialDismissed] = await Promise.all([
        runWithAuth((token) => notificationsApi.inbox(token, 120)),
        loadSeenNotificationIds(userId),
        loadDismissedNotificationIds(userId),
      ]);

      if (loadSeq !== loadSeqRef.current) return;

      const filtered = inbox
        .filter((item) => !initialDismissed.has(item.id))
        .map<DrawerNotification>((item) => ({
          ...item,
          unread: !item.readAt && !initialSeen.has(item.id),
          createdAtMs: toMs(item.createdAt) ?? Date.now(),
          dataRecord: normalizeDataRecord(item.data),
        }))
        .sort((a, b) => b.createdAtMs - a.createdAtMs);

      setSeenIds(initialSeen);
      setDismissedIds(initialDismissed);
      setNotifications(filtered);
      updateUnreadCount(filtered, initialSeen, initialDismissed);
    } catch {
      // best effort
    } finally {
      if (loadSeq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }, [runWithAuth, updateUnreadCount, userId]);

  useEffect(() => {
    if (!visible) {
      loadSeqRef.current += 1;
      return;
    }
    slideAnim.setValue(panelWidth);
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 230,
      useNativeDriver: true,
    }).start();
    void loadNotifications();
  }, [loadNotifications, panelWidth, slideAnim, visible]);

  const persistSeen = useCallback(
    async (next: Set<string>) => {
      await saveSeenNotificationIds(userId, next);
      setSeenIds(next);
      updateUnreadCount(notifications, next, dismissedIds);
    },
    [dismissedIds, notifications, updateUnreadCount, userId]
  );

  const persistDismissed = useCallback(
    async (next: Set<string>, nextItems: DrawerNotification[]) => {
      await saveDismissedNotificationIds(userId, next);
      setDismissedIds(next);
      setNotifications(nextItems);
      updateUnreadCount(nextItems, seenIds, next);
    },
    [seenIds, updateUnreadCount, userId]
  );

  const markVisibleAsRead = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const unreadVisibleIds = ids.filter((id) => !seenIds.has(id));
      if (unreadVisibleIds.length === 0) return;

      const nextSeen = new Set(seenIds);
      unreadVisibleIds.forEach((id) => nextSeen.add(id));
      const nextNotifications = notifications.map((item) =>
        unreadVisibleIds.includes(item.id)
          ? {
              ...item,
              unread: false,
            }
          : item
      );

      setNotifications(nextNotifications);
      void persistSeen(nextSeen);
    },
    [notifications, persistSeen, seenIds]
  );

  const markVisibleAsReadRef = useRef(markVisibleAsRead);
  useEffect(() => {
    markVisibleAsReadRef.current = markVisibleAsRead;
  }, [markVisibleAsRead]);

  const markNotificationAsRead = useCallback(
    (id: string) => {
      if (!id || seenIds.has(id)) return;
      const nextSeen = new Set(seenIds);
      nextSeen.add(id);
      const nextNotifications = notifications.map((item) =>
        item.id === id
          ? {
              ...item,
              unread: false,
            }
          : item
      );
      setNotifications(nextNotifications);
      void persistSeen(nextSeen);
    },
    [notifications, persistSeen, seenIds]
  );

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const ids = viewableItems
        .map((item) => String(item.item?.id ?? ""))
        .filter((id) => id.length > 0);
      markVisibleAsReadRef.current(ids);
    }
  );

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 70,
    minimumViewTime: 180,
  });

  const removeNotification = useCallback(
    (id: string) => {
      const nextDismissed = new Set(dismissedIds);
      nextDismissed.add(id);
      const nextItems = notifications.filter((item) => item.id !== id);
      void persistDismissed(nextDismissed, nextItems);
    },
    [dismissedIds, notifications, persistDismissed]
  );

  const clearAll = useCallback(() => {
    const nextDismissed = new Set(dismissedIds);
    notifications.forEach((item) => nextDismissed.add(item.id));
    void persistDismissed(nextDismissed, []);
  }, [dismissedIds, notifications, persistDismissed]);

  const openNotificationTarget = useCallback(
    (item: DrawerNotification) => {
      const type = (item.dataRecord.type ?? item.dataRecord.event ?? "").toUpperCase();
      const bookingId = item.dataRecord.bookingId;
      const clientId = item.dataRecord.clientId;
      const clientName = item.dataRecord.clientName ?? "Aluno";
      const clientPhotoUrl = item.dataRecord.clientPhotoUrl ?? null;

      markNotificationAsRead(item.id);
      onClose();

      if (!navigation) return;

      if (bookingId && type.includes("CHAT")) {
        navigation.navigate("ProfessionalChatList");
        return;
      }

      if (bookingId && type.includes("PAYMENT")) {
        navigation.navigate("BookingPaymentStatus", { bookingId });
        return;
      }

      if (bookingId) {
        navigation.navigate("BookingDetailProfessional", { bookingId });
        return;
      }

      if (type.includes("CONSULTANCY")) {
        navigation.navigate("ProfessionalConsultancyCenter");
        return;
      }

      if (type.includes("CREF")) {
        navigation.navigate("ProfessionalCredentials");
        return;
      }

      if (type.includes("PAYOUT") || type.includes("PAYMENT")) {
        navigation.navigate("PayoutStatus");
      }
    },
    [markNotificationAsRead, navigation, onClose]
  );

  const unreadCount = useMemo(
    () => notifications.filter((item) => item.unread).length,
    [notifications]
  );

  if (!visible) return null;

  return (
    <View
      style={{
        position: "absolute",
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 40,
      }}
    >
      {/* Backdrop escuro semitransparente */}
      <Pressable
        style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.40)" }}
        onPress={onClose}
      />

      {/* Painel deslizante com BlurView */}
      <Animated.View
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: panelWidth,
          borderLeftWidth: 1,
          borderLeftColor: theme.mode === "dark" ? "rgba(34,197,94,0.12)" : "rgba(22,163,74,0.10)",
          transform: [{ translateX: slideAnim }],
          overflow: "hidden",
        }}
      >
        <BlurView
          intensity={theme.mode === "dark" ? 70 : 55}
          tint={theme.mode === "dark" ? "dark" : "light"}
          style={{ flex: 1 }}
        >
          <View
            style={{
              paddingTop: insets.top + 12,
              paddingHorizontal: 12,
              paddingBottom: 10,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              borderBottomWidth: 1,
              borderBottomColor: theme.borderSub,
            }}
          >
            <MvText variant="h4" style={{ flex: 1, fontSize: 15 }}>Notificações</MvText>
            <MvBadge
              label={unreadCount > 0 ? `${unreadCount} não lida(s)` : "Tudo lido"}
              variant={unreadCount > 0 ? (theme.mode === "light" ? "blue" : "orange") : "gray"}
            />
            <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
              <Ionicons name="close" size={18} color={theme.text2} />
            </TouchableOpacity>
          </View>

          <FlatList
            data={notifications}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 10, gap: 7, paddingBottom: insets.bottom + 80 }}
            showsVerticalScrollIndicator={false}
            onViewableItemsChanged={onViewableItemsChanged.current}
            viewabilityConfig={viewabilityConfig.current}
            renderItem={({ item }) => (
              <MvCard style={{
                opacity: item.unread ? 1 : 0.72,
                backgroundColor: theme.mode === "dark"
                  ? "rgba(14,26,17,0.55)"
                  : "rgba(255,255,255,0.60)",
                borderColor: theme.mode === "dark"
                  ? "rgba(34,197,94,0.09)"
                  : "rgba(0,0,0,0.07)",
              }}>
                <TouchableOpacity
                  activeOpacity={0.82}
                  onPress={() => openNotificationTarget(item)}
                  style={{ flexDirection: "row", gap: 8, paddingRight: 26 }}
                >
                  <View
                    style={{
                      width: 30, height: 30, borderRadius: 9,
                      alignItems: "center", justifyContent: "center",
                      borderWidth: 1, borderColor: theme.border, backgroundColor: theme.chipBg,
                      flexShrink: 0,
                    }}
                  >
                    <Ionicons name="notifications-outline" size={14} color={item.unread ? "#FF9800" : theme.text3} />
                  </View>
                  <View style={{ flex: 1, gap: 1 }}>
                    <MvText variant="semi3" numberOfLines={1} style={{ fontSize: 13 }}>{item.title}</MvText>
                    <MvText variant="body4" color="secondary" numberOfLines={2} style={{ fontSize: 12, lineHeight: 17 }}>{item.body}</MvText>
                    <MvText variant="body4" color="tertiary" style={{ fontSize: 11 }}>{formatTimeLabel(item.createdAt)}</MvText>
                  </View>
                  {item.unread ? <MvBadge label="Novo" variant="orange" /> : null}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => removeNotification(item.id)}
                  activeOpacity={0.7}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Apagar notificação"
                  style={{
                    position: "absolute", top: 5, right: 5,
                    width: 18, height: 18, borderRadius: 9,
                    alignItems: "center", justifyContent: "center",
                    opacity: item.unread ? 0.72 : 0.56,
                  }}
                >
                  <Ionicons name="close-outline" size={13} color={theme.text3} />
                </TouchableOpacity>
              </MvCard>
            )}
            ListEmptyComponent={
              <View style={{ paddingTop: 32, alignItems: "center", gap: 8 }}>
                <Ionicons name="notifications-off-outline" size={28} color={theme.text3} />
                <MvText variant="body3" color="secondary" style={{ fontSize: 13 }}>
                  Nenhuma notificação.
                </MvText>
              </View>
            }
          />

          <View style={{ position: "absolute", left: 10, right: 10, bottom: insets.bottom + 12 }}>
            <TouchableOpacity
              disabled={loading || notifications.length === 0}
              onPress={clearAll}
              style={{
                borderRadius: 9, alignItems: "center", justifyContent: "center",
                paddingVertical: 10, borderWidth: 1,
                borderColor: theme.borderSub,
                backgroundColor: theme.mode === "dark"
                  ? "rgba(14,26,17,0.55)"
                  : "rgba(255,255,255,0.60)",
                opacity: loading || notifications.length === 0 ? 0.45 : 1,
              }}
            >
              <MvText variant="semi3" style={{ fontSize: 13 }}>
                {loading ? "Atualizando..." : "Apagar todas"}
              </MvText>
            </TouchableOpacity>
          </View>
        </BlurView>
      </Animated.View>
    </View>
  );
}
