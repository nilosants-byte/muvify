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
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvAvatar, MvText } from "../../components/mv";
import { ProfessionalBottomNav } from "../../components/navigation/ProfessionalBottomNav";
import { formatBRTime } from "../../utils/formatters";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "ProfessionalChatList">;
type Tab = "active" | "inactive";
const POLL_MS = 12000;

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
  const { runWithAuth, user } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const myUserId = user?.id ?? "";
  const isDark = theme.mode === "dark";

  // ── State ───────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>("active");
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [loading, setLoading] = useState(true);
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
    try {
      const data = await runWithAuth((t) => chatApi.myChats(t));
      if (!isMountedRef.current) return;
      const enriched = await enrichMissingPhotos(
        data,
        (id) => runWithAuth((t) => chatApi.getOtherUser(t, id))
      );
      if (!isMountedRef.current) return;
      setChats((prev) => mergeChatsPreservingPhoto(prev, enriched));
    } catch { /* best effort */ }
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
      pollRef.current = setTimeout(async () => {
        await fetchMessages(selectedId, false);
        if (isMountedRef.current) schedule();
      }, POLL_MS);
    };
    schedule();
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [selectedId, fetchMessages]);

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
    } catch { setInputText(text); }
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
  const navBg = isDark ? theme.navBg : "#FFFFFF";

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
            paddingHorizontal: 16,
            paddingBottom: 12,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            borderBottomWidth: 1,
            borderBottomColor: border,
            backgroundColor: bg,
          }}>
            <TouchableOpacity
              onPress={closeChat}
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
            >
              <Ionicons name="chevron-back" size={20} color={text2} />
            </TouchableOpacity>
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
            <TouchableOpacity
              onPress={() =>
                navigation.navigate("ProfessionalStudentAnamnesis", {
                  clientId: selectedChat.clientId,
                  clientName: selectedChat.otherUser.name,
                })
              }
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
            </TouchableOpacity>
          </View>

          {/* Messages */}
          {panelLoading ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator color={green} />
            </View>
          ) : panelError ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10 }}>
              <Ionicons name="alert-circle-outline" size={32} color={text3} />
              <MvText variant="semi3" color="secondary">Falha ao carregar mensagens</MvText>
              <TouchableOpacity onPress={() => void fetchMessages(selectedId, true)}>
                <MvText variant="semi3" style={{ color: green }}>Tentar novamente</MvText>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={(m) => m.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ padding: 16, gap: 10 }}
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
                const isMe = item.senderId === myUserId;
                return (
                  <View style={{ alignSelf: isMe ? "flex-end" : "flex-start", maxWidth: "80%", gap: 3 }}>
                    <View style={{
                      backgroundColor: isMe ? green : cardBg,
                      borderRadius: 18,
                      borderBottomRightRadius: isMe ? 4 : 18,
                      borderBottomLeftRadius: isMe ? 18 : 4,
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      borderWidth: isMe ? 0 : 1,
                      borderColor: border,
                    }}>
                      <MvText variant="body3" style={{ color: isMe ? "#fff" : text1, lineHeight: 22 }}>
                        {item.content}
                      </MvText>
                    </View>
                    <MvText style={{ fontSize: 11, color: text3, alignSelf: isMe ? "flex-end" : "flex-start", paddingHorizontal: 4 }}>
                      {formatBRTime(item.createdAt)}
                    </MvText>
                  </View>
                );
              }}
            />
          )}

          {/* Input */}
          {chatOpen ? (
            <View style={{
              flexDirection: "row",
              alignItems: "flex-end",
              gap: 10,
              paddingHorizontal: 16,
              paddingVertical: 12,
              paddingBottom: Math.max(12, insets.bottom),
              borderTopWidth: 1,
              borderTopColor: border,
              backgroundColor: bg,
            }}>
              <TextInput
                value={inputText}
                onChangeText={setInputText}
                placeholder="Mensagem..."
                placeholderTextColor={text3}
                multiline
                style={{
                  flex: 1,
                  backgroundColor: inputBg,
                  borderRadius: 22,
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  fontSize: 15,
                  color: text1,
                  maxHeight: 120,
                  borderWidth: 1,
                  borderColor: border,
                  lineHeight: 20,
                }}
              />
              <TouchableOpacity
                onPress={() => void sendMessage()}
                disabled={!inputText.trim() || sending}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: !inputText.trim() ? inputBg : green,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: !inputText.trim() ? border : green,
                }}
              >
                {sending
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Ionicons name="send" size={18} color={!inputText.trim() ? text3 : "#fff"} />
                }
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ padding: 16, alignItems: "center", borderTopWidth: 1, borderTopColor: border }}>
              <MvText variant="body4" color="secondary">Esta conversa foi encerrada</MvText>
            </View>
          )}
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
        paddingHorizontal: 16,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: border,
      }}>
        <MvText variant="semi1">Mensagens</MvText>
      </View>

      {/* Tabs */}
      <View style={{ flexDirection: "row", paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
        {(["active", "inactive"] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            onPress={() => setTab(t)}
            style={{
              paddingHorizontal: 18,
              paddingVertical: 8,
              borderRadius: 20,
              backgroundColor: tab === t ? "rgba(34,197,94,0.14)" : inputBg,
              borderWidth: 1,
              borderColor: tab === t ? "rgba(34,197,94,0.35)" : border,
            }}
          >
            <MvText variant="semi3" style={{ color: tab === t ? green : text2, fontSize: 13 }}>
              {t === "active" ? "Ativas" : "Inativas"}
            </MvText>
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={green} size="large" />
        </View>
      ) : (
        <FlatList
          data={filteredChats}
          keyExtractor={(c) => c.bookingId}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
          ListEmptyComponent={
            <View style={{ paddingTop: 60, alignItems: "center", gap: 12, paddingHorizontal: 32 }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "rgba(34,197,94,0.10)", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="chatbubbles-outline" size={30} color={green} />
              </View>
              <MvText variant="semi2" color="secondary" style={{ textAlign: "center" }}>
                {tab === "active" ? "Nenhuma conversa ativa" : "Nenhuma conversa inativa"}
              </MvText>
              <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>
                As conversas aparecerão aqui quando seus alunos iniciarem um agendamento.
              </MvText>
            </View>
          }
          renderItem={({ item }) => {
            const hasUnread = item.unreadCount > 0;
            return (
              <TouchableOpacity
                activeOpacity={0.82}
                onPress={() => openChat(item.bookingId)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 14,
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: border,
                  backgroundColor: hasUnread
                    ? (isDark ? "rgba(34,197,94,0.06)" : "rgba(34,197,94,0.04)")
                    : "transparent",
                }}
              >
                {/* Avatar */}
                <View>
                  <MvAvatar
                    initials={initials(item.otherUser.name)}
                    photoUri={item.otherUser.photoUrl ?? null}
                    size={52}
                    borderRadius={26}
                    color="green"
                  />
                  {hasUnread ? (
                    <View style={{
                      position: "absolute",
                      bottom: 0,
                      right: 0,
                      width: 16,
                      height: 16,
                      borderRadius: 8,
                      backgroundColor: green,
                      borderWidth: 2,
                      borderColor: bg,
                    }} />
                  ) : null}
                </View>

                {/* Content */}
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <MvText variant="semi2" numberOfLines={1} style={{ flex: 1 }}>
                      {item.otherUser.name}
                    </MvText>
                    {item.lastMessage?.createdAt ? (
                      <MvText style={{ fontSize: 12, color: hasUnread ? green : text3, marginLeft: 8 }}>
                        {relativeTime(item.lastMessage.createdAt)}
                      </MvText>
                    ) : null}
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <MvText
                      variant="body4"
                      color="secondary"
                      numberOfLines={1}
                      style={{ flex: 1, color: hasUnread ? text1 : text2, fontFamily: hasUnread ? "DMSans-SemiBold" : "DMSans-Regular" }}
                    >
                      {item.lastMessage?.content ?? "Iniciar conversa"}
                    </MvText>
                    {hasUnread && item.unreadCount > 0 ? (
                      <View style={{
                        minWidth: 20,
                        height: 20,
                        borderRadius: 10,
                        backgroundColor: green,
                        alignItems: "center",
                        justifyContent: "center",
                        paddingHorizontal: 5,
                        marginLeft: 8,
                      }}>
                        <MvText style={{ color: "#fff", fontSize: 11, fontFamily: "DMSans-Bold" }}>
                          {item.unreadCount > 99 ? "99+" : String(item.unreadCount)}
                        </MvText>
                      </View>
                    ) : null}
                  </View>
                </View>

                <Ionicons name="chevron-forward" size={16} color={text3} />
              </TouchableOpacity>
            );
          }}
        />
      )}

      <ProfessionalBottomNav
        activeKey="conversas"
        onPress={(key) => {
          if (key === "conversas") return;
          if (key === "home") navigation.navigate("ProfessionalTabs" as never);
          else if (key === "agenda") navigation.navigate("ProfessionalTabs", { screen: "ProfessionalAgenda" } as never);
          else if (key === "alunos") navigation.navigate("ProfessionalStudents" as never);
          else if (key === "financeiro") navigation.navigate("PayoutStatus" as never);
        }}
      />
    </View>
  );
}
