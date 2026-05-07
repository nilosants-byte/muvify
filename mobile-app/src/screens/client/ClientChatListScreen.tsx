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
import { ClientStackParamList } from "../../navigation/route-types";
import { chatApi, ChatMessage, ChatSummary } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvAvatar, MvText } from "../../components/mv";
import { formatBRTime } from "../../utils/formatters";

type Props = NativeStackScreenProps<ClientStackParamList, "ClientChatList">;
type Tab = "active" | "inactive";
type ChatView = "list" | "chat";

const POLL_MS = 3000;

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
  const { runWithAuth, user } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const myUserId = user?.id ?? "";
  const isDark = theme.mode === "dark";

  const [activeView, setActiveView] = useState<ChatView>("list");
  const [tab, setTab] = useState<Tab>("active");
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [loading, setLoading] = useState(true);
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
    try {
      const data = await runWithAuth((token) => chatApi.myChats(token));
      if (!isMountedRef.current) return;
      const enriched = await enrichMissingChatPhotos(
        data,
        (bookingId) => runWithAuth((token) => chatApi.getOtherUser(token, bookingId))
      );
      if (!isMountedRef.current) return;
      setChats((prev) => mergeChatsPreservingPhoto(prev, enriched));
    } catch { /* best effort */ } finally {
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

  useEffect(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    if (!selectedId || activeView !== "chat") return;
    const schedule = () => {
      pollRef.current = setTimeout(async () => {
        await fetchPanelMessages(selectedId, false);
        if (isMountedRef.current) schedule();
      }, POLL_MS);
    };
    schedule();
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [selectedId, activeView, fetchPanelMessages]);

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
    } finally {
      if (isMountedRef.current) setSending(false);
    }
  };

  // ── Lista: item de conversa (full-width) ──────────────────────────────────
  const renderChatItem = ({ item }: { item: ChatSummary }) => {
    const hasUnread = item.unreadCount > 0;
    return (
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={() => openChat(item)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 13,
          borderBottomWidth: 1,
          borderBottomColor: theme.borderSub,
          backgroundColor: hasUnread
            ? isDark ? "rgba(34,197,94,0.05)" : "rgba(34,197,94,0.04)"
            : "transparent",
        }}
      >
        {/* Avatar com indicador de não lido */}
        <View style={{ position: "relative" }}>
          <MvAvatar
            initials={initials(item.otherUser.name)}
            photoUri={item.otherUser.photoUrl ?? null}
            size={48}
            borderRadius={14}
            color="green"
          />
          {hasUnread ? (
            <View style={{
              position: "absolute",
              top: -3, right: -3,
              width: 18, height: 18, borderRadius: 9,
              backgroundColor: theme.textGreen,
              alignItems: "center", justifyContent: "center",
              borderWidth: 2, borderColor: theme.bg,
            }}>
              <MvText style={{ color: "#fff", fontSize: 9, fontWeight: "700", lineHeight: 12 }}>
                {item.unreadCount > 99 ? "99+" : String(item.unreadCount)}
              </MvText>
            </View>
          ) : null}
        </View>

        {/* Conteúdo */}
        <View style={{ flex: 1, minWidth: 0 }}>
          {/* Linha superior: nome + horário */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 3 }}>
            <MvText
              variant={hasUnread ? "semi2" : "semi3"}
              numberOfLines={1}
              style={{ flex: 1, fontSize: 14 }}
            >
              {item.otherUser.name}
            </MvText>
            <MvText variant="body4" color="secondary" style={{ fontSize: 11, flexShrink: 0 }}>
              {relativeTime(item.lastMessage.createdAt)}
            </MvText>
          </View>

          {/* Prévia da última mensagem */}
          <MvText
            variant="body4"
            numberOfLines={1}
            style={{
              fontSize: 13,
              color: hasUnread ? theme.text1 : theme.text3,
              fontWeight: hasUnread ? "500" : "400",
            }}
          >
            {item.lastMessage.isSystem
              ? "📌 " + item.lastMessage.content
              : item.lastMessage.isMine
              ? "Você: " + item.lastMessage.content
              : item.lastMessage.content}
          </MvText>

          {/* Status do chat */}
          {!item.isOpen ? (
            <MvText variant="body4" style={{ fontSize: 11, color: theme.text3, marginTop: 2 }}>
              Chat arquivado
            </MvText>
          ) : null}
        </View>

        {/* Seta de acesso */}
        <Ionicons name="chevron-forward" size={16} color={theme.text3} style={{ opacity: 0.35 }} />
      </TouchableOpacity>
    );
  };

  // ── Chat: mensagem individual ─────────────────────────────────────────────
  const renderMessage = ({ item }: { item: ChatMessage }) => {
    if (item.isSystem) {
      return (
        <View style={{
          flexDirection: "row", alignItems: "center", gap: 6,
          marginHorizontal: 16, marginVertical: 4,
          backgroundColor: isDark ? "rgba(34,197,94,0.08)" : "rgba(34,197,94,0.06)",
          borderRadius: 10, padding: 10,
          borderWidth: 1, borderColor: "rgba(34,197,94,0.18)",
        }}>
          <Ionicons name="information-circle-outline" size={15} color={theme.textGreen} />
          <MvText variant="body4" style={{ flex: 1, color: theme.text2, lineHeight: 17, fontSize: 12 }}>
            {item.content}
          </MvText>
        </View>
      );
    }

    const isMine = item.senderId === myUserId;
    return (
      <View style={{
        flexDirection: "row",
        justifyContent: isMine ? "flex-end" : "flex-start",
        marginHorizontal: 12,
        marginVertical: 2,
      }}>
        <View style={{
          maxWidth: "80%",
          borderRadius: 16,
          borderBottomRightRadius: isMine ? 4 : 16,
          borderBottomLeftRadius: isMine ? 16 : 4,
          paddingHorizontal: 12, paddingVertical: 8,
          backgroundColor: isMine
            ? theme.textGreen
            : isDark ? "#152015" : "#e4f2e5",
        }}>
          <MvText
            variant="body4"
            style={{ color: isMine ? "#fff" : theme.text1, lineHeight: 19, fontSize: 14 }}
          >
            {item.content}
          </MvText>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 3, marginTop: 3 }}>
            <MvText style={{ fontSize: 10, color: isMine ? "rgba(255,255,255,0.65)" : theme.text3 }}>
              {formatBRTime(item.createdAt)}
            </MvText>
            {isMine ? (
              <Ionicons
                name={item.readAt ? "checkmark-done" : "checkmark"}
                size={12}
                color={item.readAt ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.5)"}
              />
            ) : null}
          </View>
        </View>
      </View>
    );
  };

  // ── Render principal ──────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      {activeView === "list" ? (
        /* ══════════════════════════════════════
           TELA 1: LISTA DE CONVERSAS (full width)
        ══════════════════════════════════════ */
        <>
          {/* Header */}
          <View style={{
            paddingTop: insets.top + 10,
            paddingHorizontal: 14,
            paddingBottom: 10,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            borderBottomWidth: 1,
            borderBottomColor: theme.borderSub,
          }}>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
            >
              <Ionicons name="chevron-back" size={20} color={theme.text2} />
            </TouchableOpacity>
            <MvText variant="semi1" style={{ flex: 1 }}>Mensagens</MvText>
            <TouchableOpacity
              onPress={() => void loadChats()}
              hitSlop={8}
              style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
            >
              <Ionicons name="refresh-outline" size={18} color={theme.text3} />
            </TouchableOpacity>
          </View>

          {/* Abas */}
          <View style={{
            flexDirection: "row",
            borderBottomWidth: 1,
            borderBottomColor: theme.borderSub,
            paddingHorizontal: 16,
          }}>
            {(["active", "inactive"] as Tab[]).map((t) => {
              const label = t === "active" ? "Ativos" : "Inativos";
              const isSelected = tab === t;
              const count = chats.filter((c) => (t === "active" ? c.isOpen : !c.isOpen)).length;
              return (
                <TouchableOpacity
                  key={t}
                  onPress={() => setTab(t)}
                  style={{
                    flex: 1, alignItems: "center", paddingVertical: 12,
                    borderBottomWidth: 2,
                    borderBottomColor: isSelected ? theme.textGreen : "transparent",
                  }}
                >
                  <MvText
                    variant="semi3"
                    style={{ color: isSelected ? theme.textGreen : theme.text2, fontSize: 13 }}
                  >
                    {label}{count > 0 ? ` (${count})` : ""}
                  </MvText>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Lista de conversas */}
          {loading ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator color={theme.textGreen} />
            </View>
          ) : filteredChats.length === 0 ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
              <View style={{
                width: 64, height: 64, borderRadius: 20,
                backgroundColor: theme.backBtn,
                alignItems: "center", justifyContent: "center",
                marginBottom: 14,
              }}>
                <Ionicons name="chatbubbles-outline" size={30} color={theme.text3} />
              </View>
              <MvText variant="semi2" style={{ textAlign: "center", marginBottom: 6 }}>
                {tab === "active" ? "Nenhuma conversa ativa" : "Nenhuma conversa inativa"}
              </MvText>
              <MvText variant="body4" color="secondary" style={{ textAlign: "center", lineHeight: 20 }}>
                {tab === "active"
                  ? "Suas conversas com personais aparecerão aqui após um agendamento."
                  : "Conversas encerradas ou arquivadas aparecerão aqui."}
              </MvText>
            </View>
          ) : (
            <FlatList
              data={filteredChats}
              keyExtractor={(item) => item.bookingId}
              renderItem={renderChatItem}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 24 }}
            />
          )}
        </>
      ) : (
        /* ══════════════════════════════════════
           TELA 2: CHAT INDIVIDUAL (full width)
        ══════════════════════════════════════ */
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={0}
        >
          {/* Header do chat */}
          <View style={{
            paddingTop: insets.top + 10,
            paddingHorizontal: 14,
            paddingBottom: 10,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            borderBottomWidth: 1,
            borderBottomColor: theme.borderSub,
          }}>
            <TouchableOpacity
              onPress={goBackToList}
              style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
            >
              <Ionicons name="chevron-back" size={20} color={theme.text2} />
            </TouchableOpacity>
            {selectedChat ? (
              <>
                <MvAvatar
                  initials={initials(selectedChat.otherUser.name)}
                  photoUri={selectedChat.otherUser.photoUrl ?? null}
                  size={36}
                  borderRadius={10}
                  color="green"
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <MvText variant="semi2" numberOfLines={1} style={{ fontSize: 14 }}>
                    {selectedChat.otherUser.name}
                  </MvText>
                  <MvText variant="body4" color="secondary" style={{ fontSize: 11 }}>
                    {selectedChat.isOpen ? "Chat ativo" : "Chat arquivado"}
                  </MvText>
                </View>
              </>
            ) : null}
          </View>

          {/* Corpo das mensagens */}
          {panelLoading ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator color={theme.textGreen} />
            </View>
          ) : panelError ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
              <Ionicons name="wifi-outline" size={40} color={theme.text3} />
              <MvText variant="body4" color="secondary" style={{ textAlign: "center", marginTop: 12, marginBottom: 16 }}>
                Não foi possível carregar as mensagens.
              </MvText>
              {selectedChat ? (
                <TouchableOpacity
                  onPress={() => void fetchPanelMessages(selectedChat.bookingId, true)}
                  style={{
                    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10,
                    borderWidth: 1, borderColor: theme.border,
                  }}
                >
                  <MvText variant="semi3" style={{ color: theme.textGreen }}>Tentar novamente</MvText>
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
                  <View style={{
                    width: 56, height: 56, borderRadius: 16,
                    backgroundColor: theme.backBtn,
                    alignItems: "center", justifyContent: "center",
                    marginBottom: 12,
                  }}>
                    <Ionicons name="chatbubble-outline" size={24} color={theme.text3} />
                  </View>
                  <MvText variant="body4" color="secondary" style={{ textAlign: "center", lineHeight: 20 }}>
                    {selectedChat?.isOpen
                      ? "Nenhuma mensagem ainda.\nInicie a conversa!"
                      : "Nenhuma mensagem.\nChat arquivado."}
                  </MvText>
                </View>
              }
            />
          )}

          {/* Banner de chat arquivado */}
          {selectedChat && !selectedChat.isOpen ? (
            <View style={{
              flexDirection: "row", alignItems: "center", gap: 8,
              paddingHorizontal: 14, paddingVertical: 10,
              backgroundColor: isDark ? "rgba(245,158,11,0.08)" : "rgba(146,64,14,0.06)",
              borderTopWidth: 1, borderTopColor: isDark ? "rgba(245,158,11,0.20)" : "rgba(146,64,14,0.15)",
            }}>
              <Ionicons name="lock-closed-outline" size={14} color={isDark ? "#F59E0B" : "#92400E"} />
              <MvText variant="body4" style={{ color: isDark ? "#F59E0B" : "#92400E", fontSize: 12 }}>
                Chat arquivado — sem novas mensagens
              </MvText>
            </View>
          ) : null}

          {/* Input de mensagem */}
          {selectedChat?.isOpen ? (
            <View style={{
              flexDirection: "row",
              alignItems: "flex-end",
              gap: 8,
              paddingHorizontal: 12,
              paddingVertical: 10,
              paddingBottom: insets.bottom > 0 ? insets.bottom + 4 : 10,
              borderTopWidth: 1,
              borderTopColor: theme.borderSub,
              backgroundColor: theme.bg,
            }}>
              <TextInput
                style={{
                  flex: 1,
                  backgroundColor: isDark ? theme.bgSurface : theme.bgSurface,
                  borderRadius: 20,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  color: theme.text1,
                  fontSize: 14,
                  maxHeight: 100,
                  borderWidth: 1,
                  borderColor: theme.border,
                  lineHeight: 19,
                }}
                placeholder="Mensagem..."
                placeholderTextColor={theme.text3}
                value={inputText}
                onChangeText={setInputText}
                multiline
                maxLength={1000}
                selectionColor={theme.textGreen}
              />
              <TouchableOpacity
                onPress={() => void handleSend()}
                disabled={!inputText.trim() || sending}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  backgroundColor: inputText.trim() ? theme.textGreen : theme.backBtn,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {sending
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Ionicons name="send" size={17} color={inputText.trim() ? "#fff" : theme.text3} />}
              </TouchableOpacity>
            </View>
          ) : null}
        </KeyboardAvoidingView>
      )}
    </View>
  );
}
