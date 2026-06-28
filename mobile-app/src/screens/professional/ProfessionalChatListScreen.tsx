import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { chatApi, ChatMessage, ChatSummary } from "../../services/api/client";
import {
  isSocketConnected,
  joinBookingRoom,
  leaveBookingRoom,
  onNewBookingMessage,
} from "../../services/realtime/socket";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvAvatar, MvText } from "../../components/mv";
import { S } from "../../theme/v2tokens";
import { PressableScale } from "../../components/polish/PressableScale";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { SkeletonChatItem } from "../../components/polish/SkeletonCard";
import { ProfessionalBottomNav } from "../../components/navigation/ProfessionalBottomNav";
import { formatBRTime } from "../../utils/formatters";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "ProfessionalChatList">;
type Tab = "active" | "inactive";
// Rede de segurança: enquanto o socket de tempo real estiver conectado, a mensagem chega
// na hora pelo evento — esse intervalo só serve para reconciliar caso algo se perca.
// Se o socket cair, volta a perguntar com mais frequência até reconectar.
const POLL_MS_SOCKET_CONNECTED = 20000;
const POLL_MS_SOCKET_DISCONNECTED = 4000;

function initials(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0] ?? "").join("").toUpperCase() || "?";
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

function mergeChatsPreservingPhoto(prev: ChatSummary[], incoming: ChatSummary[]): ChatSummary[] {
  const prevMap = new Map(prev.map((c) => [c.bookingId, c]));
  return incoming.map((next) => {
    const p = prevMap.get(next.bookingId);
    return {
      ...next,
      otherUser: {
        ...p?.otherUser,
        ...next.otherUser,
        photoUrl: next.otherUser.photoUrl ?? p?.otherUser.photoUrl ?? null,
      },
    };
  });
}

async function enrichMissingPhotos(
  source: ChatSummary[],
  loader: (bookingId: string) => Promise<{ photoUrl?: string | null }>
): Promise<ChatSummary[]> {
  const missing = source.filter((c) => !c.otherUser.photoUrl);
  if (!missing.length) return source;
  const updates = await Promise.all(
    missing.map(async (c) => {
      try {
        const u = await loader(c.bookingId);
        return { bookingId: c.bookingId, photoUrl: u.photoUrl ?? null };
      } catch {
        return { bookingId: c.bookingId, photoUrl: null };
      }
    })
  );
  const photoMap = new Map(
    updates.filter((u) => u.photoUrl).map((u) => [u.bookingId, u.photoUrl as string])
  );
  if (!photoMap.size) return source;
  return source.map((c) => {
    const p = photoMap.get(c.bookingId);
    return p ? { ...c, otherUser: { ...c.otherUser, photoUrl: p } } : c;
  });
}

