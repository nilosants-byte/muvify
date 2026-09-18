import React, { useCallback, useMemo, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppState } from "../../../state/AppState";
import { useMvTheme } from "../../../theme/MvThemeContext";
import { useAuthQuery } from "../../../hooks/useAuthQuery";
import { queryKeys } from "../../../lib/queryKeys";
import { bookingsApi, chatApi, gamificationApi, Booking } from "../../../services/api/client";
import { MvAvatar, MvToggle } from "../../../components/mv";
import { getInitials } from "../../../utils/formatters";
import { resolveMediaUrl } from "../../../utils/media";
import { computeUserProgress, computeAchievements } from "../../../utils/gamification";
import { C, S, DISPLAY } from "../../../theme/v2tokens";
import { ClientHomeDrawer, SideMenuItem } from "./ClientHomeDrawer";
import { ClientNotificationsDrawer } from "./ClientNotificationsDrawer";

// Pedido do teste manual QA: a Home travada (aluno com vínculo ativo, ver
// ClientHomeLocked) ficava "seca" comparada à Home de descoberta — mesmo
// sem o mapa/busca de outros profissionais (removidos ali de propósito,
// Bloco 3), o cabeçalho (avatar, atalhos de favoritos/chat/notificações,
// saudação e a faixa de progresso) não tem nada de descoberta e pode ser
// o mesmo nas duas telas. Extraído da ClientHomeScreen original pra virar
// um componente à parte, autossuficiente (busca seus próprios dados), em
// vez de duplicar essa lógica nas duas telas.
export function ClientHomeHeader() {
  const { theme, isDark, toggleTheme } = useMvTheme();
  const { user, runWithAuth, signOut, pushNotificationsEnabled, setPushNotificationsPreference } = useAppState();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const isLight = theme.mode === "light";
  const lightModeEnabled = !isDark;

  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsDrawerOpen, setNotificationsDrawerOpen] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);

  const firstName = useMemo(() => user?.name?.split(" ")[0] ?? "Aluno", [user?.name]);
  const clientInitials = useMemo(() => getInitials(user?.name), [user?.name]);
  const profilePhotoUri = useMemo(() => resolveMediaUrl(user?.photoUrl, true), [user?.photoUrl]);

  const goToStack = useCallback(
    (screen: string, params?: object) => {
      const parent = navigation.getParent();
      if (parent) parent.navigate(screen, params);
    },
    [navigation]
  );

  const handleLightModeToggle = useCallback(
    (enabled: boolean) => {
      if (enabled !== lightModeEnabled) toggleTheme();
    },
    [lightModeEnabled, toggleTheme]
  );

  // Contagem de não lidos do chat — atualiza toda vez que a tela ganha foco,
  // mesmo padrão já usado na Home de descoberta.
  useFocusEffect(
    useCallback(() => {
      runWithAuth((token) => chatApi.myChats(token))
        .then((chats) => setUnreadChatCount(chats.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0)))
        .catch(() => {});
    }, [runWithAuth])
  );

  const bookingsQuery = useAuthQuery(queryKeys.bookings.me(), (token) => bookingsApi.me(token));
  const bookings = bookingsQuery.data ?? ([] as Booking[]);

  // Épico de Frentes, Frente 8, Lote 5: nível/streak vêm do backend (mesma
  // fonte que a aba Comunidade já usa); o cálculo local só serve de
  // fallback enquanto a query não carrega ou falha.
  const gamificationQuery = useAuthQuery(queryKeys.gamification.myProfile(), (token) => gamificationApi.getMyProfile(token));
  const gamificationData = gamificationQuery.data ?? null;
  const gamifProgress = useMemo(() => computeUserProgress(bookings as any), [bookings]);
  const displayStreak = gamificationData?.currentStreak ?? gamifProgress.streak;
  const displayLevel = gamificationData?.currentLevel ?? gamifProgress.level;

  const monthlyCompleted = useMemo(
    () =>
      bookings.filter((b) => {
        if (b.status !== "COMPLETED") return false;
        const d = new Date(b.completedAt ?? b.scheduledAt);
        const now = new Date();
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      }).length,
    [bookings]
  );

  const nextAchievement = useMemo(() => {
    const prog = { ...gamifProgress, streak: displayStreak, level: displayLevel };
    const achievs = computeAchievements(prog);
    const locked = achievs.find((a) => !a.unlocked);
    if (!locked) return null;
    let current = 0;
    let total = 1;
    if (locked.id === "iniciante") { current = prog.totalWorkouts; total = 10; }
    else if (locked.id === "mente_focada") { current = prog.streak; total = 7; }
    else if (locked.id === "consistente") { current = prog.streak; total = 30; }
    else if (locked.id === "elite") { current = prog.totalWorkouts; total = 100; }
    return { ...locked, current, total, fraction: Math.min(1, current / total) };
  }, [gamifProgress, displayStreak, displayLevel]);

  const sideMenuItems: SideMenuItem[] = [
    {
      key: "appearance",
      label: "Aparência",
      subtitle: lightModeEnabled ? "Modo light" : "Modo dark",
      icon: lightModeEnabled ? "sunny-outline" : "moon-outline",
      right: <MvToggle value={lightModeEnabled} onValueChange={handleLightModeToggle} accessibilityLabel="Aparência" />,
      sectionHeader: "AJUSTES"
    },
    {
      key: "notifications",
      label: "Notificações",
      subtitle: pushNotificationsEnabled ? "Push ativado" : "Push desativado",
      icon: "notifications-outline",
      right: <MvToggle value={pushNotificationsEnabled} onValueChange={(v) => void setPushNotificationsPreference(v)} accessibilityLabel="Notificações" />
    },
    {
      key: "security",
      label: "Segurança",
      icon: "shield-checkmark-outline",
      onPress: () => { setMenuOpen(false); goToStack("Security"); },
      sectionHeader: "MAIS"
    },
    {
      key: "support",
      label: "Suporte",
      icon: "help-circle-outline",
      onPress: () => { setMenuOpen(false); goToStack("Support"); }
    },
    {
      key: "logout",
      label: "Sair da conta",
      icon: "log-out-outline",
      danger: true,
      onPress: () => { setMenuOpen(false); void signOut(); }
    }
  ];

  return (
    <>
      {/* Header — 3 colunas: avatar | logo centralizada | ícones */}
      <View
        style={{
          paddingTop: insets.top + 10,
          paddingHorizontal: 14,
          paddingBottom: 10,
          backgroundColor: isLight ? "#f2f7f4" : "#070c09",
          borderBottomWidth: 1,
          borderBottomColor: theme.borderSub,
          flexDirection: "row",
          alignItems: "center"
        }}
      >
        <TouchableOpacity onPress={() => setMenuOpen((open) => !open)} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Abrir menu" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <MvAvatar initials={clientInitials} size={34} color="green" photoUri={profilePhotoUri} />
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ fontFamily: "Nunito_800ExtraBold", fontWeight: "800", fontSize: 22, color: theme.text1, letterSpacing: -0.03 * 22 }}>muvi</Text>
            <Text style={{ fontFamily: "Nunito_800ExtraBold", fontWeight: "800", fontSize: 22, color: theme.primary, letterSpacing: -0.03 * 22 }}>fy</Text>
          </View>
        </TouchableOpacity>

        <View style={{ flex: 1 }} />

        <View style={{ flexDirection: "row", gap: 6, width: 114, justifyContent: "flex-end" }}>
          <TouchableOpacity
            onPress={() => navigation.navigate("Favorites")}
            accessibilityRole="button"
            accessibilityLabel="Favoritos"
            style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="heart-outline" size={18} color={isLight ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.6)"} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => { setUnreadChatCount(0); goToStack("ClientChatList"); }}
            accessibilityRole="button"
            accessibilityLabel="Chat"
            style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="chatbubbles-outline" size={18} color={isLight ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.6)"} />
            {unreadChatCount > 0 ? (
              <View style={{ position: "absolute", top: -2, right: -2, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: "#f44336", borderWidth: 1.5, borderColor: isLight ? "#f2f7f4" : "#070c09", alignItems: "center", justifyContent: "center", paddingHorizontal: 3 }}>
                <Text style={{ color: "#fff", fontSize: 9, fontWeight: "700", lineHeight: 12 }}>{unreadChatCount > 99 ? "99+" : String(unreadChatCount)}</Text>
              </View>
            ) : null}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setNotificationsDrawerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Notificações"
            style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="notifications-outline" size={18} color={isLight ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.6)"} />
            {unreadNotifCount > 0 ? (
              <View style={{ position: "absolute", top: -2, right: -2, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: "#f44336", borderWidth: 1.5, borderColor: isLight ? "#f2f7f4" : "#070c09", alignItems: "center", justifyContent: "center", paddingHorizontal: 3 }}>
                <Text style={{ color: "#fff", fontSize: 9, fontWeight: "700", lineHeight: 12 }}>{unreadNotifCount > 99 ? "99+" : String(unreadNotifCount)}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        </View>
      </View>

      {/* Saudação */}
      <View style={{ paddingHorizontal: S.px, paddingTop: 20, paddingBottom: 16 }}>
        <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 28, letterSpacing: -0.4, lineHeight: 34 }}>
          <Text style={{ color: theme.text1 }}>Olá, </Text>
          <Text style={{ color: theme.primary }}>{firstName}!</Text>
        </Text>
      </View>

      {/* Faixa de progresso — sequência, nível, treinos do mês, próxima conquista */}
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => goToStack("Community")}
        accessibilityRole="button"
        accessibilityLabel={`Nível ${displayLevel}, sequência de ${displayStreak} dias`}
        style={{
          flexDirection: "row", alignItems: "center",
          marginHorizontal: S.px,
          borderRadius: 12, borderWidth: 1, borderColor: theme.border,
          backgroundColor: theme.cardBg,
          paddingHorizontal: 13, paddingVertical: 9
        }}
      >
        <Ionicons name="flame" size={13} color={C.amber} />
        <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: theme.text1, marginLeft: 4 }}>{displayStreak}</Text>
        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3, marginLeft: 3 }}>{displayStreak === 1 ? "dia" : "dias"}</Text>

        <View style={{ width: 1, height: 13, backgroundColor: theme.border, marginHorizontal: 10 }} />

        <Ionicons name="star" size={12} color={theme.primary} />
        <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: theme.text1, marginLeft: 4 }}>Nível {displayLevel}</Text>

        <View style={{ width: 1, height: 13, backgroundColor: theme.border, marginHorizontal: 10 }} />

        <Ionicons name="barbell-outline" size={12} color={theme.primary} />
        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3, marginLeft: 4 }}>
          <Text style={{ fontFamily: "DMSans_700Bold", color: theme.primary }}>{monthlyCompleted}</Text>/18
        </Text>

        {nextAchievement ? (
          <>
            <View style={{ width: 1, height: 13, backgroundColor: theme.border, marginHorizontal: 10 }} />
            <Ionicons name={nextAchievement.icon as any} size={12} color={theme.primary} />
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3, marginLeft: 4, flexShrink: 1 }} numberOfLines={1}>
              {nextAchievement.label}
            </Text>
          </>
        ) : null}

        <View style={{ flex: 1 }} />
        <Ionicons name="chevron-forward" size={12} color={theme.text3} />
      </TouchableOpacity>

      <ClientHomeDrawer
        visible={menuOpen}
        items={sideMenuItems}
        onDismiss={() => setMenuOpen(false)}
        insetTop={insets.top}
        isLight={isLight}
        displayName={user?.name ?? "Aluno"}
        initials={clientInitials}
        photoUri={profilePhotoUri}
      />

      <ClientNotificationsDrawer
        visible={notificationsDrawerOpen}
        navigation={navigation.getParent() ?? navigation}
        onClose={() => setNotificationsDrawerOpen(false)}
        onUnreadCountChange={setUnreadNotifCount}
      />
    </>
  );
}
