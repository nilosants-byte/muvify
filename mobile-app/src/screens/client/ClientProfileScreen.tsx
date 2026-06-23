import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StatusBar, Text, TextInput, TouchableOpacity, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { useFocusEffect } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ClientTabParamList } from "../../navigation/route-types";
import { useAppState } from "../../state/AppState";
import { bookingsApi, communityApi, consultancyApi, gamificationApi, uploadsApi, userApi } from "../../services/api/client";
import { resolveMediaUrl } from "../../utils/media";
import { MvAvatar, MvProgressBar, MvRefreshControl } from "../../components/mv";
import { useMvTheme } from "../../theme/MvThemeContext";
import { C, S, DISPLAY } from "../../theme/v2tokens";
import { ClientBottomNavV2 } from "../../components/navigation/ClientBottomNavV2";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { AnimatedNumber } from "../../components/polish/AnimatedNumber";
import { SkeletonCard } from "../../components/polish/SkeletonCard";
import { computeUserProgress, computeAchievements, mapBackendAchievement, type BackendAchievement } from "../../utils/gamification";
import { hapticAchievement } from "../../utils/haptics";
import type { Achievement, UserProgress } from "../../types/gamification";

const SEEN_ACHIEVEMENTS_KEY = "@muvify/seenAchievements";
const PTS_PER_LEVEL = 500;

function applyPhoneMask(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits.length ? `(${digits}` : "";
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}


type Props = BottomTabScreenProps<ClientTabParamList, "ClientProfile">;

type ProfileStats = {
  totalBookings: number;
  upcomingBookings: number;
  activeContracts: number;
  deliveredContracts: number;
};

const initialStats: ProfileStats = { totalBookings: 0, upcomingBookings: 0, activeContracts: 0, deliveredContracts: 0 };

// Componente de linha de menu V2
function MenuRow({
  icon, label, subtitle, badge, onPress, danger = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  subtitle?: string;
  badge?: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const { theme } = useMvTheme();
  const iconColor = danger ? theme.danger : theme.primary;
  const iconBg = danger ? "rgba(239,68,68,0.12)" : theme.primarySubtle;
  const iconBorder = danger ? "rgba(239,68,68,0.20)" : theme.primarySubtleBorder;
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: theme.border, minHeight: S.touchMin }}
      activeOpacity={0.75}
    >
      <View style={{ width: 38, height: 38, borderRadius: 14, backgroundColor: iconBg, borderWidth: 1, borderColor: iconBorder, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Ionicons name={icon} size={16} color={iconColor} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: danger ? theme.danger : theme.text1 }}>{label}</Text>
        {subtitle && <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3, marginTop: 1 }} numberOfLines={1}>{subtitle}</Text>}
      </View>
      {badge && (
        <View style={{ backgroundColor: "rgba(249,115,22,0.10)", borderWidth: 1, borderColor: "rgba(249,115,22,0.38)", borderRadius: S.chipR, paddingHorizontal: 8, paddingVertical: 2 }}>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: "#F97316" }}>{badge}</Text>
        </View>
      )}
      {!badge && <Ionicons name="chevron-forward" size={14} color={theme.labelColor} />}
    </TouchableOpacity>
  );
}