export function ProfessionalChatListScreen({ navigation }: Props) {
  const { runWithAuth, user, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const myUserId = user?.id ?? "";
  const isDark = theme.mode === "dark";

  // ── State ───────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>("active");
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatsLoadError, setChatsLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatOpen, setChatOpen] = useState(true);
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

  // ── Data loading ────────────────────────────────────────────────────────────
  const loadChats = useCallback(async () => {
    setChatsLoadError(false);
    try {
      const data = await runWithAuth((t) => chatApi.myChats(t));
      if (!isMountedRef.current) return;
      const enriched = await enrichMissingPhotos(
        data,
        (id) => runWithAuth((t) => chatApi.getOtherUser(t, id))
      );
      if (!isMountedRef.current) return;
      setChats((prev) => mergeChatsPreservingPhoto(prev, enriched));
    } catch {
      if (isMountedRef.current) setChatsLoadError(true);
    }
    finally { if (isMountedRef.current) setLoading(false); }
  }, [runWithAuth]);

  useEffect(() => {
    isMountedRef.current = true;
    void loadChats();
    return () => { isMountedRef.current = false; };
  }, [loadChats]);

  const fetchMessages = useCallback(async (bookingId: string, initial = false) => {
    try {
      if (initial) setPanelLoading(true);
      const data = await runWithAuth((t) => chatApi.getMessages(t, bookingId));
      if (!isMountedRef.current) return;
      const incoming = data.messages ?? [];
      setMessages(incoming);
      setChatOpen(data.isOpen ?? true);
      setPanelError(false);
      setChats((prev) => prev.map((c) =>
        c.bookingId === bookingId
          ? { ...c, unreadCount: 0, otherUser: { ...c.otherUser, ...(data.otherUser ?? {}), photoUrl: data.otherUser?.photoUrl ?? c.otherUser.photoUrl ?? null } }
          : c
      ));
      if (initial || incoming.length > lastMsgCountRef.current) {
        lastMsgCountRef.current = incoming.length;
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: !initial }), 80);
      }
    } catch {
      if (initial && isMountedRef.current) setPanelError(true);
    } finally {
      if (initial && isMountedRef.current) setPanelLoading(false);
    }
  }, [runWithAuth]);

  // Polling when a chat is open
  useEffect(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    if (!selectedId) return;
    const schedule = () => {
      const delay = isSocketConnected() ? POLL_MS_SOCKET_CONNECTED : POLL_MS_SOCKET_DISCONNECTED;
      pollRef.current = setTimeout(async () => {
        await fetchMessages(selectedId, false);
        if (isMountedRef.current) schedule();
      }, delay);
    };
    schedule();
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [selectedId, fetchMessages]);

  // Tempo real: entra na sala do agendamento selecionado e recebe mensagens novas na hora.
  useEffect(() => {
    if (!selectedId) return;
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
  }, [selectedId, myUserId]);

  const openChat = useCallback((bookingId: string) => {
    setSelectedId(bookingId);
    void fetchMessages(bookingId, true);
  }, [fetchMessages]);

  const closeChat = useCallback(() => {
    setSelectedId(null);
    setMessages([]);
    setInputText("");
  }, []);

  const sendMessage = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !selectedId || sending) return;
    try {
      setSending(true);
      setInputText("");
      await runWithAuth((t) => chatApi.sendMessage(t, selectedId, text));
      await fetchMessages(selectedId, false);
    } catch {
      setInputText(text);
      showToast("Não foi possível enviar a mensagem.", "error");
    }
    finally { setSending(false); }
  }, [inputText, selectedId, sending, runWithAuth, fetchMessages]);

  // ── Colors ──────────────────────────────────────────────────────────────────
  const bg = theme.bg;
  const cardBg = theme.cardBg;
  const border = theme.border;
  const green = theme.textGreen;
  const text1 = theme.text1;
  const text2 = theme.text2;
  const text3 = theme.text3;
  const inputBg = theme.inputBg;
  const navBg = theme.navBg;

  // ── CHAT DETAIL VIEW (full screen) ──────────────────────────────────────────
  if (selectedId && selectedChat) {
    return (
      <View style={{ flex: 1, backgroundColor: bg }} testID="screen.professional.chat.detail">
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={bg} />

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
        >
          {/* Header */}
          <View style={{
            paddingTop: insets.top + 12,
            paddingHorizontal: S.px,
            paddingBottom: 12,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            borderBottomWidth: 1,
            borderBottomColor: border,
            backgroundColor: bg,
          }}>
            <PressableScale
              scale={0.92}
              onPress={closeChat}
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
            >
              <Ionicons name="chevron-back" size={20} color={text2} />
            </PressableScale>
            <MvAvatar
              initials={initials(selectedChat.otherUser.name)}
              photoUri={selectedChat.otherUser.photoUrl ?? null}
              size={38}
              borderRadius={19}
              color="green"
            />
            <View style={{ flex: 1 }}>
              <MvText variant="semi2" numberOfLines={1}>{selectedChat.otherUser.name}</MvText>
              <MvText variant="body4" color="secondary" style={{ fontSize: 12 }}>
                {chatOpen ? "Conversa ativa" : "Conversa encerrada"}
              </MvText>
            </View>

            {/* Atalho rápido para ficha de anamnese do aluno */}
            <PressableScale
              scale={0.94}
              onPress={() => {
                if (!selectedChat.clientId) return;
                navigation.navigate("ProfessionalStudentAnamnesis", {
                  clientId: selectedChat.clientId,
                  clientName: selectedChat.otherUser.name,
                });
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                paddingHorizontal: 10,
                paddingVertical: 7,
                borderRadius: 20,
                backgroundColor: isDark ? "rgba(34,197,94,0.12)" : "rgba(21,128,61,0.09)",
                borderWidth: 1,
                borderColor: isDark ? "rgba(34,197,94,0.24)" : "rgba(21,128,61,0.20)",
              }}
            >
              <Ionicons name="pulse-outline" size={14} color={isDark ? green : "#15803D"} />
              <MvText variant="badge" style={{ color: isDark ? green : "#15803D", fontSize: 11, letterSpacing: 0 }}>
                Anamnese
              </MvText>
            </PressableScale>
          </View>

          {/* Closed chat banner */}
          {!chatOpen ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: S.px, marginTop: 10, backgroundColor: isDark ? "rgba(245,158,11,0.10)" : "rgba(245,158,11,0.07)", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: isDark ? "rgba(245,158,11,0.25)" : "rgba(245,158,11,0.20)" }}>
              <Ionicons name="lock-closed-outline" size={14} color="#F59E0B" />
              <MvText style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: "#F59E0B", flex: 1 }}>
                Conversa encerrada — somente leitura.
              </MvText>
            </View>
          ) : null}

          {/* Messages */}
          {panelLoading ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator color={green} />
            </View>
          ) : panelError ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10 }}>
              <Ionicons name="alert-circle-outline" size={32} color={text3} />
              <MvText variant="semi3" color="secondary">Falha ao carregar mensagens</MvText>
              <PressableScale scale={0.95} onPress={() => void fetchMessages(selectedId, true)}>
                <MvText variant="semi3" style={{ color: green }}>Tentar novamente</MvText>
              </PressableScale>
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={(m) => m.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingVertical: 12 }}
              ListEmptyComponent={
                <View style={{ flex: 1, alignItems: "center", paddingTop: 60, gap: 8 }}>
                  <Ionicons name="chatbubble-outline" size={36} color={text3} />
                  <MvText variant="semi3" color="secondary">Nenhuma mensagem ainda</MvText>
                  <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>
                    Inicie a conversa com seu aluno
                  </MvText>
                </View>
              }
              renderItem={({ item }) => {
                if (item.isSystem) {
                  return (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginHorizontal: 16, marginVertical: 4, backgroundColor: isDark ? "rgba(34,197,94,0.10)" : "rgba(22,163,74,0.07)", borderRadius: 12, padding: 10, borderWidth: 1, borderColor: isDark ? "rgba(34,197,94,0.20)" : "rgba(22,163,74,0.15)" }}>
                      <Ionicons name="information-circle-outline" size={15} color={green} />
                      <MvText variant="body4" style={{ flex: 1, color: text2, lineHeight: 17, fontSize: 12 }}>
                        {item.content}
                      </MvText>
                    </View>
                  );
                }
                const isMe = item.senderId === myUserId;
                return (
                  <View style={{ flexDirection: "row", justifyContent: isMe ? "flex-end" : "flex-start", marginHorizontal: 12, marginVertical: 2 }}>
                    <View style={{
                      maxWidth: "80%",
                      backgroundColor: isMe ? (isDark ? "#0e7a3e" : "#15803d") : cardBg,
                      borderRadius: 20,
                      borderBottomRightRadius: isMe ? 4 : 20,
                      borderBottomLeftRadius: isMe ? 20 : 4,
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      borderWidth: isMe ? 0 : 1,
                      borderColor: border,
                    }}>
                      <MvText variant="body3" style={{ color: isMe ? "#fff" : text1, lineHeight: 22 }}>
                        {item.content}
                      </MvText>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 3, marginTop: 4 }}>
                        <MvText style={{ fontSize: 10, color: isMe ? "rgba(255,255,255,0.6)" : text3 }}>
                          {formatBRTime(item.createdAt)}
                        </MvText>
                        {isMe ? (
                          <Ionicons name={item.readAt ? "checkmark-done" : "checkmark"} size={12} color={item.readAt ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.5)"} />
                        ) : null}
                      </View>
                    </View>
                  </View>
                );
              }}
            />
          )}

          {/* Input */}
          {chatOpen ? (
            <View style={{ paddingHorizontal: 10, paddingVertical: 10, paddingBottom: Math.max(16, insets.bottom + 8), backgroundColor: bg, borderTopWidth: 1, borderTopColor: border }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: inputBg, borderWidth: 1, borderColor: sending ? "rgba(34,197,94,0.3)" : border, borderRadius: 99, paddingHorizontal: 16, paddingVertical: 8, opacity: sending ? 0.75 : 1 }}>
                <TextInput
                  value={inputText}
                  onChangeText={setInputText}
                  placeholder={sending ? "Enviando..." : "Mensagem para o aluno..."}
                  placeholderTextColor={sending ? green : text3}
                  editable={!sending}
                  multiline
                  maxLength={1000}
                  selectionColor={green}
                  style={{ flex: 1, fontFamily: "DMSans_400Regular", fontSize: 13, color: text1, maxHeight: 100, lineHeight: 19 }}
                />
                <PressableScale
                  scale={0.90}
                  onPress={() => void sendMessage()}
                  disabled={!inputText.trim() || sending}
                  accessibilityRole="button"
                  accessibilityLabel="Enviar mensagem"
                  style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: inputText.trim() ? green : (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"), alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                >
                  {sending
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Ionicons name="send" size={16} color={inputText.trim() ? "#fff" : text3} />
                  }
                </PressableScale>
              </View>
            </View>
          ) : null}
        </KeyboardAvoidingView>

      </View>
    );
  }

  // ── CHAT LIST VIEW (full screen) ─────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: bg }} testID="screen.professional.chat">
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={bg} />

      {/* Header */}
      <View style={{
        paddingTop: insets.top + 14,
        paddingHorizontal: S.px,
        paddingBottom: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        borderBottomWidth: 1,
        borderBottomColor: border,
      }}>
        <PressableScale
          scale={0.92}
          onPress={() => navigation.goBack()}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={text2} />
        </PressableScale>
        <View style={{ flex: 1 }}>
          <MvText style={{ fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 24, color: text1, letterSpacing: -0.3 }}>Conversas</MvText>
          <MvText variant="body4" color="secondary" style={{ fontSize: 11, marginTop: 2 }}>chats liberados por serviços ativos</MvText>
        </View>
        <PressableScale
          scale={0.92}
          onPress={() => void loadChats()}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", borderWidth: 1, borderColor: border, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="refresh-outline" size={16} color={text2} />
        </PressableScale>
      </View>

      {/* Tabs */}
      <View style={{ paddingHorizontal: S.px, paddingTop: 12, paddingBottom: 8 }}>
        <View style={{ flexDirection: "row", backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)", borderRadius: S.chipR, padding: 3, gap: 3 }}>
          {(["active", "inactive"] as Tab[]).map((t) => {
            const sel = tab === t;
            const count = chats.filter((c) => (t === "active" ? c.isOpen : !c.isOpen)).length;
            return (
              <TouchableOpacity
                key={t}
                activeOpacity={0.7}
                onPress={() => setTab(t)}
                style={{ flex: 1, height: 34, borderRadius: S.chipR, backgroundColor: sel ? (isDark ? "rgba(34,197,94,0.14)" : "rgba(22,163,74,0.10)") : "transparent", borderWidth: sel ? 1 : 0, borderColor: isDark ? "rgba(34,197,94,0.30)" : "rgba(22,163,94,0.25)", alignItems: "center", justifyContent: "center" }}
              >
                <MvText style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: sel ? green : text3 }}>
                  {t === "active" ? "Ativas" : "Inativas"}{count > 0 ? ` (${count})` : ""}
                </MvText>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* List */}
      {loading ? (
        <View style={{ paddingTop: 8 }}>
          <SkeletonChatItem />
          <SkeletonChatItem />
          <SkeletonChatItem />
        </View>
      ) : (
        <ScreenEntrance>
        <FlatList
          data={filteredChats}
          keyExtractor={(c) => c.bookingId}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: S.px, paddingBottom: 100, paddingTop: 4, gap: 10 }}
          ListEmptyComponent={
            chatsLoadError ? (
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, marginTop: 24 }}>
                <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: "rgba(239,68,68,0.10)", borderWidth: 1, borderColor: "rgba(239,68,68,0.20)", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                  <Ionicons name="cloud-offline-outline" size={30} color="#EF4444" />
                </View>
                <MvText style={{ fontFamily: "DMSans_700Bold", fontSize: 16, color: text1, textAlign: "center", marginBottom: 6 }}>Falha ao carregar conversas</MvText>
                <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>Verifique sua conexão e puxe para atualizar.</MvText>
              </View>
            ) : (
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, marginTop: 24 }}>
                <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: isDark ? "rgba(34,197,94,0.12)" : "rgba(22,163,74,0.09)", borderWidth: 1, borderColor: isDark ? "rgba(34,197,94,0.25)" : "rgba(22,163,74,0.18)", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                  <Ionicons name="chatbubbles-outline" size={30} color={green} />
                </View>
                <MvText style={{ fontFamily: "DMSans_700Bold", fontSize: 16, color: text1, textAlign: "center", marginBottom: 6 }}>
                  {tab === "active" ? "Nenhuma conversa ativa" : "Nenhuma conversa inativa"}
                </MvText>
                <MvText variant="body4" color="secondary" style={{ textAlign: "center", lineHeight: 20 }}>
                  {tab === "active"
                    ? "As conversas aparecerão aqui quando seus alunos iniciarem um agendamento."
                    : "Conversas encerradas aparecem aqui."}
                </MvText>
              </View>
            )
          }
          renderItem={({ item }) => {
            const hasUnread = item.unreadCount > 0;
            const lastContent = (() => {
              if (!item.lastMessage?.content) return "Iniciar conversa";
              if (item.lastMessage?.isSystem) return "📌 " + item.lastMessage.content;
              if (item.lastMessage?.isMine) return "Você: " + item.lastMessage.content;
              return item.lastMessage.content;
            })();
            return (
              <PressableScale
                scale={0.97}
                onPress={() => openChat(item.bookingId)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  backgroundColor: cardBg,
                  borderWidth: 1,
                  borderColor: hasUnread ? (isDark ? "rgba(34,197,94,0.30)" : "rgba(22,163,74,0.25)") : border,
                  borderRadius: S.cardR,
                  padding: S.cardPad,
                }}
              >
                {/* Avatar with status dot + unread badge */}
                <View style={{ position: "relative" }}>
                  <MvAvatar
                    initials={initials(item.otherUser.name)}
                    photoUri={item.otherUser.photoUrl ?? null}
                    size={52}
                    borderRadius={26}
                    color="green"
                  />
                  {item.isOpen ? (
                    <View style={{ position: "absolute", bottom: 1, right: 1, width: 10, height: 10, borderRadius: 5, backgroundColor: green, borderWidth: 2, borderColor: cardBg }} />
                  ) : null}
                  {hasUnread ? (
                    <View style={{ position: "absolute", top: -3, right: -3, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: green, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: bg, paddingHorizontal: 3 }}>
                      <MvText style={{ color: "#fff", fontSize: 9, fontFamily: "DMSans_700Bold", lineHeight: 12 }}>
                        {item.unreadCount > 99 ? "99+" : String(item.unreadCount)}
                      </MvText>
                    </View>
                  ) : null}
                </View>

                {/* Content */}
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <MvText style={{ fontFamily: hasUnread ? "DMSans_700Bold" : "DMSans_500Medium", fontSize: 15, color: text1, flex: 1 }} numberOfLines={1}>
                      {item.otherUser.name}
                    </MvText>
                    {item.lastMessage?.createdAt ? (
                      <MvText style={{ fontSize: 11, color: hasUnread ? green : text3, fontFamily: "DMSans_400Regular" }}>
                        {relativeTime(item.lastMessage.createdAt)}
                      </MvText>
                    ) : null}
                  </View>
                  <MvText numberOfLines={1} style={{ fontSize: 12, color: hasUnread ? text1 : text2, fontFamily: hasUnread ? "DMSans_500Medium" : "DMSans_400Regular" }}>
                    {lastContent}
                  </MvText>
                  <View style={{ marginTop: 3 }}>
                    <View style={{ backgroundColor: item.isOpen ? (isDark ? "rgba(34,197,94,0.12)" : "rgba(22,163,74,0.09)") : (isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)"), borderWidth: 1, borderColor: item.isOpen ? (isDark ? "rgba(34,197,94,0.25)" : "rgba(22,163,74,0.20)") : border, borderRadius: S.chipR, paddingHorizontal: 8, paddingVertical: 2, alignSelf: "flex-start" }}>
                      <MvText style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: item.isOpen ? green : text3 }}>
                        {item.isOpen ? "conversa ativa" : "histórico"}
                      </MvText>
                    </View>
                  </View>
                </View>
              </PressableScale>
            );
          }}
        />
        </ScreenEntrance>
      )}

    </View>
  );
}
