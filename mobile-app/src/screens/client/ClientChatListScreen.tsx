import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientStackParamList } from "../../navigation/route-types";
import { chatApi, ChatMessage, ChatSummary } from "../../services/api/client";
import {
  isSocketConnected,
  joinBookingRoom,
  leaveBookingRoom,
  onNewBookingMessage,
} from "../../services/realtime/socket";
import { useAppState } from "../../state/AppState";
import { MvAvatar } from "../../components/mv";
import { formatBRTime } from "../../utils/formatters";
import { useMvTheme } from "../../theme/MvThemeContext";
import { C, S, DISPLAY } from "../../theme/v2tokens";
import { SkeletonChatItem } from "../../components/polish/SkeletonCard";
import { hapticCta } from "../../utils/haptics";

type Props = NativeStackScreenProps<ClientStackParamList, "ClientChatList">;
type Tab = "active" | "inactive";
type ChatView = "list" | "chat";

// Rede de segurança: enquanto o socket de tempo real estiver conectado, a mensagem chega
// na hora pelo evento — esse intervalo só serve para reconciliar caso algo se perca.
// Se o socket cair, volta a perguntar com mais frequência até reconectar.
const POLL_MS_SOCKET_CONNECTED = 20000;
const POLL_MS_SOCKET_DISCONNECTED = 4000;

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => p[0] ?? "").join("").toUpperCase() || "?";
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "ontem";
  return `${days}d`;
}

function mergeChatsPreservingPhoto(previous: ChatSummary[], incoming: ChatSummary[]) {
  const prevByBooking = new Map(previous.map((item) => [item.bookingId, item]));
  return incoming.map((next) => {
    const prev = prevByBooking.get(next.bookingId);
    const nextPhoto = next.otherUser.photoUrl ?? null;
    const prevPhoto = prev?.otherUser.photoUrl ?? null;
    return {
      ...next,
      otherUser: { ...prev?.otherUser, ...next.otherUser, photoUrl: nextPhoto ?? prevPhoto ?? null },
    };
  });
}

async function enrichMissingChatPhotos(
  source: ChatSummary[],
  loadOtherUser: (bookingId: string) => Promise<{ photoUrl?: string | null }>
) {
  const missing = source.filter((item) => !item.otherUser.photoUrl);
  if (missing.length === 0) return source;
  const updates = await Promise.all(
    missing.map(async (item) => {
      try {
        const otherUser = await loadOtherUser(item.bookingId);
        return { bookingId: item.bookingId, photoUrl: otherUser.photoUrl ?? null };
      } catch {
        return { bookingId: item.bookingId, photoUrl: null };
      }
    })
  );
  const photoByBooking = new Map(
    updates
      .filter((e) => typeof e.photoUrl === "string" && e.photoUrl.length > 0)
      .map((e) => [e.bookingId, e.photoUrl as string])
  );
  if (photoByBooking.size === 0) return source;
  return source.map((item) => {
    const nextPhoto = photoByBooking.get(item.bookingId);
    if (!nextPhoto) return item;
    return { ...item, otherUser: { ...item.otherUser, photoUrl: nextPhoto } };
  });
}