export function ClientProfileScreen({ navigation }: Props) {
  const { runWithAuth, setCurrentUser, user, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const [photoUri, setPhotoUri] = useState<string | null>(() => resolveMediaUrl(user?.photoUrl) ?? null);
  const [displayName, setDisplayName] = useState(user?.name ?? "Aluno");
  const [editingName, setEditingName] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [displayPhone, setDisplayPhone] = useState(applyPhoneMask(user?.phone ?? ""));
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [stats, setStats] = useState<ProfileStats>(initialStats);
  const [statsLoading, setStatsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState<UserProgress>({ level: 1, points: 0, streak: 0, weeklyGoal: { current: 0, target: 4 }, monthlyGoal: { current: 0, target: 18 }, totalWorkouts: 0 });
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [anamnesisNeedsAttention, setAnamnesisNeedsAttention] = useState(false);

  useEffect(() => { setPhotoUri(resolveMediaUrl(user?.photoUrl) ?? null); }, [user?.photoUrl]);
  useEffect(() => { if (!editingName) setDisplayName(user?.name ?? "Aluno"); }, [editingName, user?.name]);
  useEffect(() => { if (!editingPhone) setDisplayPhone(applyPhoneMask(user?.phone ?? "")); }, [editingPhone, user?.phone]);

  const initials = useMemo(() => {
    const parts = (user?.name ?? "A").trim().split(/\s+/);
    return parts.length === 1 ? (parts[0]?.slice(0, 2) ?? "AL").toUpperCase() : `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }, [user?.name]);

  const firstName = useMemo(() => user?.name?.split(" ")[0] ?? "Aluno", [user?.name]);
  const goToStack = (screen: string) => { const parent = navigation.getParent<any>(); if (parent) parent.navigate(screen); };

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const [bookingData, trainingData, anamnesisData, gamProfile, backendAchievements, followingRes] = await Promise.all([
        runWithAuth((token) => bookingsApi.me(token)).catch(() => []),
        runWithAuth((token) => consultancyApi.myTraining(token)).catch(() => null),
        runWithAuth((token) => userApi.myAnamnesis(token)).catch(() => null),
        runWithAuth((token) => gamificationApi.getMyProfile(token)).catch(() => null),
        runWithAuth((token) => gamificationApi.getAchievements(token)).catch(() => [] as BackendAchievement[]),
        runWithAuth((token) => communityApi.getFollowing(token, 1, 50)).catch(() => ({ items: [], total: 0 })),
      ]);
      if (anamnesisData) {
        const incomplete = anamnesisData.status !== "COMPLETED";
        const outdated = anamnesisData.completedAt
          ? new Date() >= new Date(new Date(anamnesisData.completedAt).setMonth(new Date(anamnesisData.completedAt).getMonth() + 6))
          : false;
        setAnamnesisNeedsAttention(incomplete || outdated);
      }
      const contracts = trainingData?.contracts ?? [];
      const allBookings = bookingData ?? [];
      setStats({
        totalBookings: allBookings.length,
        upcomingBookings: allBookings.filter((b: any) => b.status === "PENDING" || b.status === "CONFIRMED").length,
        activeContracts: contracts.filter((c: any) => c.status === "ACTIVE" || c.status === "PENDING_PAYMENT").length,
        deliveredContracts: contracts.filter((c: any) => c.status === "DELIVERED").length,
      });
      const prog = computeUserProgress(allBookings as any);
      const achievs = backendAchievements.length > 0
        ? backendAchievements.map((ach) => mapBackendAchievement(ach, {
            totalWorkouts: prog.totalWorkouts,
            currentStreak: gamProfile?.currentStreak ?? prog.streak,
            currentLevel: gamProfile?.currentLevel ?? prog.level,
            followingCount: followingRes.total ?? followingRes.items.length,
          }))
        : computeAchievements(prog);
      setProgress(prog);
      setAchievements(achievs);
      try {
        const seenRaw = await AsyncStorage.getItem(SEEN_ACHIEVEMENTS_KEY);
        const seen: string[] = seenRaw ? (JSON.parse(seenRaw) as string[]) : [];
        const newlyUnlocked = achievs.filter((a) => a.unlocked && !seen.includes(a.id));
        if (newlyUnlocked.length > 0) {
          hapticAchievement();
          await AsyncStorage.setItem(SEEN_ACHIEVEMENTS_KEY, JSON.stringify([...seen, ...newlyUnlocked.map((a) => a.id)]));
        }
      } catch { /* ignore storage errors */ }
    } catch { /* silently ignore */ }
    finally { setStatsLoading(false); }
  }, [runWithAuth]);

  useFocusEffect(useCallback(() => { void loadStats(); return undefined; }, [loadStats]));

  const saveNameIfNeeded = useCallback(async () => {
    const trimmed = displayName.trim();
    const current = (user?.name ?? "Aluno").trim();
    if (!trimmed) { showToast("O nome não pode ficar vazio.", "error"); setDisplayName(current); setEditingName(false); return; }
    if (trimmed === current) { setEditingName(false); return; }
    try {
      setNameSaving(true);
      const updated = await runWithAuth((token) => userApi.updateMe(token, { name: trimmed }));
      setCurrentUser(updated);
      showToast("Nome atualizado.", "success");
    } catch { showToast("Falha ao atualizar nome. Tente novamente.", "error"); }
    finally { setNameSaving(false); }
  }, [displayName, runWithAuth, setCurrentUser, showToast, user?.name]);

  const savePhoneIfNeeded = useCallback(async () => {
    const digits = displayPhone.replace(/\D/g, "");
    const currentDigits = (user?.phone ?? "").replace(/\D/g, "");
    if (digits && digits.length < 10) { showToast("Telefone inválido.", "error"); setDisplayPhone(applyPhoneMask(user?.phone ?? "")); setEditingPhone(false); return; }
    if (digits === currentDigits) { setEditingPhone(false); return; }
    try {
      setPhoneSaving(true);
      const updated = await runWithAuth((token) => userApi.updateMe(token, { phone: digits || undefined }));
      setCurrentUser(updated);
      showToast("Telefone atualizado.", "success");
    } catch { showToast("Falha ao atualizar telefone. Tente novamente.", "error"); }
    finally { setPhoneSaving(false); }
  }, [displayPhone, runWithAuth, setCurrentUser, showToast, user?.phone]);

  const pickPhoto = useCallback(async (fromCamera: boolean) => {
    try {
      let result: ImagePicker.ImagePickerResult;
      if (fromCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") { showToast("Permissão para câmera negada.", "error"); return; }
        result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.6, base64: true });
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") { showToast("Permissão para galeria negada.", "error"); return; }
        result = await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, quality: 0.6, base64: true });
      }
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) return;
      if (!asset.base64) {
        showToast("Não foi possível capturar a imagem. Tente novamente.", "error");
        return;
      }
      const dataUri = `data:${asset.mimeType ?? "image/jpeg"};base64,${asset.base64}`;
      setPhotoUri(asset.uri);
      const updated = await runWithAuth(async (token) => {
        const { url } = await uploadsApi.uploadMedia(token, dataUri, "profile-photos");
        return userApi.updateMe(token, { photoUrl: url });
      });
      setCurrentUser(updated);
      showToast("Foto atualizada.", "success");
    } catch { showToast("Falha ao selecionar foto.", "error"); }
  }, [runWithAuth, setCurrentUser, showToast]);

  const openPhotoSheet = useCallback(() => {
    Alert.alert("Foto de perfil", "Escolha uma opção", [
      { text: "Câmera", onPress: () => void pickPhoto(true) },
      { text: "Galeria", onPress: () => void pickPhoto(false) },
      ...(photoUri ? [{ text: "Remover foto", style: "destructive" as const, onPress: async () => {
        try { setPhotoUri(null); const updated = await runWithAuth((token) => userApi.updateMe(token, { photoUrl: "" })); setCurrentUser(updated); }
        catch { showToast("Falha ao remover foto.", "error"); }
      }}] : []),
      { text: "Cancelar", style: "cancel" },
    ]);
  }, [photoUri, pickPhoto, runWithAuth, setCurrentUser, showToast]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.client.profile">
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      {/* Header V2 */}
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: theme.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 24, color: theme.text1, letterSpacing: -0.3 }}>Perfil</Text>
          <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 11, color: theme.text3, marginTop: 2 }}>sua conta e evolução</Text>
        </View>
        <TouchableOpacity
          onPress={() => goToStack("ClientSettings")}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="settings-outline" size={18} color={theme.text1} />
        </TouchableOpacity>
      </View>

      <ScreenEntrance>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120, paddingTop: 16 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <MvRefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadStats().finally(() => setRefreshing(false));
            }}
          />
        }
      >

        {/* Hero card — avatar + nome + badges gamificação */}
        <View style={{ paddingHorizontal: S.px }}>
          <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.primarySubtleBorder, backgroundColor: "rgba(36,230,109,0.09)", padding: 16 }}>
            <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
              {/* Avatar com botão de câmera */}
              <TouchableOpacity onPress={openPhotoSheet} activeOpacity={0.8} style={{ position: "relative" }}>
                <MvAvatar initials={initials} tone="green" size="lg" photoUri={photoUri} />
                <View style={{ position: "absolute", bottom: -4, right: -4, width: 26, height: 26, borderRadius: 13, backgroundColor: theme.primary, borderWidth: 2, borderColor: theme.bg, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="camera" size={12} color={theme.textOnPrimary} />
                </View>
              </TouchableOpacity>

              <View style={{ flex: 1 }}>
                {editingName ? (
                  <TextInput
                    value={displayName}
                    onChangeText={setDisplayName}
                    onBlur={() => void saveNameIfNeeded()}
                    onSubmitEditing={() => void saveNameIfNeeded()}
                    autoFocus
                    returnKeyType="done"
                    editable={!nameSaving}
                    style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 22, color: theme.text1, letterSpacing: -0.02 * 22, borderBottomWidth: 1, borderBottomColor: theme.primarySubtleBorder, paddingVertical: 2 }}
                  />
                ) : (
                  <TouchableOpacity onPress={() => setEditingName(true)} disabled={nameSaving} activeOpacity={0.8}>
                    <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 22, color: theme.text1, letterSpacing: -0.02 * 22 }}>{displayName}</Text>
                  </TouchableOpacity>
                )}
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, marginTop: 4 }}>
                  {user?.apelido ? `@${user.apelido}` : "Aluno muvify"}
                </Text>

                {/* Telefone editável */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
                  <Ionicons name="call-outline" size={13} color={theme.text3} />
                  {editingPhone ? (
                    <TextInput
                      value={displayPhone}
                      onChangeText={(v) => setDisplayPhone(applyPhoneMask(v))}
                      onBlur={() => void savePhoneIfNeeded()}
                      onSubmitEditing={() => void savePhoneIfNeeded()}
                      autoFocus
                      keyboardType="phone-pad"
                      textContentType="telephoneNumber"
                      autoComplete="tel"
                      returnKeyType="done"
                      editable={!phoneSaving}
                      placeholder="(XX) XXXXX-XXXX"
                      placeholderTextColor={theme.text3}
                      style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text1, borderBottomWidth: 1, borderBottomColor: theme.primarySubtleBorder, paddingVertical: 2, flex: 1 }}
                    />
                  ) : (
                    <TouchableOpacity onPress={() => setEditingPhone(true)} disabled={phoneSaving} activeOpacity={0.8}>
                      <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: displayPhone ? theme.text2 : theme.text3 }}>
                        {displayPhone || "Adicionar telefone"}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Badges de gamificação — dados reais derivados dos bookings */}
                <View style={{ flexDirection: "row", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                  <View style={{ backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, borderRadius: S.chipR, paddingHorizontal: 10, paddingVertical: 3 }}>
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: theme.primary }}>
                      nível {progress.level}
                    </Text>
                  </View>
                  {progress.streak > 0 && (
                    <View style={{ backgroundColor: C.amberDim, borderWidth: 1, borderColor: C.amberBorder, borderRadius: S.chipR, paddingHorizontal: 10, paddingVertical: 3 }}>
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: C.amber }}>
                        {progress.streak} {progress.streak === 1 ? "dia seguido" : "dias seguidos"}
                      </Text>
                    </View>
                  )}
                  {progress.points > 0 && (
                    <View style={{ backgroundColor: C.skyDim, borderWidth: 1, borderColor: C.skyBorder, borderRadius: S.chipR, paddingHorizontal: 10, paddingVertical: 3 }}>
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: C.sky }}>
                        {progress.points.toLocaleString("pt-BR")} pts
                      </Text>
                    </View>
                  )}
                  {progress.points === 0 && (
                    <View style={{ backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, borderRadius: S.chipR, paddingHorizontal: 10, paddingVertical: 3 }}>
                      <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 10, color: theme.text3 }}>Aluno muvify</Text>
                    </View>
                  )}
                </View>

                {/* Barra de progresso de nível */}
                <View style={{ marginTop: 10 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
                    <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 9, color: theme.text3 }}>Nível {progress.level}</Text>
                    <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 9, color: theme.text3 }}>
                      {progress.points % PTS_PER_LEVEL}/{PTS_PER_LEVEL} pts → Nível {progress.level + 1}
                    </Text>
                  </View>
                  <MvProgressBar progress={(progress.points % PTS_PER_LEVEL) / PTS_PER_LEVEL} height={5} />
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* Minha evolução — stats reais com skeleton */}
        <View style={{ paddingHorizontal: S.px, marginTop: S.gap }}>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 18, color: theme.text1, letterSpacing: -0.03 * 18, marginBottom: 12 }}>Minha evolução</Text>
          {statsLoading ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              {[1, 2, 3, 4].map((i) => (
                <View key={i} style={{ flex: 1, backgroundColor: theme.cardBg, borderRadius: 16, borderWidth: 1, borderColor: theme.border, height: 70 }} />
              ))}
            </View>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8, display: statsLoading ? "none" : "flex" }}>
            {[
              { label: "Agendamentos", value: stats.totalBookings, color: theme.primary },
              { label: "Próximos", value: stats.upcomingBookings, color: C.amber },
              { label: "Treinos ativos", value: stats.activeContracts, color: C.sky },
              { label: "Entregues", value: stats.deliveredContracts, color: theme.text2 },
            ].map((s) => (
              <View key={s.label} style={{ flex: 1, backgroundColor: theme.cardBg, borderWidth: 1, borderColor: theme.border, borderRadius: 16, padding: 10, alignItems: "center" }}>
                <AnimatedNumber
                  value={s.value}
                  duration={700}
                  style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 18, color: s.color, letterSpacing: -0.013 * 18 }}
                />
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 9, color: theme.text3, marginTop: 2, textAlign: "center" }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Minhas conquistas */}
        <View style={{ paddingHorizontal: S.px, marginTop: S.gap }}>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 18, color: theme.text1, letterSpacing: -0.03 * 18, marginBottom: 12 }}>Minhas conquistas</Text>
          {statsLoading ? (
            <View style={{ gap: 10 }}>
              {[1, 2].map((i) => (
                <View key={i} style={{ height: 68, backgroundColor: theme.cardBg, borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border }} />
              ))}
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {achievements.map((a) => {
                const u = a.unlocked;
                const bg = u ? (a.tier === "bronze" ? C.amberDim : a.tier === "silver" ? C.skyDim : theme.primarySubtle) : theme.cardBg;
                const bd = u ? (a.tier === "bronze" ? C.amberBorder : a.tier === "silver" ? C.skyBorder : theme.primarySubtleBorder) : theme.border;
                const col = u ? (a.tier === "bronze" ? C.amber : a.tier === "silver" ? C.sky : theme.primary) : theme.text3;
                return (
                  <View key={a.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: bg, borderWidth: 1, borderColor: bd, borderRadius: S.cardR, padding: 14 }}>
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: u ? bg : "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: bd, alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name={a.icon as any} size={18} color={col} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: u ? col : theme.text2 }}>{a.label}</Text>
                      <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3, marginTop: 2 }}>
                        {u ? a.description : a.requirement}
                      </Text>
                    </View>
                    {u ? (
                      <View style={{ backgroundColor: bg, borderWidth: 1, borderColor: bd, borderRadius: S.chipR, paddingHorizontal: 8, paddingVertical: 3 }}>
                        <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: col }}>+{a.points} pts</Text>
                      </View>
                    ) : (
                      <Ionicons name="lock-closed-outline" size={14} color={theme.text3} />
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* Conta e preferências — menu V2 */}
        <View style={{ paddingHorizontal: S.px, marginTop: S.gap }}>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 18, color: theme.text1, letterSpacing: -0.03 * 18, marginBottom: 4 }}>Conta e preferências</Text>
          <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, paddingHorizontal: 14 }}>
            <MenuRow icon="person-outline" label="Dados do perfil" subtitle={user?.email ?? ""} onPress={() => goToStack("ClientSettings")} />
            <MenuRow icon="card-outline" label="Pagamentos e compras" subtitle="Métodos e histórico" onPress={() => goToStack("ClientPaymentMethod")} />
            <MenuRow icon="barbell-outline" label="Treinos contratados" subtitle="Planos e consultorias" onPress={() => navigation.navigate("MyTraining")} />
            <MenuRow icon="calendar-outline" label="Aulas presenciais" subtitle="Meus agendamentos" onPress={() => navigation.navigate("ClientBookings")} />
            <MenuRow icon="clipboard-outline" label="Ficha de saúde" subtitle={anamnesisNeedsAttention ? "Requer atenção" : "Anamnese e histórico"} badge={anamnesisNeedsAttention ? "!" : undefined} onPress={() => goToStack("ClientAnamnesis")} />
            <MenuRow icon="heart-outline" label="Profissionais favoritos" subtitle="Personais salvos" onPress={() => navigation.navigate("Favorites")} />
            <MenuRow icon="help-circle-outline" label="Ajuda e suporte" subtitle="Fale com a equipe" onPress={() => goToStack("Support")} />
          </View>
        </View>

        {/* Rodapé de privacidade */}
        <View style={{ paddingHorizontal: S.px, marginTop: S.gap }}>
          <TouchableOpacity onPress={() => goToStack("Privacy")} style={{ padding: 14, borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Ionicons name="shield-checkmark-outline" size={18} color={theme.text2} />
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, flex: 1 }}>
              Seus dados são protegidos pela Muvify. Toque para ver os Termos e Privacidade.
            </Text>
            <Ionicons name="chevron-forward" size={14} color={theme.labelColor} />
          </TouchableOpacity>
        </View>
      </ScrollView>
      </ScreenEntrance>

      <ClientBottomNavV2
        activeTab="profile"
        onNavigate={(tab) => {
          if (tab === "home") navigation.navigate("ClientHome");
          if (tab === "agenda") navigation.navigate("ClientBookings");
          if (tab === "trainings") navigation.navigate("MyTraining");
          if (tab === "community") navigation.navigate("Community");
        }}
      />
    </View>
  );
}
