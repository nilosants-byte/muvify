import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  FlatList,
  Pressable,
  Text,
  TouchableOpacity,
  View,
  ViewToken,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NotificationInboxItem, notificationsApi } from "../../../services/api/client";
import { useAppState } from "../../../state/AppState";
import { C, S, DISPLAY } from "../../../theme/v2tokens";
import { useMvTheme } from "../../../theme/MvThemeContext";
import type { MvTheme } from "../../../theme/MvColors";
import {
  countUnreadNotifications,
  loadDismissedNotificationIds,
  saveDismissedNotificationIds,
} from "../../../utils/notificationsReadState";

type DrawerNotification = NotificationInboxItem & {
  unread: boolean;
  createdAtMs: number;
  dataRecord: Record<string, string>;
};

type NotifCategory = "Todas" | "Agenda" | "Consultoria" | "Pagamento" | "CREF";

interface ProfessionalNotificationsDrawerProps {
  visible: boolean;
  navigation: any;
  onClose: () => void;
  onUnreadCountChange?: (count: number) => void;
}

const CATEGORIES: NotifCategory[] = ["Todas", "Agenda", "Consultoria", "Pagamento", "CREF"];

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
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Agora";
  if (diffMin < 60) return `${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

function categoryFromNotif(item: DrawerNotification): NotifCategory {
  const type = (item.dataRecord.type ?? item.dataRecord.event ?? "").toUpperCase();
  if (type.includes("CREF")) return "CREF";
  if (type.includes("CONSULTANCY")) return "Consultoria";
  if (type.includes("PAYMENT") || type.includes("PAYOUT")) return "Pagamento";
  if (type.includes("BOOKING") || type.includes("AGENDA")) return "Agenda";
  return "Agenda";
}

function toneForCategory(
  cat: NotifCategory,
  theme: MvTheme
): { text: string; border: string; bg: string; icon: React.ComponentProps<typeof Ionicons>["name"] } {
  switch (cat) {
    case "Consultoria": return { text: C.sky, border: C.skyBorder, bg: C.skyDim, icon: "school-outline" };
    case "Pagamento": return { text: theme.primary, border: theme.primarySubtleBorder, bg: theme.primarySubtle, icon: "card-outline" };
    case "CREF": return { text: C.amber, border: C.amberBorder, bg: C.amberDim, icon: "shield-checkmark-outline" };
    default: return { text: theme.primary, border: theme.primarySubtleBorder, bg: theme.primarySubtle, icon: "calendar-outline" };
  }
}

export function ProfessionalNotificationsDrawer({
  visible,
  navigation,
  onClose,
  onUnreadCountChange,
}: ProfessionalNotificationsDrawerProps) {
  const { theme, isDark } = useMvTheme();
  const { runWithAuth, user } = useAppState();
  const insets = useSafeAreaInsets();
  const panelWidth = Math.min(Dimensions.get("window").width * 0.87, 340);
  const slideAnim = useRef(new Animated.Value(panelWidth)).current;

  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<DrawerNotification[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [activeCategory, setActiveCategory] = useState<NotifCategory>("Todas");
  const loadSeqRef = useRef(0);

  const userId = user?.id ?? "anonymous";

  const updateUnreadCount = useCallback(
    (items: NotificationInboxItem[], dismissed: Set<string>) => {
      const unread = countUnreadNotifications(items, dismissed);
      onUnreadCountChange?.(unread);
    },
    [onUnreadCountChange]
  );

  const loadNotifications = useCallback(async () => {
    const loadSeq = ++loadSeqRef.current;
    try {
      setLoading(true);
      const [inbox, initialDismissed] = await Promise.all([
        runWithAuth((token) => notificationsApi.inbox(token, 120)),
        loadDismissedNotificationIds(userId),
      ]);

      if (loadSeq !== loadSeqRef.current) return;

      const filtered = inbox
        .filter((item) => !initialDismissed.has(item.id))
        .map<DrawerNotification>((item) => ({
          ...item,
          unread: !item.readAt,
          createdAtMs: toMs(item.createdAt) ?? Date.now(),
          dataRecord: normalizeDataRecord(item.data),
        }))
        .sort((a, b) => b.createdAtMs - a.createdAtMs);

      setDismissedIds(initialDismissed);
      setNotifications(filtered);
      updateUnreadCount(filtered, initialDismissed);
    } catch {
      // best effort
    } finally {
      if (loadSeq === loadSeqRef.current) setLoading(false);
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

  const persistDismissed = useCallback(
    async (next: Set<string>, nextItems: DrawerNotification[]) => {
      await saveDismissedNotificationIds(userId, next);
      setDismissedIds(next);
      setNotifications(nextItems);
      updateUnreadCount(nextItems, next);
    },
    [updateUnreadCount, userId]
  );

  // Épico de Frentes, Frente 9, Lote 2: marcar como lida agora chama o
  // endpoint real (banco) em vez de só gravar um set local - a tela cheia
  // e a Home passam a enxergar a mesma mudança sem precisar sair-e-voltar.
  const markIdsAsRead = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const unreadIds = ids.filter((id) => notifications.some((item) => item.id === id && item.unread));
      if (unreadIds.length === 0) return;
      const nowIso = new Date().toISOString();
      const nextNotifications = notifications.map((item) =>
        unreadIds.includes(item.id) ? { ...item, unread: false, readAt: nowIso } : item
      );
      setNotifications(nextNotifications);
      updateUnreadCount(nextNotifications, dismissedIds);
      unreadIds.forEach((id) => {
        runWithAuth((token) => notificationsApi.markAsRead(token, id)).catch(() => {});
      });
    },
    [dismissedIds, notifications, runWithAuth, updateUnreadCount]
  );

  const markVisibleAsReadRef = useRef(markIdsAsRead);
  useEffect(() => { markVisibleAsReadRef.current = markIdsAsRead; }, [markIdsAsRead]);

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

  const markAllRead = useCallback(() => {
    const nowIso = new Date().toISOString();
    const nextNotifications = notifications.map((item) => ({ ...item, unread: false, readAt: nowIso }));
    setNotifications(nextNotifications);
    updateUnreadCount(nextNotifications, dismissedIds);
    void runWithAuth((token) => notificationsApi.markAllRead(token)).catch(() => {});
  }, [dismissedIds, notifications, runWithAuth, updateUnreadCount]);

  const clearAll = useCallback(() => {
    const nextDismissed = new Set(dismissedIds);
    notifications.forEach((item) => nextDismissed.add(item.id));
    void persistDismissed(nextDismissed, []);
  }, [dismissedIds, notifications, persistDismissed]);

  const openNotificationTarget = useCallback(
    (item: DrawerNotification) => {
      const type = (item.dataRecord.type ?? item.dataRecord.event ?? "").toUpperCase();
      const bookingId = item.dataRecord.bookingId;
      const contractId = item.dataRecord.contractId;
      const clientId = item.dataRecord.clientId;
      const clientName = item.dataRecord.clientName ?? "Aluno";

      markIdsAsRead([item.id]);
      onClose();

      if (!navigation) return;

      try {
        if (type.includes("CHAT")) {
          // Épico de Frentes, Frente 9, Lote 8: mensagem de chat de
          // consultoria (Lote 7) chega com contractId em vez de bookingId.
          navigation.navigate(
            "ProfessionalChatList",
            bookingId ? { openBookingId: bookingId } : contractId ? { openContractId: contractId } : undefined
          );
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
        // Épico de Frentes, Frente 9, Lote 5: notificação de post do aluno
        // (Frente 8, Lote 8) não tinha nenhum destino - clientId chegava no
        // payload e nunca era usado. Não existe tela de comunidade no app
        // do profissional, então o detalhe do aluno é o destino mais
        // próximo já disponível.
        if (type === "STUDENT_POST_MENTION" && clientId) {
          navigation.navigate("ProfessionalStudentAnamnesis", { clientId, clientName });
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
      } catch {
        navigation.navigate("ProfessionalTabs", { screen: "ProfessionalHome" } as any);
      }
    },
    [markIdsAsRead, navigation, onClose]
  );

  const unreadCount = useMemo(
    () => notifications.filter((item) => item.unread).length,
    [notifications]
  );

  const visibleNotifications = useMemo(() => {
    if (activeCategory === "Todas") return notifications;
    return notifications.filter((item) => categoryFromNotif(item) === activeCategory);
  }, [notifications, activeCategory]);

  if (!visible) return null;

  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 90 }}>
      {/* Backdrop */}
      <Pressable
        style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.65)" }}
        onPress={onClose}
      />

      {/* Painel deslizante */}
      <Animated.View
        style={{
          position: "absolute",
          top: 0, right: 0, bottom: 0,
          width: panelWidth,
          borderLeftWidth: 1,
          borderLeftColor: theme.primarySubtleBorder,
          transform: [{ translateX: slideAnim }],
          overflow: "hidden",
        }}
      >
        <BlurView intensity={80} tint={isDark ? "dark" : "light"} style={{ flex: 1, backgroundColor: `${theme.bg}f8` }}>
          {/* Header */}
          <View style={{ paddingTop: insets.top + 14, paddingHorizontal: 16, paddingBottom: 10 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: theme.primary, letterSpacing: 0.1 * 10, textTransform: "uppercase" }}>
                  Central de avisos
                </Text>
                <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 22, color: theme.text1, letterSpacing: -0.02 * 22, marginTop: 5 }}>
                  Notificações
                </Text>
                <View style={{ flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  <View style={{ backgroundColor: unreadCount > 0 ? theme.primarySubtle : theme.inputBg, borderWidth: 1, borderColor: unreadCount > 0 ? theme.primarySubtleBorder : theme.border, borderRadius: S.chipR, paddingHorizontal: 10, paddingVertical: 3 }}>
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: unreadCount > 0 ? theme.primary : theme.text2 }}>
                      {unreadCount > 0 ? `${unreadCount} não lida${unreadCount !== 1 ? "s" : ""}` : "Em dia"}
                    </Text>
                  </View>
                </View>
              </View>
              <TouchableOpacity
                onPress={onClose}
                style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.backBtn, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
              >
                <Ionicons name="close" size={16} color={C.zinc300} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Filtros por categoria */}
          <FlatList
            horizontal
            data={CATEGORIES}
            keyExtractor={(item) => item}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 6, paddingBottom: 12 }}
            renderItem={({ item }) => {
              const active = activeCategory === item;
              return (
                <TouchableOpacity
                  onPress={() => setActiveCategory(item)}
                  style={{
                    height: 32, paddingHorizontal: 12, borderRadius: S.chipR,
                    borderWidth: 1,
                    borderColor: active ? theme.primarySubtleBorder : theme.border,
                    backgroundColor: active ? theme.primarySubtle : (isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)"),
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: active ? theme.text1 : theme.text2 }}>
                    {item}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />

          {/* Lista de notificações */}
          <FlatList
            data={visibleNotifications}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: insets.bottom + 100 }}
            showsVerticalScrollIndicator={false}
            onViewableItemsChanged={onViewableItemsChanged.current}
            viewabilityConfig={viewabilityConfig.current}
            renderItem={({ item }) => {
              const cat = categoryFromNotif(item);
              const tone = toneForCategory(cat, theme);
              return (
                <TouchableOpacity
                  activeOpacity={0.82}
                  onPress={() => openNotificationTarget(item)}
                  style={{
                    borderRadius: 20,
                    borderWidth: 1,
                    borderColor: item.unread ? tone.border : theme.border,
                    backgroundColor: item.unread ? "rgba(36,230,109,0.04)" : (isDark ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.025)"),
                    padding: 12,
                    opacity: item.unread ? 1 : 0.72,
                  }}
                >
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <View style={{ width: 38, height: 38, borderRadius: 14, backgroundColor: tone.bg, borderWidth: 1, borderColor: tone.border, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Ionicons name={tone.icon} size={16} color={tone.text} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
                        <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1, lineHeight: 18, flex: 1 }} numberOfLines={2}>
                          {item.title}
                        </Text>
                        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 10, color: theme.text3, flexShrink: 0 }}>
                          {formatTimeLabel(item.createdAt)}
                        </Text>
                      </View>
                      <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text2, lineHeight: 16, marginTop: 4 }} numberOfLines={2}>
                        {item.body}
                      </Text>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                        <View style={{ backgroundColor: tone.bg, borderWidth: 1, borderColor: tone.border, borderRadius: S.chipR, paddingHorizontal: 8, paddingVertical: 2 }}>
                          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: tone.text }}>{cat}</Text>
                        </View>
                        {item.unread && (
                          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.primary, shadowColor: theme.primary, shadowOpacity: 1, shadowRadius: 3, elevation: 2 }} />
                        )}
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={{ paddingTop: 36, alignItems: "center", gap: 8 }}>
                <Ionicons name="notifications-off-outline" size={34} color={theme.text3} />
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3 }}>
                  Nenhuma notificação disponível.
                </Text>
              </View>
            }
          />

          {/* Footer — dois botões */}
          <View style={{
            position: "absolute", left: 16, right: 16,
            bottom: Math.max(14, insets.bottom + 14),
            flexDirection: "row", gap: 8,
          }}>
            <TouchableOpacity
              onPress={clearAll}
              disabled={loading || notifications.length === 0}
              style={{
                flex: 1, height: 48, borderRadius: 14,
                backgroundColor: "rgba(0,0,0,0.3)",
                borderWidth: 1, borderColor: theme.border,
                alignItems: "center", justifyContent: "center",
                opacity: loading || notifications.length === 0 ? 0.45 : 1,
              }}
            >
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: theme.text1 }}>Apagar todas</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={markAllRead}
              disabled={loading || unreadCount === 0}
              style={{
                flex: 1, height: 48, borderRadius: 14,
                backgroundColor: theme.primary,
                alignItems: "center", justifyContent: "center",
                opacity: loading || unreadCount === 0 ? 0.45 : 1,
                shadowColor: theme.primary, shadowOpacity: 0.3, shadowRadius: 10, elevation: 4,
              }}
            >
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: theme.textOnPrimary }}>Marcar lidas</Text>
            </TouchableOpacity>
          </View>
        </BlurView>
      </Animated.View>
    </View>
  );
}