export function ClientChatListScreen({ navigation }: Props) {
  const { runWithAuth, user, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const myUserId = user?.id ?? "";

  const [activeView, setActiveView] = useState<ChatView>("list");
  const [tab, setTab] = useState<Tab>("active");
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatsLoadError, setChatsLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isOpen, setIsOpen] = useState(true);
  const [panelLoading, setPanelLoading] = useState(false);
  const [panelError, setPanelError] = useState(false);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);

  const flatListRef = useRef<FlatList>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const lastMsgCountRef = useRef(0);

  const selectedChat = useMemo(
    () => chats.find((c) => c.bookingId === selectedId) ?? null,
    [chats, selectedId]
  );

  const filteredChats = useMemo(
    () => chats.filter((c) => (tab === "active" ? c.isOpen : !c.isOpen)),
    [chats, tab]
  );

  const loadChats = useCallback(async () => {
    setChatsLoadError(false);
    try {
      const data = await runWithAuth((token) => chatApi.myChats(token));
      if (!isMountedRef.current) return;
      const enriched = await enrichMissingChatPhotos(
        data,
        (bookingId) => runWithAuth((token) => chatApi.getOtherUser(token, bookingId))
      );
      if (!isMountedRef.current) return;
      setChats((prev) => mergeChatsPreservingPhoto(prev, enriched));
    } catch {
      if (isMountedRef.current) setChatsLoadError(true);
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [runWithAuth]);

  useEffect(() => {
    isMountedRef.current = true;
    void loadChats();
    return () => { isMountedRef.current = false; };
  }, [loadChats]);

  const fetchPanelMessages = useCallback(
    async (bookingId: string, initial = false) => {
      try {
        if (initial) setPanelLoading(true);
        const data = await runWithAuth((token) => chatApi.getMessages(token, bookingId));
        if (!isMountedRef.current) return;
        const incoming = data.messages ?? [];
        setMessages(incoming);
        setIsOpen(data.isOpen ?? true);
        setPanelError(false);
        setChats((prev) =>
          prev.map((c) =>
            c.bookingId === bookingId
              ? { ...c, unreadCount: 0, otherUser: { ...c.otherUser, ...(data.otherUser ?? {}), photoUrl: data.otherUser?.photoUrl ?? c.otherUser.photoUrl ?? null } }
              : c
          )
        );
        if (initial || incoming.length > lastMsgCountRef.current) {
          lastMsgCountRef.current = incoming.length;
          setTimeout(() => flatListRef.current?.scrollToEnd({ animated: !initial }), 80);
        }
      } catch {
        if (initial && isMountedRef.current) setPanelError(true);
      } finally {
        if (initial && isMountedRef.current) setPanelLoading(false);
      }
    },
    [runWithAuth]
  );

  // Se selectedChat sumir enquanto está na view de chat, volta para a lista
  useEffect(() => {
    if (activeView === "chat" && selectedId && !selectedChat) {
      setActiveView("list");
      setSelectedId(null);
    }
  }, [activeView, selectedId, selectedChat]);

  useEffect(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    if (!selectedId || activeView !== "chat") return;
    const schedule = () => {
      const delay = isSocketConnected() ? POLL_MS_SOCKET_CONNECTED : POLL_MS_SOCKET_DISCONNECTED;
      pollRef.current = setTimeout(async () => {
        await fetchPanelMessages(selectedId, false);
        if (isMountedRef.current) schedule();
      }, delay);
    };
    schedule();
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [selectedId, activeView, fetchPanelMessages]);

  // Tempo real: entra na sala do agendamento selecionado e recebe mensagens novas na hora.
  useEffect(() => {
    if (!selectedId || activeView !== "chat") return;
    joinBookingRoom(selectedId);
    const unsubscribe = onNewBookingMessage((incoming) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === incoming.id)) return prev;
        return [...prev, incoming];
      });
      setPanelError(false);
      setChats((prev) =>
        prev.map((c) =>
          c.bookingId === selectedId
            ? {
                ...c,
                unreadCount: 0,
                lastMessage: {
                  content: incoming.content,
                  createdAt: incoming.createdAt,
                  isMine: incoming.senderId === myUserId,
                  isSystem: incoming.isSystem,
                },
              }
            : c
        )
      );
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80);
    });
    return () => {
      unsubscribe?.();
      leaveBookingRoom(selectedId);
    };
  }, [selectedId, activeView, myUserId]);

  const openChat = useCallback(
    (chat: ChatSummary) => {
      if (pollRef.current) clearTimeout(pollRef.current);
      setSelectedId(chat.bookingId);
      setMessages([]);
      setInputText("");
      setPanelError(false);
      lastMsgCountRef.current = 0;
      setActiveView("chat");
      void fetchPanelMessages(chat.bookingId, true);
    },
    [fetchPanelMessages]
  );

  const goBackToList = useCallback(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    setActiveView("list");
    setSelectedId(null);
    setMessages([]);
  }, []);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || sending || !selectedId) return;
    hapticCta();
    setSending(true);
    setInputText("");
    try {
      const msg = await runWithAuth((token) => chatApi.sendMessage(token, selectedId, text));
      if (!isMountedRef.current) return;
      setMessages((prev) => {
        const updated = [...prev, msg];
        lastMsgCountRef.current = updated.length;
        return updated;
      });
      void loadChats();
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80);
    } catch {
      setInputText(text);
      showToast("Não foi possível enviar a mensagem.", "error");
    } finally {
      if (isMountedRef.current) setSending(false);
    }
  };

  // ── Lista: item de conversa V2 ────────────────────────────────────────────
  const renderChatItem = ({ item }: { item: ChatSummary }) => {
    const hasUnread = item.unreadCount > 0;
    const tone = hasUnread ? "green" as const : "green" as const;
    return (
      <TouchableOpacity
        activeOpacity={0.82}
        onPress={() => openChat(item)}
        style={{
          flexDirection: "row", alignItems: "center", gap: 12,
          backgroundColor: theme.cardBg,
          borderWidth: 1,
          borderColor: hasUnread ? theme.primarySubtleBorder : theme.border,
          borderRadius: S.cardR,
          padding: S.cardPad,
        }}
      >
        {/* Avatar com dot de ativo e badge de não lido */}
        <View style={{ position: "relative" }}>
          <MvAvatar
            initials={initials(item.otherUser.name)}
            photoUri={item.otherUser.photoUrl ?? null}
            tone={tone}
            size="md"
          />
          {item.isOpen && (
            <View style={{ position: "absolute", bottom: 1, right: 1, width: 10, height: 10, borderRadius: 5, backgroundColor: theme.primary, borderWidth: 2, borderColor: theme.cardBg }} />
          )}
          {hasUnread && (
            <View style={{ position: "absolute", top: -3, right: -3, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: theme.bg, paddingHorizontal: 3 }}>
              <Text style={{ color: theme.textOnPrimary, fontSize: 9, fontFamily: "DMSans_700Bold", lineHeight: 12 }}>
                {item.unreadCount > 99 ? "99+" : String(item.unreadCount)}
              </Text>
            </View>
          )}
        </View>

        {/* Conteúdo */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <Text style={{ fontFamily: hasUnread ? "DMSans_700Bold" : "DMSans_500Medium", fontSize: 15, color: theme.text1, flex: 1 }} numberOfLines={1}>
              {item.otherUser.name}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.labelColor }}>
                {item.lastMessage ? relativeTime(item.lastMessage.createdAt) : ""}
              </Text>
            </View>
          </View>
          <Text style={{ fontFamily: hasUnread ? "DMSans_500Medium" : "DMSans_400Regular", fontSize: 12, color: hasUnread ? C.zinc300 : theme.text2, marginTop: 4 }} numberOfLines={1}>
            {item.lastMessage
              ? item.lastMessage.isSystem
                ? "📌 " + item.lastMessage.content
                : item.lastMessage.isMine
                ? "Você: " + item.lastMessage.content
                : item.lastMessage.content
              : "Sem mensagens"}
          </Text>
          <View style={{ marginTop: 8 }}>
            <View style={{
              backgroundColor: item.isOpen ? theme.primarySubtle : "rgba(255,255,255,0.06)",
              borderWidth: 1, borderColor: item.isOpen ? theme.primarySubtleBorder : theme.border,
              borderRadius: S.chipR, paddingHorizontal: 8, paddingVertical: 2, alignSelf: "flex-start",
            }}>
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: item.isOpen ? theme.primary : theme.text3 }}>
                {item.isOpen ? "conversa liberada" : "histórico"}
              </Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  // ── Chat: mensagem individual V2 ─────────────────────────────────────────
  const renderMessage = ({ item }: { item: ChatMessage }) => {
    if (item.isSystem) {
      return (
        <View style={{
          flexDirection: "row", alignItems: "center", gap: 6,
          marginHorizontal: S.px, marginVertical: 4,
          backgroundColor: theme.primarySubtle, borderRadius: 14, padding: 10,
          borderWidth: 1, borderColor: theme.primarySubtleBorder,
        }}>
          <Ionicons name="information-circle-outline" size={15} color={theme.primary} />
          <Text style={{ fontFamily: "DMSans_400Regular", flex: 1, color: C.zinc300, lineHeight: 17, fontSize: 12 }}>
            {item.content}
          </Text>
        </View>
      );
    }

    const isMine = item.senderId === myUserId;
    return (
      <View style={{ flexDirection: "row", justifyContent: isMine ? "flex-end" : "flex-start", marginHorizontal: 12, marginVertical: 2 }}>
        <View style={{
          maxWidth: "80%", borderRadius: 20,
          borderBottomRightRadius: isMine ? 4 : 20,
          borderBottomLeftRadius: isMine ? 20 : 4,
          paddingHorizontal: 14, paddingVertical: 10,
          backgroundColor: isMine ? (isOpen ? theme.primary : theme.labelColor) : theme.inputBg,
          borderWidth: isMine ? 0 : 1,
          borderColor: theme.border,
        }}>
          <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 13, color: isMine ? (isOpen ? theme.textOnPrimary : theme.text1) : C.zinc300, lineHeight: 20 }}>
            {item.content}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 3, marginTop: 5 }}>
            <Text style={{ fontSize: 10, fontFamily: "DMSans_400Regular", color: isMine ? (isOpen ? "rgba(0,0,0,0.5)" : theme.text3) : theme.labelColor }}>
              {formatBRTime(item.createdAt)}
            </Text>
            {isMine ? (
              <Ionicons
                name={item.readAt ? "checkmark-done" : "checkmark"}
                size={12}
                color={item.readAt ? (isOpen ? "rgba(0,0,0,0.7)" : theme.text2) : (isOpen ? "rgba(0,0,0,0.4)" : theme.labelColor)}
              />
            ) : null}
          </View>
        </View>
      </View>
    );
  };

  // ── Render principal V2 ──────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      {activeView === "list" ? (
        /* ═══════════════════════════════ LISTA DE CONVERSAS V2 ═══════════ */
        <>
          {/* Header V2 */}
          <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="chevron-back" size={18} color={theme.text1} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 24, color: theme.text1, letterSpacing: -0.3 }}>Conversas</Text>
              <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 11, color: theme.text3, marginTop: 2 }}>chats liberados por serviços ativos</Text>
            </View>
            <TouchableOpacity onPress={() => void loadChats()} hitSlop={8} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="refresh-outline" size={16} color={theme.text2} />
            </TouchableOpacity>
          </View>

          {/* Tabs V2 — pill style */}
          <View style={{ paddingHorizontal: S.px, paddingTop: 14, paddingBottom: 8 }}>
            <View style={{ flexDirection: "row", backgroundColor: "rgba(255,255,255,0.05)", borderRadius: S.chipR, padding: 3, gap: 3 }}>
              {(["active", "inactive"] as Tab[]).map((t) => {
                const label = t === "active" ? "Ativas" : "Inativas";
                const isSelected = tab === t;
                const count = chats.filter((c) => (t === "active" ? c.isOpen : !c.isOpen)).length;
                return (
                  <TouchableOpacity
                    key={t}
                    onPress={() => setTab(t)}
                    style={{ flex: 1, height: 34, borderRadius: S.chipR, backgroundColor: isSelected ? theme.primarySubtle : "transparent", borderWidth: isSelected ? 1 : 0, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center" }}
                  >
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: isSelected ? theme.primary : theme.text3 }}>
                      {label}{count > 0 ? ` (${count})` : ""}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Lista */}
          {loading ? (
            <View style={{ paddingTop: 8 }}>
              {[0, 1, 2, 3].map((i) => <SkeletonChatItem key={i} />)}
            </View>
          ) : chatsLoadError ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
              <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: "rgba(239,68,68,0.10)", borderWidth: 1, borderColor: "rgba(239,68,68,0.20)", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                <Ionicons name="cloud-offline-outline" size={30} color={theme.danger} />
              </View>
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 16, color: theme.text1, textAlign: "center", marginBottom: 6 }}>Falha ao carregar conversas</Text>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, textAlign: "center", lineHeight: 20 }}>Verifique sua conexão e puxe para atualizar.</Text>
            </View>
          ) : filteredChats.length === 0 ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
              <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                <Ionicons name="chatbubbles-outline" size={30} color={theme.primary} />
              </View>
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 16, color: theme.text1, textAlign: "center", marginBottom: 6 }}>
                {tab === "active" ? "Nenhuma conversa ativa" : "Nenhuma conversa inativa"}
              </Text>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, textAlign: "center", lineHeight: 20 }}>
                {tab === "active"
                  ? "Suas conversas com personais aparecerão aqui após um agendamento."
                  : "Conversas encerradas aparecerão aqui."}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredChats}
              keyExtractor={(item) => item.bookingId}
              renderItem={renderChatItem}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: S.px, paddingBottom: 40, gap: 10 }}
            />
          )}
        </>
      ) : (
        /* ═══════════════════════════════ CHAT INDIVIDUAL V2 ═══════════ */
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0}>
          {/* Header do chat V2 */}
          <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
            <TouchableOpacity onPress={goBackToList} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="chevron-back" size={18} color={theme.text1} />
            </TouchableOpacity>
            {selectedChat ? (
              <>
                <MvAvatar initials={initials(selectedChat.otherUser.name)} photoUri={selectedChat.otherUser.photoUrl ?? null} tone="green" size="sm" />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }} numberOfLines={1}>{selectedChat.otherUser.name}</Text>
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: selectedChat.isOpen ? theme.primary : theme.text3, marginTop: 1 }}>
                    {selectedChat.isOpen ? "Disponível durante o serviço" : "Histórico encerrado"}
                  </Text>
                </View>
              </>
            ) : null}
          </View>

          {/* Banner modo histórico V2 */}
          {selectedChat && !selectedChat.isOpen ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: S.px, marginTop: 10, backgroundColor: "rgba(245,166,35,0.10)", borderRadius: 16, padding: "10px 14px" as any, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: C.amberBorder }}>
              <Ionicons name="lock-closed-outline" size={14} color={C.amber} />
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: C.amber, flex: 1 }}>
                Essa conversa está em modo histórico — somente leitura.
              </Text>
            </View>
          ) : null}

          {/* Corpo das mensagens */}
          {panelLoading ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator color={theme.primary} />
            </View>
          ) : panelError ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
              <Ionicons name="wifi-outline" size={40} color={theme.text3} />
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, textAlign: "center", marginTop: 12, marginBottom: 16 }}>
                Não foi possível carregar as mensagens.
              </Text>
              {selectedChat ? (
                <TouchableOpacity onPress={() => void fetchPanelMessages(selectedChat.bookingId, true)} style={{ paddingHorizontal: 20, paddingVertical: 10, borderRadius: S.chipR, borderWidth: 1, borderColor: theme.primarySubtleBorder, backgroundColor: theme.primarySubtle }}>
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.primary }}>Tentar novamente</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={(item) => item.id}
              renderItem={renderMessage}
              contentContainerStyle={{ paddingVertical: 12, gap: 2 }}
              showsVerticalScrollIndicator={false}
              onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
              ListEmptyComponent={
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, marginTop: 40 }}>
                  <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
                    <Ionicons name="chatbubble-outline" size={24} color={theme.primary} />
                  </View>
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, textAlign: "center", lineHeight: 20 }}>
                    {selectedChat?.isOpen ? "Nenhuma mensagem ainda.\nInicie a conversa!" : "Nenhuma mensagem.\nChat em modo histórico."}
                  </Text>
                </View>
              }
            />
          )}

          {/* Input V2 — pill container */}
          {selectedChat?.isOpen ? (
            <View style={{ paddingHorizontal: 10, paddingVertical: 10, paddingBottom: Math.max(16, insets.bottom + 8), backgroundColor: theme.bg, borderTopWidth: 1, borderTopColor: theme.border }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.inputBg, borderWidth: 1, borderColor: sending ? theme.primarySubtleBorder : theme.borderMid, borderRadius: 99, paddingHorizontal: 16, paddingVertical: 8, opacity: sending ? 0.75 : 1 }}>
                <TextInput
                  style={{ flex: 1, fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text1, maxHeight: 100, lineHeight: 19 }}
                  placeholder={sending ? "Enviando..." : "Escreva para seu personal..."}
                  placeholderTextColor={sending ? theme.primary : theme.text3}
                  value={inputText}
                  onChangeText={setInputText}
                  editable={!sending}
                  multiline
                  maxLength={1000}
                  selectionColor={theme.primary}
                />
                <TouchableOpacity
                  onPress={() => void handleSend()}
                  disabled={!inputText.trim() || sending}
                  accessibilityRole="button"
                  accessibilityLabel="Enviar mensagem"
                  style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: inputText.trim() && !sending ? theme.primary : "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                >
                  {sending
                    ? <ActivityIndicator color={theme.primary} size="small" />
                    : <Ionicons name="send" size={16} color={inputText.trim() ? theme.textOnPrimary : theme.text3} />}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={{ paddingHorizontal: 16, paddingVertical: 12, paddingBottom: Math.max(16, insets.bottom + 8), backgroundColor: theme.bg, borderTopWidth: 1, borderTopColor: theme.border, flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Ionicons name="lock-closed-outline" size={16} color={theme.text3} />
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3, flex: 1 }}>
                Esta conversa está encerrada. O chat fica ativo apenas durante o período de atendimento.
              </Text>
            </View>
          )}
        </KeyboardAvoidingView>
      )}
    </View>
  );
}
