import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StatusBar,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import ConfettiCannon from "react-native-confetti-cannon";
import { useFocusEffect } from "@react-navigation/native";
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientTabParamList } from "../../navigation/route-types";
import { useAppState } from "../../state/AppState";
import { bookingsApi, Booking, communityApi, CommunityUser, UserPublicProfile, gamificationApi, GamificationProfile, RankingEntry, FeedPost, FeedPostMetadata, FeedComment, uploadsApi } from "../../services/api/client";
import { MvAvatar } from "../../components/mv";
import { computeAchievements, progressForScope, type ProgressScope as GamificationScope } from "../../utils/gamification";
import { useMvTheme } from "../../theme/MvThemeContext";
import type { MvTheme } from "../../theme/MvColors";
import { C, S, DISPLAY } from "../../theme/v2tokens";
import { hapticAchievement, hapticLike, hapticComment } from "../../utils/haptics";
import { PressableScale } from "../../components/polish/PressableScale";
import { AnimatedNumber } from "../../components/polish/AnimatedNumber";
import { ClientBottomNavV2 } from "../../components/navigation/ClientBottomNavV2";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import type { Achievement } from "../../types/gamification";
import { AchievementBadgeSvg } from "../../components/community/AchievementBadgeSvg";
import { FeedPostArtSvg } from "../../components/community/FeedPostArtSvg";
import { PhotoLightbox } from "../../components/community/PhotoLightbox";

type Props = BottomTabScreenProps<ClientTabParamList, "Community">;
type ProgressScope = GamificationScope;

// ── Milestones visuais de progresso ──────────────────────────────────────────
// Cada slot acende quando o usuário atinge o threshold correspondente.
// A intensidade (cor e tamanho) cresce à medida que o streak/nível avança.
const STREAK_MILESTONES = [
  { threshold: 1,  sz: 9,  color: "#fde68a" }, // início
  { threshold: 2,  sz: 9,  color: "#fbbf24" },
  { threshold: 3,  sz: 10, color: "#f59e0b" },
  { threshold: 5,  sz: 10, color: "#f97316" },
  { threshold: 7,  sz: 11, color: "#ea580c" },
  { threshold: 14, sz: 11, color: "#dc2626" },
  { threshold: 30, sz: 12, color: "#f43f5e" }, // máximo
] as const;

const LEVEL_MILESTONES = [
  { threshold: 1,  sz: 8  },
  { threshold: 3,  sz: 9  },
  { threshold: 5,  sz: 10 },
  { threshold: 10, sz: 11 },
  { threshold: 20, sz: 12 },
] as const;

// ── Tipos e helpers para achievements do backend ──────────────────────────────
type BackendAchievement = {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  medalType: string;
  xpReward: number;
  conditionType: string;
  conditionValue: number;
  unlockedAt?: string | null;
};

const CONDITION_ICON: Record<string, string> = {
  STREAK_SESSIONS:               "flame",
  TOTAL_WORKOUTS:                "barbell",
  TOTAL_FOLLOWING:               "person-add",
  TOTAL_FOLLOWERS:               "people",
  TOTAL_REVIEWS_SUBMITTED:       "star",
  TOTAL_PHOTO_POSTS:             "camera",
  DISTINCT_PROVIDERS_TRAINED:    "fitness",
  WEEKLY_TOP3_REACHED:           "trophy",
  WEEKLY_1ST_REACHED:            "medal",
  WEEKLY_TOP3_CONSECUTIVE_WEEKS: "infinite",
  LEVEL_REACHED:                 "flash",
};

const MEDAL_TIER: Record<string, Achievement["tier"]> = {
  BRONZE:  "bronze",
  SILVER:  "silver",
  GOLD:    "gold",
  DIAMOND: "diamond",
  SPECIAL: "special",
};

const CATEGORY_LABELS: Record<string, string> = {
  PROGRESSION:  "Progressão",
  CONSISTENCY:  "Consistência",
  VOLUME:       "Volume",
  SOCIAL:       "Social",
  RANKING:      "Ranking",
};
const CATEGORY_ORDER = ["PROGRESSION", "CONSISTENCY", "VOLUME", "SOCIAL", "RANKING"];

function mapBackendAchievement(
  ach: BackendAchievement,
  ctx: { totalWorkouts: number; currentStreak: number; currentLevel: number; followingCount: number }
): Achievement {
  const progressCurrents: Partial<Record<string, number>> = {
    STREAK_SESSIONS: ctx.currentStreak,
    TOTAL_WORKOUTS:  ctx.totalWorkouts,
    TOTAL_FOLLOWING: ctx.followingCount,
    LEVEL_REACHED:   ctx.currentLevel,
  };
  const unlocked = ach.unlockedAt != null;
  const currentVal = progressCurrents[ach.conditionType];
  return {
    id: ach.id,
    icon: CONDITION_ICON[ach.conditionType] ?? "ribbon",
    label: ach.name,
    description: ach.description,
    requirement: ach.description,
    unlocked,
    unlockedAt: ach.unlockedAt ? new Date(ach.unlockedAt) : undefined,
    points: ach.xpReward,
    tier: MEDAL_TIER[ach.medalType] ?? "bronze",
    category: ach.category,
    progress: currentVal !== undefined && !unlocked
      ? { current: Math.min(currentVal, ach.conditionValue), target: ach.conditionValue }
      : undefined,
  };
}

function achAccentColors(tier: Achievement["tier"], theme: MvTheme) {
  if (tier === "gold")    return { color: C.amber,   dim: C.amberDim,                       border: C.amberBorder };
  if (tier === "silver")  return { color: C.zinc300, dim: "rgba(212,212,216,0.12)" as const, border: "rgba(212,212,216,0.20)" as const };
  if (tier === "diamond") return { color: C.sky,     dim: "rgba(56,189,248,0.12)" as const,  border: "rgba(56,189,248,0.25)" as const };
  if (tier === "special") return { color: "#a855f7", dim: "rgba(168,85,247,0.12)" as const,  border: "rgba(168,85,247,0.25)" as const };
  return { color: theme.primary, dim: theme.primarySubtle, border: theme.primarySubtleBorder };
}

// ── Componente ScopeSwitch ────────────────────────────────────────────────────
function ScopeSwitch({ value, onChange }: { value: ProgressScope; onChange: (v: ProgressScope) => void }) {
  const { theme } = useMvTheme();
  return (
    <View style={{ flexDirection: "row", backgroundColor: "rgba(255,255,255,0.05)", borderRadius: S.chipR, padding: 3 }}>
      {(["Semana", "Mês", "Geral"] as ProgressScope[]).map((v) => {
        const active = value === v;
        return (
          <TouchableOpacity
            key={v}
            onPress={() => onChange(v)}
            style={{ height: 28, paddingHorizontal: 10, borderRadius: S.chipR, backgroundColor: active ? theme.primarySubtle : "transparent", borderWidth: active ? 1 : 0, borderColor: theme.primarySubtleBorder, justifyContent: "center" }}
          >
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: active ? theme.primary : theme.text3 }}>{v}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Helpers de calendário ─────────────────────────────────────────────────────
/** Dias no mês atual (leva em conta meses de 28, 29, 30, 31 dias) */
function daysInCurrentMonth(): number {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
}

/** Dias no ano atual (365 ou 366 nos anos bissextos) */
function daysInCurrentYear(): number {
  const y = new Date().getFullYear();
  return new Date(y, 11, 31).getTime() !== new Date(y, 11, 31).getTime()
    ? 365
    : ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 366 : 365;
}

// ── Seletor de meta (stepper + input + barra) ────────────────────────────────
function GoalPickerRow({
  label, value, min, max, onChange,
}: {
  label: string; value: number; min: number; max: number;
  onChange: (v: number) => void;
}) {
  const { theme } = useMvTheme();
  const [text, setText] = React.useState(String(value));

  React.useEffect(() => { setText(String(value)); }, [value]);

  const commit = (raw: string) => {
    const n = parseInt(raw.replace(/\D/g, ""), 10);
    const clamped = isNaN(n) ? value : Math.max(min, Math.min(max, n));
    onChange(clamped);
    setText(String(clamped));
  };

  const pct = max > 0 ? Math.round((value / max) * 100) : 0;

  return (
    <View style={{ marginBottom: 22 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }}>{label}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <TouchableOpacity
            onPress={() => onChange(Math.max(min, value - 1))}
            disabled={value <= min}
            style={{
              width: 32, height: 32, borderRadius: 99,
              backgroundColor: theme.cardBg, borderWidth: 1, borderColor: theme.border,
              alignItems: "center", justifyContent: "center",
              opacity: value <= min ? 0.28 : 1,
            }}
          >
            <Ionicons name="remove" size={16} color={theme.text1} />
          </TouchableOpacity>
          <TextInput
            style={{
              fontFamily: DISPLAY, fontWeight: "800", fontSize: 22, color: theme.text1,
              width: 48, textAlign: "center", paddingVertical: 0,
            }}
            value={text}
            onChangeText={setText}
            onEndEditing={() => commit(text)}
            onBlur={() => commit(text)}
            keyboardType="number-pad"
            maxLength={3}
            returnKeyType="done"
          />
          <TouchableOpacity
            onPress={() => onChange(Math.min(max, value + 1))}
            disabled={value >= max}
            style={{
              width: 32, height: 32, borderRadius: 99,
              backgroundColor: theme.cardBg, borderWidth: 1, borderColor: theme.border,
              alignItems: "center", justifyContent: "center",
              opacity: value >= max ? 0.28 : 1,
            }}
          >
            <Ionicons name="add" size={16} color={theme.text1} />
          </TouchableOpacity>
        </View>
      </View>
      <View style={{ height: 3, borderRadius: 99, backgroundColor: "rgba(255,255,255,0.09)" }}>
        <View style={{ height: "100%", width: `${pct}%`, borderRadius: 99, backgroundColor: theme.primary }} />
      </View>
      <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 10, color: theme.text3, marginTop: 4, textAlign: "right" }}>
        máx {max}
      </Text>
    </View>
  );
}

// ── Texto amigável por tipo de post ──────────────────────────────────────────
function postTypeLabel(type: string): string {
  const map: Record<string, string> = {
    WORKOUT_COMPLETED: "concluiu um treino",
    ACHIEVEMENT_UNLOCKED: "desbloqueou uma conquista",
    LEVEL_UP: "subiu de nível",
    STREAK_MILESTONE: "atingiu um marco de sequência",
    RANKING_ENTERED_WEEKLY_TOP3: "entrou no top 3 semanal",
    RANKING_WEEK_ENDED_TOP3: "terminou a semana no top 3",
    RANKING_ENTERED_MONTHLY_TOP3: "entrou no top 3 mensal",
    RANKING_MONTH_ENDED_TOP3: "terminou o mês no top 3",
    MANUAL_PHOTO: "postou uma foto de treino",
  };
  return map[type] ?? "fez algo incrível";
}

// ── Card "Em breve" ───────────────────────────────────────────────────────────
function ComingSoonCard({
  icon, title, description, tag,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  description: string;
  tag: string;
}) {
  const { theme } = useMvTheme();
  return (
    <View style={{ paddingHorizontal: S.px, marginTop: S.gap }}>
      <View style={{
        borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border,
        backgroundColor: theme.cardBg, padding: S.cardPad, gap: 14,
      }}>
        {/* Header com título e badge */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 18, color: theme.text1, letterSpacing: -0.03 * 18 }}>{title}</Text>
          <View style={{ backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, borderRadius: S.chipR, paddingHorizontal: 10, paddingVertical: 3 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: theme.text2 }}>{tag}</Text>
          </View>
        </View>

        {/* Ícone central + ilustração */}
        <View style={{
          height: 120, borderRadius: 18,
          backgroundColor: theme.inputBg, borderWidth: 1, borderColor: theme.border,
          alignItems: "center", justifyContent: "center", gap: 10,
        }}>
          <View style={{
            width: 56, height: 56, borderRadius: 18,
            backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder,
            alignItems: "center", justifyContent: "center",
          }}>
            <Ionicons name={icon} size={28} color={theme.primary} />
          </View>
        </View>

        {/* Descrição */}
        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, lineHeight: 20 }}>
          {description}
        </Text>
      </View>
    </View>
  );
}

// ── Ícone temático por tipo de post ──────────────────────────────────────────
function postThematicCard(type: string, theme: MvTheme): {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  color: string; bg: string; border: string;
} {
  if (type === "WORKOUT_COMPLETED")   return { icon: "barbell",  color: theme.primary, bg: theme.primarySubtle, border: theme.primarySubtleBorder };
  if (type === "ACHIEVEMENT_UNLOCKED") return { icon: "medal",   color: C.amber, bg: C.amberDim, border: C.amberBorder };
  if (type === "LEVEL_UP")             return { icon: "rocket",  color: C.sky,   bg: C.skyDim,   border: C.skyBorder };
  if (type === "STREAK_MILESTONE")     return { icon: "flame",   color: C.amber, bg: C.amberDim, border: C.amberBorder };
  if (type === "MANUAL_PHOTO")         return { icon: "camera",  color: theme.primary, bg: theme.primarySubtle, border: theme.primarySubtleBorder };
  if (type.startsWith("RANKING_"))     return { icon: "trophy",  color: C.amber, bg: C.amberDim, border: C.amberBorder };
  return                                      { icon: "sparkles", color: theme.primary, bg: theme.primarySubtle, border: theme.primarySubtleBorder };
}

// ── Imagem do post com proporção natural ─────────────────────────────────────
// Limites: máximo paisagem 16:9, máximo retrato 3:4 — cobre 95% das fotos.
const FEED_MAX_RATIO = 16 / 9;
const FEED_MIN_RATIO = 3 / 4;

function FeedImage({ uri, fallback }: {
  uri: string;
  fallback: ReturnType<typeof postThematicCard>;
}) {
  const [errored, setErrored] = useState(false);
  const [ratio, setRatio] = useState(4 / 3); // padrão enquanto carrega

  if (errored) {
    return (
      <View style={{ height: 80, borderRadius: 12, backgroundColor: fallback.bg, borderWidth: 1, borderColor: fallback.border, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={fallback.icon} size={24} color={fallback.color} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={{ width: "100%", aspectRatio: ratio, borderRadius: 12 }}
      resizeMode="cover"
      onLoad={(e) => {
        const { width, height } = e.nativeEvent.source;
        if (width && height) {
          setRatio(Math.max(FEED_MIN_RATIO, Math.min(FEED_MAX_RATIO, width / height)));
        }
      }}
      onError={() => setErrored(true)}
    />
  );
}

// ── Tempo relativo ────────────────────────────────────────────────────────────
function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "agora";
  if (mins < 60) return `há ${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `há ${days}d`;
  return new Date(dateStr).toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
}

// ── Card temático rico por tipo de post ──────────────────────────────────────
function ThematicCard({ post, theme }: { post: FeedPost; theme: MvTheme }) {
  const meta = (post.metadata ?? {}) as Record<string, unknown>;
  const config = postThematicCard(post.type, theme);
  let headline = "";
  let detail = "";

  if (post.type === "WORKOUT_COMPLETED") {
    headline = meta.type === "ONLINE" ? "Treino online concluído" : "Aula presencial concluída";
  } else if (post.type === "LEVEL_UP") {
    const lvl = meta.newLevel as number | undefined;
    const name = meta.levelName as string | undefined;
    headline = name && lvl ? `Nível ${lvl} — ${name}` : "Novo nível alcançado!";
    if (meta.totalXp) detail = `${meta.totalXp} XP acumulados no total`;
  } else if (post.type === "STREAK_MILESTONE") {
    const sessions = meta.sessions as number | undefined;
    headline = sessions ? `${sessions} treinos seguidos!` : "Marco de sequência!";
    detail = "Uma sequência incrível de dedicação";
  } else if (post.type.startsWith("RANKING_")) {
    const position = meta.position as number | undefined;
    const posLabel = position === 1 ? "1° lugar" : position === 2 ? "2° lugar" : "3° lugar";
    const isWeekly = post.type.includes("WEEK");
    const isMonthly = post.type.includes("MONTH");
    headline = position ? posLabel : "Top 3";
    const scope = isWeekly ? "semanal" : isMonthly ? "mensal" : "geral";
    detail = `Ranking ${scope} de amigos${meta.xpEarned ? ` · +${meta.xpEarned} XP` : ""}`;
  } else if (post.type === "ACHIEVEMENT_UNLOCKED") {
    headline = "Conquista desbloqueada!";
    detail = "Uma nova medalha adicionada ao perfil";
  } else {
    headline = "Momento incrível!";
  }

  return (
    <View style={{ borderRadius: 12, backgroundColor: config.bg, borderWidth: 1, borderColor: config.border, padding: 14, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{
          width: 36, height: 36, borderRadius: 10,
          backgroundColor: `${config.color}20`,
          borderWidth: 1, borderColor: config.border,
          alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <Ionicons name={config.icon} size={19} color={config.color} />
        </View>
        <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: config.color, flex: 1, lineHeight: 20 }}>
          {headline}
        </Text>
      </View>
      {Boolean(detail) && (
        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, lineHeight: 18 }}>
          {detail}
        </Text>
      )}
    </View>
  );
}

// ── Card individual de post do feed ──────────────────────────────────────────
function FeedPostCard({
  post,
  runWithAuth,
  onNavigateToProvider,
  onNavigateToProfile,
  onCommentFocus,
  onDeletePost,
  showToast,
  viewerId,
}: {
  post: FeedPost;
  runWithAuth: (fn: (token: string) => Promise<any>) => Promise<any>;
  onNavigateToProvider: (id: string) => void;
  onNavigateToProfile: (userId: string) => void;
  onCommentFocus: () => void;
  onDeletePost: (postId: string) => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
  viewerId: string;
}) {
  const { theme, isDark } = useMvTheme();
  const meta = (post.metadata ?? {}) as FeedPostMetadata & Record<string, unknown>;
  const hasProvider = post.type === "WORKOUT_COMPLETED" && Boolean(meta.providerId);
  const postUser = post.user;

  const [liked, setLiked] = useState(post.likedByViewer ?? false);
  const [likesCount, setLikesCount] = useState<number>(post.likesCount ?? (post as any)._count?.likes ?? 0);
  const [commentsCount, setCommentsCount] = useState<number>(post.commentsCount ?? (post as any)._count?.comments ?? 0);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [commentsPage, setCommentsPage] = useState(0);
  const [commentsHasMore, setCommentsHasMore] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [activeComment, setActiveComment] = useState<{ id: string; mode: "actions" | "edit" } | null>(null);
  const [editText, setEditText] = useState("");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const likeInFlight = useRef(false);
  const lastTapRef = useRef(0);
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartScale = useRef(new Animated.Value(0)).current;
  const heartOpacity = useRef(new Animated.Value(0)).current;
  const [showMenu, setShowMenu] = useState(false);
  const isOwner = post.user?.id === viewerId;

  useEffect(() => () => {
    if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
  }, []);

  async function handleLike() {
    if (likeInFlight.current) return;
    likeInFlight.current = true;
    const wasLiked = liked;
    setLiked(!wasLiked);
    setLikesCount((c) => wasLiked ? Math.max(0, c - 1) : c + 1);
    if (!wasLiked) hapticLike();
    try {
      const result = await runWithAuth((token) => communityApi.likePost(token, post.id));
      if (result && typeof result.liked === "boolean") {
        setLiked(result.liked);
        // If server disagreed with the toggle, also rollback count
        if (result.liked !== !wasLiked) {
          setLikesCount((c) => wasLiked ? c + 1 : Math.max(0, c - 1));
        }
      }
    } catch {
      setLiked(wasLiked);
      setLikesCount((c) => wasLiked ? c + 1 : Math.max(0, c - 1));
      showToast("Não foi possível curtir. Tente novamente.", "error");
    } finally {
      likeInFlight.current = false;
    }
  }

  function triggerHeartAnimation() {
    heartScale.setValue(0.3);
    heartOpacity.setValue(1);
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1.2, useNativeDriver: true, speed: 20, bounciness: 10 }),
      Animated.timing(heartScale, { toValue: 0.9, duration: 100, useNativeDriver: true }),
      Animated.delay(400),
      Animated.timing(heartOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start();
  }

  function handleTap() {
    const now = Date.now();
    if (now - lastTapRef.current < 350) {
      // Toque duplo → curtir
      if (singleTapTimer.current) {
        clearTimeout(singleTapTimer.current);
        singleTapTimer.current = null;
      }
      if (!liked) triggerHeartAnimation();
      handleLike();
      lastTapRef.current = 0;
    } else {
      // Primeiro toque — aguarda 360ms para ver se vem segundo toque
      lastTapRef.current = now;
      if (post.imageUrl) {
        singleTapTimer.current = setTimeout(() => {
          setLightboxOpen(true);
          singleTapTimer.current = null;
        }, 360);
      }
    }
  }

  async function loadComments(page: number) {
    setCommentsLoading(true);
    try {
      const res = await runWithAuth((token) => communityApi.getComments(token, post.id, page, 5));
      setComments((prev) => page === 1 ? res.items : [...prev, ...res.items]);
      setCommentsPage(page);
      setCommentsHasMore(page < res.totalPages);
    } catch { /* best effort */ }
    finally { setCommentsLoading(false); }
  }

  function toggleComments() {
    if (commentsOpen) { setCommentsOpen(false); return; }
    setCommentsOpen(true);
    if (commentsPage === 0) loadComments(1);
  }

  async function submitComment() {
    const text = commentText.trim();
    if (!text || commentSubmitting) return;
    setCommentSubmitting(true);
    try {
      const newComment = await runWithAuth((token) => communityApi.addComment(token, post.id, text));
      setComments((prev) => [...prev, newComment]);
      setCommentsCount((c) => c + 1);
      setCommentText("");
      hapticComment();
    } catch {
      showToast("Não foi possível enviar o comentário. Tente novamente.", "error");
    } finally { setCommentSubmitting(false); }
  }

  function toggleCommentActions(commentId: string) {
    setActiveComment(prev => prev?.id === commentId ? null : { id: commentId, mode: "actions" });
  }

  function startEditComment(c: FeedComment) {
    setEditText(c.content);
    setActiveComment({ id: c.id, mode: "edit" });
  }

  function cancelEdit() {
    setActiveComment(null);
    setEditText("");
  }

  async function saveEditComment(commentId: string) {
    const text = editText.trim();
    if (!text) return;
    try {
      const updated = await runWithAuth((token) => communityApi.editComment(token, post.id, commentId, text));
      setComments(prev => prev.map(c => c.id === commentId ? updated : c));
      setActiveComment(null);
      setEditText("");
    } catch {
      showToast("Não foi possível editar o comentário.", "error");
    }
  }

  async function handleDeleteComment(c: FeedComment) {
    try {
      await runWithAuth((token) => communityApi.deleteComment(token, post.id, c.id));
      setComments(prev => prev.filter(x => x.id !== c.id));
      setCommentsCount(n => Math.max(0, n - 1));
      setActiveComment(null);
    } catch (err: unknown) {
      const status = (err as any)?.statusCode;
      showToast(`Não foi possível excluir o comentário${status ? ` (${status})` : ""}. Tente novamente.`, "error");
    }
  }

  const thematic = postThematicCard(post.type, theme);

  return (
    <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, overflow: "hidden" }}>
      {/* Cabeçalho + conteúdo + ações */}
      <View style={{ padding: S.cardPad, gap: 10 }}>
        {/* Avatar | nome / ação / tempo — toque navega para o perfil */}
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={() => postUser?.id && onNavigateToProfile(postUser.id)}
          style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}
        >
          <MvAvatar
            initials={(postUser?.name ?? "?").slice(0, 2).toUpperCase()}
            photoUri={postUser?.photoUrl ?? null}
            tone="green"
            size="sm"
          />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1, lineHeight: 18 }}>
              {postUser?.name ?? "Alguém"}
            </Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, lineHeight: 17 }}>
              {post.type === "MANUAL_PHOTO" && !post.imageUrl
                ? "compartilhou um momento"
                : post.type === "MANUAL_PHOTO"
                ? "compartilhou uma foto de treino"
                : postTypeLabel(post.type)}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3 }}>
              {formatRelativeTime(post.createdAt)}
            </Text>
            <TouchableOpacity onPress={() => setShowMenu(true)} hitSlop={10}>
              <Ionicons name="ellipsis-horizontal" size={18} color={theme.text3} />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>

        {/* Conteúdo visual — toque único abre lightbox, toque duplo dá like */}
        <TouchableOpacity activeOpacity={0.97} onPress={handleTap}>
          {post.imageUrl ? (
            <View>
              <FeedImage uri={post.imageUrl} fallback={thematic} />
              <Animated.View
                pointerEvents="none"
                style={{
                  position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                  alignItems: "center", justifyContent: "center",
                  opacity: heartOpacity,
                  transform: [{ scale: heartScale }],
                }}
              >
                <Ionicons name="heart" size={86} color="rgba(255,255,255,0.92)" />
              </Animated.View>
            </View>
          ) : post.type === "MANUAL_PHOTO" && post.caption ? (
            /* Texto livre: caption é o conteúdo principal, tipo vira tag pequena */
            <View style={{ borderRadius: 12, backgroundColor: theme.inputBg, borderWidth: 1, borderColor: theme.border, padding: 14, gap: 10 }}>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 15, color: theme.text1, lineHeight: 22 }}>
                {post.caption}
              </Text>
              <View style={{ flexDirection: "row" }}>
                <View style={{
                  flexDirection: "row", alignItems: "center", gap: 4,
                  borderRadius: 99, borderWidth: 1, borderColor: theme.primarySubtleBorder,
                  paddingHorizontal: 8, paddingVertical: 3,
                  backgroundColor: theme.primarySubtle,
                }}>
                  <Ionicons name="pencil-outline" size={10} color={theme.primary} />
                  <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 10, color: theme.primary }}>Texto</Text>
                </View>
              </View>
            </View>
          ) : (
            <FeedPostArtSvg post={post} />
          )}
        </TouchableOpacity>

        {/* Lightbox para foto ampliada */}
        {post.imageUrl && (
          <PhotoLightbox
            uri={post.imageUrl}
            visible={lightboxOpen}
            onClose={() => setLightboxOpen(false)}
          />
        )}

        {/* Caption abaixo — apenas para posts com foto ou cards temáticos */}
        {post.caption && !(post.type === "MANUAL_PHOTO" && !post.imageUrl) && (
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, lineHeight: 18 }}>
            {post.caption}
          </Text>
        )}

        {/* Curtidas e comentários */}
        <View style={{ flexDirection: "row", gap: 16 }}>
          <TouchableOpacity onPress={handleLike} activeOpacity={0.7} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Ionicons name={liked ? "heart" : "heart-outline"} size={17} color={liked ? "#ef4444" : theme.text3} />
            <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 12, color: liked ? "#ef4444" : theme.text3 }}>
              {likesCount}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={toggleComments} activeOpacity={0.7} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Ionicons name={commentsOpen ? "chatbubble" : "chatbubble-outline"} size={16} color={commentsOpen ? theme.primary : theme.text3} />
            <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 12, color: commentsOpen ? theme.primary : theme.text3 }}>
              {commentsCount}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Bloco collab — personal vinculado ao treino */}
      {hasProvider && (
        <TouchableOpacity
          onPress={() => onNavigateToProvider(meta.providerId as string)}
          activeOpacity={0.75}
          style={{
            flexDirection: "row", alignItems: "center", gap: 10,
            borderTopWidth: 1, borderTopColor: theme.border,
            paddingHorizontal: S.cardPad, paddingVertical: 10,
          }}
        >
          <MvAvatar
            initials={((meta.providerName as string) ?? "?").slice(0, 2).toUpperCase()}
            photoUri={(meta.providerPhotoUrl as string | null) ?? null}
            tone="green"
            size={28}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3 }}>
              com{" "}<Text style={{ fontFamily: "DMSans_700Bold", color: theme.text2 }}>{meta.providerName as string}</Text>
            </Text>
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 10, color: theme.primary, marginTop: 1 }}>
              Ver perfil do personal →
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={14} color={theme.text3} />
        </TouchableOpacity>
      )}

      {/* Seção de comentários — dropdown inline */}
      {commentsOpen && (
        <View style={{ borderTopWidth: 1, borderTopColor: theme.border, paddingHorizontal: S.cardPad, paddingTop: 12, paddingBottom: 10, gap: 10 }}>
          {comments.map((c) => {
            const isOwn = c.user.id === viewerId;
            const isActive = activeComment?.id === c.id;
            const isEditing = isActive && activeComment?.mode === "edit";
            return (
              <View key={c.id} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                <MvAvatar
                  initials={(c.user.name ?? "?").slice(0, 2).toUpperCase()}
                  photoUri={c.user.photoUrl ?? null}
                  tone="green"
                  size={28}
                />
                <TouchableOpacity
                  activeOpacity={isOwn ? 0.82 : 1}
                  onPress={isOwn ? () => toggleCommentActions(c.id) : undefined}
                  disabled={!isOwn}
                  style={{ flex: 1 }}
                >
                  <View style={{
                    backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
                    borderRadius: 10,
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    borderWidth: 1,
                    borderColor: isEditing ? theme.primary : isActive ? "rgba(249,115,22,0.35)" : "transparent",
                  }}>
                    {/* Nome + ícones de ação */}
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: isEditing ? 5 : 0 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: theme.text1 }}>{c.user.name}</Text>
                        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 10, color: theme.text3 }}>{formatRelativeTime(c.createdAt)}</Text>
                      </View>
                      {isActive && !isEditing && (
                        <View style={{ flexDirection: "row", gap: 10, marginLeft: 8 }}>
                          <TouchableOpacity onPress={() => startEditComment(c)} hitSlop={10}>
                            <Ionicons name="create-outline" size={16} color={theme.primary} />
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => handleDeleteComment(c)} hitSlop={10}>
                            <Ionicons name="trash-outline" size={16} color="#ef4444" />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                    {isEditing ? (
                      <View>
                        <TextInput
                          value={editText}
                          onChangeText={setEditText}
                          autoFocus
                          multiline
                          style={{
                            fontFamily: "DMSans_400Regular",
                            fontSize: 12,
                            color: theme.text1,
                            lineHeight: 17,
                            minHeight: 28,
                            paddingVertical: 0,
                          }}
                        />
                        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
                          <TouchableOpacity onPress={cancelEdit} hitSlop={8}>
                            <Ionicons name="close-circle-outline" size={22} color={theme.text3} />
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => saveEditComment(c.id)} disabled={!editText.trim()} hitSlop={8}>
                            <Ionicons name="checkmark-circle" size={22} color={editText.trim() ? theme.primary : theme.text3} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, marginTop: 1, lineHeight: 17 }}>
                        {c.content}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              </View>
            );
          })}
          {commentsLoading && <ActivityIndicator size="small" color={theme.primary} />}
          {!commentsLoading && comments.length === 0 && (
            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3, textAlign: "center", paddingVertical: 4 }}>
              Seja o primeiro a comentar!
            </Text>
          )}
          {commentsHasMore && !commentsLoading && (
            <TouchableOpacity onPress={() => loadComments(commentsPage + 1)} hitSlop={8}>
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: theme.primary }}>Ver mais comentários</Text>
            </TouchableOpacity>
          )}
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center", borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 10 }}>
            <TextInput
              value={commentText}
              onChangeText={setCommentText}
              placeholder="Escreva um comentário..."
              placeholderTextColor={theme.text3}
              onFocus={onCommentFocus}
              style={{
                flex: 1,
                fontFamily: "DMSans_400Regular",
                fontSize: 13,
                color: theme.text1,
                backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
                borderRadius: 20,
                paddingHorizontal: 14,
                paddingVertical: 8,
                minHeight: 36,
              }}
              returnKeyType="send"
              onSubmitEditing={submitComment}
            />
            <TouchableOpacity
              onPress={submitComment}
              disabled={!commentText.trim() || commentSubmitting}
              hitSlop={8}
              style={{
                width: 34, height: 34, borderRadius: 17,
                backgroundColor: commentText.trim() ? theme.primary : (isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"),
                alignItems: "center", justifyContent: "center",
              }}
            >
              {commentSubmitting
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="send" size={14} color={commentText.trim() ? "#fff" : theme.text3} />
              }
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Menu de opções do post ─────────────────────────────────── */}
      <Modal visible={showMenu} transparent animationType="slide" onRequestClose={() => setShowMenu(false)} statusBarTranslucent>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }} onPress={() => setShowMenu(false)}>
          <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: theme.inputBg, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 32, overflow: "hidden" }}>
            <View style={{ width: 36, height: 4, borderRadius: 99, backgroundColor: theme.border, alignSelf: "center", marginVertical: 12 }} />
            {/* Compartilhar */}
            <TouchableOpacity
              onPress={async () => {
                setShowMenu(false);
                await Share.share({ message: post.caption ? `"${post.caption}" — via Muvify` : "Confira este post no Muvify!" });
              }}
              style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 24, paddingVertical: 16 }}
            >
              <Ionicons name="share-outline" size={22} color={theme.text1} />
              <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 15, color: theme.text1 }}>Compartilhar</Text>
            </TouchableOpacity>
            {/* Denunciar — só para posts de outros */}
            {!isOwner && (
              <TouchableOpacity
                onPress={() => { setShowMenu(false); showToast("Denúncia recebida. Obrigado por nos avisar.", "info"); }}
                style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 24, paddingVertical: 16 }}
              >
                <Ionicons name="flag-outline" size={22} color={theme.text2} />
                <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 15, color: theme.text2 }}>Denunciar</Text>
              </TouchableOpacity>
            )}
            {/* Excluir — só para o dono do post */}
            {isOwner && (
              <TouchableOpacity
                onPress={async () => {
                  setShowMenu(false);
                  try {
                    await runWithAuth((token) => communityApi.deletePost(token, post.id));
                    onDeletePost(post.id);
                  } catch {
                    showToast("Não foi possível excluir o post.", "error");
                  }
                }}
                style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 24, paddingVertical: 16 }}
              >
                <Ionicons name="trash-outline" size={22} color="#ef4444" />
                <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 15, color: "#ef4444" }}>Excluir post</Text>
              </TouchableOpacity>
            )}
            {/* Cancelar */}
            <View style={{ height: 1, backgroundColor: theme.border, marginHorizontal: 24, marginVertical: 4 }} />
            <TouchableOpacity
              onPress={() => setShowMenu(false)}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 16 }}
            >
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text3 }}>Cancelar</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ── CommunityScreen ───────────────────────────────────────────────────────────
export function CommunityScreen({ navigation }: Props) {
  const { user, runWithAuth, showToast } = useAppState();
  const { theme, isDark } = useMvTheme();
  const insets = useSafeAreaInsets();

  const [scope, setScope] = useState<ProgressScope>("Semana");
  const [weeklyGoalTarget, setWeeklyGoalTarget] = useState(4);
  const [monthlyGoalTarget, setMonthlyGoalTarget] = useState(daysInCurrentMonth());
  const [annualGoalTarget, setAnnualGoalTarget] = useState(200);
  const [showGoalModal, setShowGoalModal] = useState(false);

  // Carrega metas salvas do AsyncStorage na primeira montagem
  useEffect(() => {
    AsyncStorage.multiGet(["@goal_weekly", "@goal_monthly", "@goal_annual"]).then((results) => {
      const [w, m, a] = results.map(([, v]) => v);
      const maxM = daysInCurrentMonth();
      const maxY = daysInCurrentYear();
      if (w) setWeeklyGoalTarget(Math.min(7, Math.max(1, parseInt(w, 10))));
      if (m) setMonthlyGoalTarget(Math.min(maxM, Math.max(1, parseInt(m, 10))));
      if (a) setAnnualGoalTarget(Math.min(maxY, Math.max(1, parseInt(a, 10))));
    }).catch(() => {});
  }, []);

  // Recalcula limites de calendário ao abrir o modal (protege contra virada de mês/ano)
  useEffect(() => {
    if (!showGoalModal) return;
    const maxM = daysInCurrentMonth();
    const maxY = daysInCurrentYear();
    setMonthlyGoalTarget((v) => Math.min(v, maxM));
    setAnnualGoalTarget((v) => Math.min(v, maxY));
  }, [showGoalModal]);
  const [celebratingAchievement, setCelebratingAchievement] = useState<Achievement | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [gamificationData, setGamificationData] = useState<GamificationProfile | null>(null);
  const confettiRef = useRef<any>(null);
  const feedScrollRef = useRef<ScrollView>(null);
  const feedContainerYRef = useRef(0);
  const postYOffsetsRef = useRef<Record<string, number>>({});
  const [refreshing, setRefreshing] = useState(false);
  const lastFocusRefreshRef = useRef(0);
  const initialLoadDoneRef = useRef(false);
  const [pendingFeedItems, setPendingFeedItems] = useState<FeedPost[]>([]);

  // ── Criar post ───────────────────────────────────────────────────────────────
  const [showCreatePost, setShowCreatePost] = useState(false);
  const [showAllAchievements, setShowAllAchievements] = useState(false);
  const [showRankingModal, setShowRankingModal] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [createCaption, setCreateCaption] = useState("");
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createPhotoUri, setCreatePhotoUri] = useState<string | null>(null);
  const [createPhotoData, setCreatePhotoData] = useState<string | null>(null);

  // ── Banner de boas-vindas (exibido uma vez por usuário) ──────────────────────
  const [showWelcomeBanner, setShowWelcomeBanner] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    const key = `@muvify/communityWelcome_${user.id}`;
    AsyncStorage.getItem(key).then((val) => {
      if (!val) setShowWelcomeBanner(true);
    }).catch(() => {});
  }, [user?.id]);

  async function dismissWelcomeBanner() {
    if (!user?.id) return;
    await AsyncStorage.setItem(`@muvify/communityWelcome_${user.id}`, "1").catch(() => {});
    setShowWelcomeBanner(false);
  }

  // ── Follow system ────────────────────────────────────────────────────────────
  const [showFollowModal, setShowFollowModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CommunityUser[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  // IDs que já seguimos — atualizado após confirmação da API
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Previne chamadas duplicadas de follow/unfollow enquanto uma está em andamento
  const followInFlightRef = useRef<Set<string>>(new Set());
  const searchInputRef = useRef<TextInput>(null);

  // Perfil público de usuário
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [profileData, setProfileData] = useState<UserPublicProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // Carrega IDs que já seguimos ao abrir
  useEffect(() => {
    runWithAuth((token) => communityApi.getFollowing(token, 1, 200))
      .then((res) => {
        setFollowingIds(new Set(res.items.map((u) => u.id)));
      })
      .catch(() => {});
  }, [runWithAuth]);

  // Busca debounced
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const res = await runWithAuth((token) =>
          communityApi.searchUsers(token, searchQuery.trim(), 1, 20)
        );
        setSearchResults(res.items);
        // Mescla isFollowing vindo do backend para manter followingIds sincronizado
        const followedInResults = res.items.filter((u) => u.isFollowing).map((u) => u.id);
        const unfollowedInResults = res.items.filter((u) => !u.isFollowing).map((u) => u.id);
        setFollowingIds((prev) => {
          const next = new Set(prev);
          followedInResults.forEach((id) => next.add(id));
          unfollowedInResults.forEach((id) => next.delete(id));
          return next;
        });
      } catch { /* best effort */ }
      finally { setSearchLoading(false); }
    }, 300);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [searchQuery, runWithAuth]);

  async function handleFollow(targetId: string) {
    if (followInFlightRef.current.has(targetId)) return;
    followInFlightRef.current.add(targetId);
    try {
      if (followingIds.has(targetId)) {
        await runWithAuth((token) => communityApi.unfollow(token, targetId));
        setFollowingIds((prev) => { const next = new Set(prev); next.delete(targetId); return next; });
      } else {
        await runWithAuth((token) => communityApi.follow(token, targetId));
        setFollowingIds((prev) => new Set([...prev, targetId]));
      }
    } catch { /* best effort */ }
    finally { followInFlightRef.current.delete(targetId); }
  }

  async function openUserProfile(userId: string) {
    setProfileUserId(userId);
    setProfileData(null);
    setProfileLoading(true);
    try {
      const profile = await runWithAuth((token) => communityApi.getUserPublicProfile(token, userId));
      setProfileData(profile);
    } catch { /* best effort */ }
    finally { setProfileLoading(false); }
  }

  // ── Ranking ──────────────────────────────────────────────────────────────────
  type RankingPeriod = "WEEKLY" | "MONTHLY" | "ALLTIME";
  const [rankingPeriod, setRankingPeriod] = useState<RankingPeriod>("WEEKLY");
  const [rankingItems, setRankingItems] = useState<RankingEntry[]>([]);
  const [rankingLoading, setRankingLoading] = useState(true);
  const [rankingTransitioning, setRankingTransitioning] = useState(false);
  const [viewerPosition, setViewerPosition] = useState<number | null>(null);
  const [viewerXp, setViewerXp] = useState(0);
  const prevViewerPositionRef = useRef<number | null>(null);

  // ── Feed ─────────────────────────────────────────────────────────────────────
  const [feedItems, setFeedItems] = useState<FeedPost[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedPage, setFeedPage] = useState(1);
  const [feedHasMore, setFeedHasMore] = useState(true);
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);

  const loadMoreFeed = useCallback(async () => {
    if (feedLoadingMore || !feedHasMore) return;
    try {
      setFeedLoadingMore(true);
      const nextPage = feedPage + 1;
      const res = await runWithAuth((token) => communityApi.getFeed(token, nextPage, 20));
      setFeedItems((prev) => [...prev, ...res.items]);
      setFeedPage(nextPage);
      setFeedHasMore(res.items.length === 20);
    } catch { /* best effort */ }
    finally { setFeedLoadingMore(false); }
  }, [feedHasMore, feedLoadingMore, feedPage, runWithAuth]);

  // ── Sugestões de quem seguir ──────────────────────────────────────────────────
  const [suggestions, setSuggestions] = useState<CommunityUser[]>([]);

  // ── Conquistas do backend ─────────────────────────────────────────────────────
  const [backendAchievements, setBackendAchievements] = useState<BackendAchievement[]>([]);

  // Carrega bookings + gamificação + feed + sugestões + conquistas em paralelo
  const loadData = useCallback(async () => {
    try {
      const [bks, gam, feedRes, suggestionsRes, achRes, followingRes] = await Promise.all([
        runWithAuth((token) => bookingsApi.me(token)),
        runWithAuth((token) => gamificationApi.getMyProfile(token)),
        runWithAuth((token) => communityApi.getFeed(token, 1, 20)).catch(() => ({ items: [] as FeedPost[], total: 0 })),
        runWithAuth((token) => communityApi.getSuggestions(token, 10)).catch(() => [] as CommunityUser[]),
        runWithAuth((token) => gamificationApi.getAchievements(token)).catch(() => [] as BackendAchievement[]),
        runWithAuth((token) => communityApi.getFollowing(token, 1, 50)).catch(() => ({ items: [] as CommunityUser[], total: 0 })),
      ]);
      setBookings(bks);
      setGamificationData(gam);
      setFeedItems(feedRes.items);
      setFeedPage(1);
      setFeedHasMore(feedRes.items.length === 20);
      setFeedLoading(false);
      setSuggestions(suggestionsRes);
      setBackendAchievements(achRes);
      setFollowingIds(new Set(followingRes.items.map((u) => u.id)));
      lastFocusRefreshRef.current = Date.now();
      initialLoadDoneRef.current = true;
    } catch { /* best effort */ }
  }, [runWithAuth]);

  useEffect(() => { void loadData(); }, [loadData]);

  // Pull-to-refresh: atualiza tudo silenciosamente (sem skeleton)
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    lastFocusRefreshRef.current = Date.now();
    try {
      const [bks, gam, feedRes, suggestionsRes, achRes, followingRes] = await Promise.all([
        runWithAuth((token) => bookingsApi.me(token)),
        runWithAuth((token) => gamificationApi.getMyProfile(token)),
        runWithAuth((token) => communityApi.getFeed(token, 1, 20)).catch(() => ({ items: [] as FeedPost[], total: 0 })),
        runWithAuth((token) => communityApi.getSuggestions(token, 10)).catch(() => [] as CommunityUser[]),
        runWithAuth((token) => gamificationApi.getAchievements(token)).catch(() => [] as BackendAchievement[]),
        runWithAuth((token) => communityApi.getFollowing(token, 1, 50)).catch(() => ({ items: [] as CommunityUser[], total: 0 })),
      ]);
      setBookings(bks);
      setGamificationData(gam);
      setFeedItems(feedRes.items);
      setPendingFeedItems([]);
      setFeedPage(1);
      setFeedHasMore(feedRes.items.length === 20);
      setSuggestions(suggestionsRes);
      setBackendAchievements(achRes);
      setFollowingIds(new Set(followingRes.items.map((u) => u.id)));
    } catch { /* best effort */ }
    finally { setRefreshing(false); }
  }, [runWithAuth]);

  // Ao voltar para a aba: refresh silencioso do feed se passaram mais de 60s
  useFocusEffect(
    useCallback(() => {
      if (!initialLoadDoneRef.current) return; // aguarda carga inicial terminar
      const now = Date.now();
      if (now - lastFocusRefreshRef.current < 60_000) return;
      lastFocusRefreshRef.current = now;
      runWithAuth((token) => communityApi.getFeed(token, 1, 20))
        .then((feedRes) => {
          const firstNewId = feedRes.items[0]?.id;
          const firstCurrentId = feedItems[0]?.id;
          // Só sinaliza "novos posts" se houver feed atual E o primeiro post mudou
          if (firstNewId && firstCurrentId && firstNewId !== firstCurrentId) {
            setPendingFeedItems(feedRes.items);
          } else {
            setFeedItems(feedRes.items);
            setFeedPage(1);
            setFeedHasMore(feedRes.items.length === 20);
          }
        })
        .catch(() => {});
    }, [runWithAuth, feedItems])
  );

  // Carrega ranking quando período muda
  const loadRanking = useCallback(async () => {
    const hasData = rankingItems.length > 0;
    if (hasData) {
      setRankingTransitioning(true);
    } else {
      setRankingLoading(true);
    }
    try {
      const res = await runWithAuth((token) => communityApi.getRanking(token, rankingPeriod, 1, 50));
      setRankingItems(res.items);
      setViewerXp(res.viewerXp ?? 0);
      // Detecta subida no ranking e celebra
      const prev = prevViewerPositionRef.current;
      const next = res.viewerPosition;
      if (prev !== null && next !== null && next < prev) {
        void hapticAchievement();
        showToast(`🎉 Você subiu para #${next} no ranking!`, "success");
      }
      prevViewerPositionRef.current = next;
      setViewerPosition(res.viewerPosition);
    } catch { /* best effort */ }
    finally {
      setRankingLoading(false);
      setRankingTransitioning(false);
    }
  }, [runWithAuth, rankingPeriod, rankingItems.length]);

  useEffect(() => { void loadRanking(); }, [loadRanking]);

  function closeCreatePost() {
    if (createSubmitting) return;
    setShowCreatePost(false);
    setCreateCaption("");
    setCreatePhotoUri(null);
    setCreatePhotoData(null);
  }

  async function pickCreatePhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") { showToast("Permissão para galeria negada.", "error"); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true, quality: 0.7, base64: true,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset?.uri || !asset.base64) { showToast("Não foi possível carregar a imagem.", "error"); return; }
    setCreatePhotoUri(asset.uri);
    setCreatePhotoData(`data:${asset.mimeType ?? "image/jpeg"};base64,${asset.base64}`);
  }

  async function submitCreatePost() {
    const caption = createCaption.trim();
    if (!caption || createSubmitting) return;
    setCreateSubmitting(true);
    try {
      await runWithAuth(async (token) => {
        let imageUrl: string | undefined;
        if (createPhotoData) {
          const uploaded = await uploadsApi.uploadMedia(token, createPhotoData, "feed-photos");
          imageUrl = uploaded.url;
        }
        return communityApi.createPost(token, {
          caption,
          ...(imageUrl ? { imageUrl } : {}),
        });
      });
      setCreateCaption("");
      setCreatePhotoUri(null);
      setCreatePhotoData(null);
      setShowCreatePost(false);
      // Recarrega o feed para mostrar o novo post
      const feedRes = await runWithAuth((token) => communityApi.getFeed(token, 1, 20)).catch(() => ({ items: [] as FeedPost[], total: 0 }));
      setFeedItems(feedRes.items);
      setFeedPage(1);
      setFeedHasMore(feedRes.items.length === 20);
      showToast("Post publicado!", "success");
    } catch {
      Keyboard.dismiss();
      showToast("Não foi possível publicar. Tente novamente.", "error");
    } finally {
      setCreateSubmitting(false);
    }
  }

  // Dispara confetti quando modal de conquista abre
  useEffect(() => {
    if (celebratingAchievement) {
      const t = setTimeout(() => confettiRef.current?.start(), 300);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [celebratingAchievement]);


  // Dados de progresso com metas configuradas pelo usuário
  // As contagens de treino são calculadas aqui para evitar dependência de variáveis
  // declaradas mais abaixo (weeklyCompleted / monthlyCompleted) que causariam TDZ.
  const d = useMemo(() => {
    const base = progressForScope(bookings, scope);
    const done = bookings.filter((b) => b.status === "COMPLETED");
    const now = new Date();

    const ws = new Date(now); ws.setHours(0, 0, 0, 0); ws.setDate(ws.getDate() - ws.getDay());
    const wDone = done.filter((b) => new Date(b.completedAt ?? b.scheduledAt) >= ws).length;

    const mDone = done.filter((b) => new Date(b.completedAt ?? b.scheduledAt) >= new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)).length;

    const yDone = done.filter((b) => new Date(b.completedAt ?? b.scheduledAt) >= new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0)).length;

    const current = scope === "Semana" ? wDone : scope === "Mês" ? mDone : yDone;
    const target  = scope === "Semana" ? weeklyGoalTarget : scope === "Mês" ? monthlyGoalTarget : annualGoalTarget;
    const pct     = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
    const meta    = `${current}/${target}`;
    const metaLabel = scope === "Semana" ? "treinos esta semana"
                    : scope === "Mês"   ? "treinos este mês"
                    :                     "treinos este ano";

    return {
      ...base,
      meta,
      metaLabel,
      pct,
      streak: gamificationData?.currentStreak ?? base.streak,
      pts:    gamificationData?.totalXp        ?? base.pts,
      lvl:    gamificationData?.currentLevel   ?? base.lvl,
    };
  }, [bookings, scope, weeklyGoalTarget, monthlyGoalTarget, annualGoalTarget, gamificationData]);

  const totalWorkouts = useMemo(() => bookings.filter((b) => b.status === "COMPLETED").length, [bookings]);

  const weeklyCompleted = useMemo(() => {
    const completed = bookings.filter((b) => b.status === "COMPLETED");
    const weekStart = new Date();
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    return completed.filter((b) => new Date(b.completedAt ?? b.scheduledAt) >= weekStart).length;
  }, [bookings]);

  const monthlyCompleted = useMemo(() => {
    const completed = bookings.filter((b) => b.status === "COMPLETED");
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1, 0, 0, 0, 0);
    return completed.filter((b) => new Date(b.completedAt ?? b.scheduledAt) >= monthStart).length;
  }, [bookings]);

  const achievements = useMemo(() => {
    if (backendAchievements.length > 0) {
      return backendAchievements.map((ach) => mapBackendAchievement(ach, {
        totalWorkouts,
        currentStreak: gamificationData?.currentStreak ?? d.streak,
        currentLevel:  gamificationData?.currentLevel  ?? d.lvl,
        followingCount: followingIds.size,
      }));
    }
    return computeAchievements({ level: d.lvl, points: d.pts, streak: d.streak, weeklyGoal: { current: weeklyCompleted, target: weeklyGoalTarget }, monthlyGoal: { current: monthlyCompleted, target: monthlyGoalTarget }, totalWorkouts });
  }, [backendAchievements, totalWorkouts, d.streak, d.lvl, d.pts, gamificationData, followingIds.size, weeklyCompleted, monthlyCompleted, weeklyGoalTarget, monthlyGoalTarget]);

  const snapshotAchievements = useMemo(() => {
    const unlocked = achievements
      .filter((a) => a.unlocked)
      .sort((a, b) => (b.unlockedAt?.getTime() ?? 0) - (a.unlockedAt?.getTime() ?? 0))
      .slice(0, 2);
    const locked = achievements
      .filter((a) => !a.unlocked)
      .sort((a, b) => {
        const aPct = a.progress ? a.progress.current / a.progress.target : 0;
        const bPct = b.progress ? b.progress.current / b.progress.target : 0;
        return bPct - aPct;
      })
      .slice(0, 4 - unlocked.length);
    return [...unlocked, ...locked];
  }, [achievements]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.client.community">
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      {/* Header V2 */}
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: theme.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 24, color: theme.text1, letterSpacing: -0.3 }}>Comunidade</Text>
          <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 11, color: theme.text3, marginTop: 2 }}>evolua, conecte-se e inspire</Text>
        </View>
        <TouchableOpacity
          onPress={() => { setSearchQuery(""); setSearchResults([]); setShowFollowModal(true); }}
          accessibilityRole="button"
          accessibilityLabel="Seguir um amigo"
          style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, borderRadius: S.chipR, paddingHorizontal: 12, paddingVertical: 8, minHeight: S.touchMin }}
        >
          <Ionicons name="person-add-outline" size={15} color={theme.primary} />
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: theme.primary }}>Seguir</Text>
        </TouchableOpacity>
      </View>

      <ScreenEntrance>
      {/* ScrollView único — sem scroll aninhado (regra V2) */}
      <ScrollView
        ref={feedScrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 120, paddingTop: 16 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        scrollEventThrottle={400}
        onScroll={(e) => {
          const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
          const distanceFromBottom = contentSize.height - (layoutMeasurement.height + contentOffset.y);
          if (distanceFromBottom < 300 && !feedLoadingMore && feedHasMore && !feedLoading) {
            void loadMoreFeed();
          }
          setShowScrollTop(contentOffset.y > 300);
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
      >
        {/* ── Bloco 1: Seu resumo ──────────────────────────────────────── */}
        <View style={{ paddingHorizontal: S.px }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 18, color: theme.text1, letterSpacing: -0.03 * 18 }}>Meu progresso</Text>
            <ScopeSwitch value={scope} onChange={setScope} />
          </View>

          {/* Progress cards — 3 colunas */}
          {feedLoading ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={{ flex: 1, borderRadius: 20, padding: 12, backgroundColor: theme.cardBg, borderWidth: 1, borderColor: theme.border }}>
                  <View style={{ height: 10, width: "50%", borderRadius: 6, backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)", marginBottom: 8 }} />
                  <View style={{ height: 24, width: "70%", borderRadius: 8, backgroundColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.10)" }} />
                  <View style={{ height: 8, width: "60%", borderRadius: 6, backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", marginTop: 6 }} />
                  <View style={{ marginTop: 10, height: 4, borderRadius: 99, backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)" }} />
                </View>
              ))}
            </View>
          ) : (
            <View style={{ flexDirection: "row", gap: 8 }}>
              {/* Meta — clicável para editar */}
              <TouchableOpacity
                onPress={() => setShowGoalModal(true)}
                activeOpacity={0.75}
                style={{ flex: 1, borderRadius: 20, padding: 12, backgroundColor: theme.cardBg, borderWidth: 1, borderColor: theme.primarySubtleBorder }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text2 }}>Meta</Text>
                  <Ionicons name="create-outline" size={13} color={theme.primary} />
                </View>
                <AnimatedNumber value={parseFloat(d.meta.split("/")[0] ?? d.meta)} duration={600} style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 22, color: theme.text1, letterSpacing: -0.05 * 22, marginTop: 5 }} suffix={d.meta.includes("/") ? `/${d.meta.split("/")[1]}` : ""} />
                <Text style={{ fontSize: 10, color: theme.text3, marginTop: 2 }}>{d.metaLabel}</Text>
                {/* Indicadores visuais: tiles (semanal), dots (mensal) ou barra (geral) */}
                {scope === "Semana" ? (
                  weeklyGoalTarget <= 5 ? (
                    /* ≤ 5 metas: tiles com checkmark */
                    <View style={{ marginTop: 10, flexDirection: "row", gap: 4 }}>
                      {Array.from({ length: weeklyGoalTarget }, (_, i) => {
                        const done = i < Math.min(weeklyCompleted, weeklyGoalTarget);
                        return (
                          <View key={i} style={{
                            flex: 1, height: 20, borderRadius: 6,
                            backgroundColor: done ? theme.primary + "22" : "rgba(255,255,255,0.05)",
                            borderWidth: 1, borderColor: done ? theme.primary + "55" : "rgba(255,255,255,0.10)",
                            alignItems: "center", justifyContent: "center",
                          }}>
                            {done
                              ? <Ionicons name="checkmark" size={10} color={theme.primary} />
                              : <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.20)" }} />}
                          </View>
                        );
                      })}
                    </View>
                  ) : (
                    /* 6–7 metas: barras coloridas compactas */
                    <View style={{ marginTop: 10, flexDirection: "row", gap: 3 }}>
                      {Array.from({ length: weeklyGoalTarget }, (_, i) => (
                        <View key={i} style={{
                          flex: 1, height: 10, borderRadius: 3,
                          backgroundColor: i < Math.min(weeklyCompleted, weeklyGoalTarget) ? theme.primary : "rgba(255,255,255,0.09)",
                        }} />
                      ))}
                    </View>
                  )
                ) : scope === "Mês" ? (
                  /* Dots flexíveis para qualquer meta mensal */
                  <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 3 }}>
                    {Array.from({ length: monthlyGoalTarget }, (_, i) => (
                      <View key={i} style={{
                        width: 7, height: 7, borderRadius: 2,
                        backgroundColor: i < Math.min(monthlyCompleted, monthlyGoalTarget) ? theme.primary : "rgba(255,255,255,0.09)",
                      }} />
                    ))}
                  </View>
                ) : (
                  /* Geral/anual: barra de progresso */
                  <View style={{ marginTop: 10, height: 4, borderRadius: 99, backgroundColor: "rgba(255,255,255,0.1)" }}>
                    <View style={{ height: "100%", width: `${d.pct}%`, borderRadius: 99, backgroundColor: theme.primary }} />
                  </View>
                )}
              </TouchableOpacity>

              {/* Sequência */}
              <View style={{ flex: 1, borderRadius: 20, padding: 12, backgroundColor: theme.cardBg, borderWidth: 1, borderColor: C.amberBorder }}>
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text2 }}>Sequência</Text>
                <AnimatedNumber value={d.streak} duration={600} style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 22, color: theme.text1, letterSpacing: -0.05 * 22, marginTop: 5 }} />
                <Text style={{ fontSize: 10, color: theme.text3, marginTop: 2 }}>dias seguidos</Text>
                {/* Chamas de sequência: 7 milestones, intensidade cresce com o streak */}
                <View style={{ marginTop: 10, flexDirection: "row", alignItems: "flex-end", gap: 2 }}>
                  {STREAK_MILESTONES.map(({ threshold, sz, color }, i) => {
                    const lit = d.streak >= threshold;
                    return (
                      <View key={i} style={{ opacity: lit ? 1 : 0.25 }}>
                        <Ionicons
                          name={lit ? "flame" : "flame-outline"}
                          size={lit ? sz : 9}
                          color={lit ? color : C.amber}
                        />
                      </View>
                    );
                  })}
                </View>
              </View>

              {/* Nível / Pontos */}
              <View style={{ flex: 1, borderRadius: 20, padding: 12, backgroundColor: theme.cardBg, borderWidth: 1, borderColor: C.skyBorder }}>
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text2 }}>Nível</Text>
                <AnimatedNumber value={d.lvl} duration={600} style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 22, color: C.sky, letterSpacing: -0.05 * 22, marginTop: 5 }} />
                <AnimatedNumber value={d.pts} duration={800} style={{ fontSize: 10, color: theme.text3, marginTop: 2 }} suffix=" pts" />
                {/* Pips de nível: 5 relâmpagos, crescem em tamanho conforme o nível sobe */}
                <View style={{ marginTop: 10, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
                  <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 3 }}>
                    {LEVEL_MILESTONES.map(({ threshold, sz }, i) => {
                      const lit = d.lvl >= threshold;
                      return (
                        <View key={i} style={{ opacity: lit ? 1 : 0.22 }}>
                          <Ionicons
                            name={lit ? "flash" : "flash-outline"}
                            size={lit ? sz : 8}
                            color={C.sky}
                          />
                        </View>
                      );
                    })}
                  </View>
                  {gamificationData?.weeklyXp != null && gamificationData.weeklyXp > 0 && (
                    <Text style={{ fontSize: 9, color: C.sky, fontFamily: "DMSans_700Bold" }}>+{gamificationData.weeklyXp} xp</Text>
                  )}
                </View>
              </View>
            </View>
          )}

          {/* Ranking snapshot + Conquistas snapshot */}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            {/* Ranking snapshot */}
            <TouchableOpacity
              onPress={() => setShowRankingModal(true)}
              activeOpacity={0.85}
              style={{ flex: 1, borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: 12, gap: 6 }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <Ionicons name="trophy" size={13} color={C.amber} />
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1 }}>Ranking</Text>
                </View>
                <View style={{ flexDirection: "row", backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 99, padding: 2, gap: 2 }}>
                  {([["WEEKLY", "S"], ["MONTHLY", "M"], ["ALLTIME", "G"]] as [RankingPeriod, string][]).map(([key, label]) => {
                    const active = rankingPeriod === key;
                    return (
                      <TouchableOpacity
                        key={key}
                        onPress={(e) => { e.stopPropagation(); setRankingPeriod(key); }}
                        style={{ paddingHorizontal: 6, height: 20, borderRadius: 99, backgroundColor: active ? theme.primarySubtle : "transparent", borderWidth: active ? 1 : 0, borderColor: theme.primarySubtleBorder, justifyContent: "center" }}
                      >
                        <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 9, color: active ? theme.primary : theme.text3 }}>{label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {rankingLoading ? (
                <View style={{ gap: 5 }}>
                  {[1, 2, 3].map((i) => (
                    <View key={i} style={{ height: 22, borderRadius: 6, backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)" }} />
                  ))}
                </View>
              ) : rankingItems.length === 0 && !rankingTransitioning ? (
                <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 10, gap: 4 }}>
                  <Ionicons name="people-outline" size={22} color={theme.labelColor} />
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 10, color: theme.text3, textAlign: "center" }}>Siga amigos para aparecer no ranking</Text>
                </View>
              ) : (
                <View style={{ gap: 5, opacity: rankingTransitioning ? 0.45 : 1 }}>
                  {rankingItems.slice(0, 3).map((entry) => {
                    const medalColor = entry.position === 1 ? C.amber : entry.position === 2 ? C.zinc300 : entry.position === 3 ? "#cd7f32" : null;
                    return (
                      <View key={entry.userId} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                        <View style={{ width: 18, alignItems: "center" }}>
                          {medalColor
                            ? <Ionicons name="trophy" size={10} color={medalColor} />
                            : <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 9, color: theme.text3 }}>#{entry.position}</Text>}
                        </View>
                        <MvAvatar
                          initials={(entry.name ?? entry.apelido ?? "?").slice(0, 2).toUpperCase()}
                          photoUri={entry.photoUrl ?? null}
                          tone="green"
                          size={28}
                        />
                        <Text style={{ flex: 1, fontFamily: "DMSans_700Bold", fontSize: 11, color: entry.isViewer ? theme.primary : theme.text1 }} numberOfLines={1}>
                          {entry.isViewer ? "Você" : (entry.name?.split(" ")[0] ?? entry.apelido ?? "—")}
                        </Text>
                        <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 10, color: entry.isViewer ? theme.primary : theme.text2 }}>
                          {entry.xpEarned >= 1000 ? `${(entry.xpEarned / 1000).toFixed(1)}k` : String(entry.xpEarned)}
                        </Text>
                      </View>
                    );
                  })}
                  {viewerPosition !== null && viewerPosition > 3 && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingTop: 3, borderTopWidth: 1, borderTopColor: theme.border, marginTop: 1 }}>
                      <View style={{ width: 18, alignItems: "center" }}>
                        <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 9, color: theme.primary }}>#{viewerPosition}</Text>
                      </View>
                      <MvAvatar
                        initials={(user?.name ?? "?").slice(0, 2).toUpperCase()}
                        photoUri={user?.photoUrl ?? null}
                        tone="green"
                        size={28}
                      />
                      <Text style={{ flex: 1, fontFamily: "DMSans_700Bold", fontSize: 11, color: theme.primary }} numberOfLines={1}>Você</Text>
                      <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 10, color: theme.primary }}>
                        {viewerXp >= 1000 ? `${(viewerXp / 1000).toFixed(1)}k` : String(viewerXp)}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: theme.primary, marginTop: 4 }}>Ver completo ›</Text>
            </TouchableOpacity>

            {/* Conquistas snapshot */}
            <TouchableOpacity
              onPress={() => setShowAllAchievements(true)}
              activeOpacity={0.85}
              style={{ flex: 1, borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: 12, gap: 6 }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Ionicons name="ribbon" size={13} color={theme.primary} />
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text1 }}>Conquistas</Text>
              </View>

              {feedLoading ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {[1, 2, 3, 4].map((i) => (
                    <View key={i} style={{ width: "45%", height: 40, borderRadius: 12, backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)" }} />
                  ))}
                </View>
              ) : (
                <>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                    {snapshotAchievements.map((ach) => (
                      <AchievementBadgeSvg
                        key={ach.id}
                        tier={ach.tier}
                        icon={ach.icon}
                        category={ach.category}
                        size={52}
                        unlocked={ach.unlocked}
                      />
                    ))}
                  </View>
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 10, color: theme.text3, textAlign: "center" }}>
                    {achievements.filter((a) => a.unlocked).length}/{achievements.length} desbloqueadas
                  </Text>
                </>
              )}

              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: theme.primary, marginTop: 4 }}>Ver todas ›</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Bloco 2: Comunidade ──────────────────────────────────────── */}

        {/* Pessoas para seguir */}
        {suggestions.length > 0 && (
          <View style={{ marginTop: S.gap }}>
            <View style={{ paddingHorizontal: S.px, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 18, color: theme.text1, letterSpacing: -0.03 * 18 }}>Pessoas para seguir</Text>
              <TouchableOpacity
                onPress={() => { setSearchQuery(""); setSearchResults([]); setShowFollowModal(true); }}
                hitSlop={8}
              >
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.primary }}>Ver mais ›</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: S.px, gap: 10 }}
            >
              {suggestions.map((u) => {
                const isFollowing = followingIds.has(u.id);
                return (
                  <View
                    key={u.id}
                    style={{ width: 120, alignItems: "center", gap: 8, borderRadius: S.cardR, backgroundColor: theme.cardBg, borderWidth: 1, borderColor: isFollowing ? theme.primarySubtleBorder : theme.border, padding: 12 }}
                  >
                    <MvAvatar
                      initials={(u.name ?? "?").slice(0, 2).toUpperCase()}
                      photoUri={u.photoUrl ?? null}
                      tone="green"
                      size="sm"
                    />
                    <View style={{ alignItems: "center", gap: 2, width: "100%" }}>
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: theme.text1, textAlign: "center" }} numberOfLines={1}>
                        {u.name}
                      </Text>
                      {u.apelido ? (
                        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 10, color: theme.text3, textAlign: "center" }} numberOfLines={1}>
                          @{u.apelido}
                        </Text>
                      ) : null}
                    </View>
                    <TouchableOpacity
                      onPress={() => void handleFollow(u.id)}
                      style={{ height: 28, width: "100%", borderRadius: S.chipR, backgroundColor: isFollowing ? "rgba(255,255,255,0.06)" : theme.primary, borderWidth: 1, borderColor: isFollowing ? theme.border : "transparent", alignItems: "center", justifyContent: "center" }}
                    >
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: isFollowing ? theme.text2 : theme.textOnPrimary }}>
                        {isFollowing ? "Seguindo" : "Seguir"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Sugestões vazias — só mostra quando já carregou e não tem ninguém */}
        {!feedLoading && suggestions.length === 0 && feedItems.length === 0 && (
          <View style={{ paddingHorizontal: S.px, marginTop: S.gap }}>
            <TouchableOpacity
              onPress={() => { setSearchQuery(""); setSearchResults([]); setShowFollowModal(true); }}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: S.cardR, borderWidth: 1, borderColor: theme.primarySubtleBorder, backgroundColor: theme.primarySubtle }}
            >
              <Ionicons name="person-add-outline" size={22} color={theme.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.primary }}>Descubra pessoas para seguir</Text>
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3, marginTop: 2 }}>Encontre amigos e acompanhe a evolução deles</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.primary} />
            </TouchableOpacity>
          </View>
        )}

        {/* Feed de evolução */}
        <View style={{ paddingHorizontal: S.px, marginTop: S.gap }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 18, color: theme.text1, letterSpacing: -0.03 * 18 }}>Feed de evolução</Text>
            <TouchableOpacity
              onPress={() => navigation.getParent<any>()?.navigate("FriendsList")}
              hitSlop={8}
            >
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.primary }}>Ver amigos ›</Text>
            </TouchableOpacity>
          </View>

          {/* Banner: novos posts detectados em background */}
          {pendingFeedItems.length > 0 && !feedLoading && (
            <TouchableOpacity
              onPress={() => {
                setFeedItems(pendingFeedItems);
                setFeedPage(1);
                setFeedHasMore(pendingFeedItems.length === 20);
                setPendingFeedItems([]);
                feedScrollRef.current?.scrollTo({ y: 0, animated: true });
              }}
              style={{
                flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
                backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder,
                borderRadius: 99, paddingVertical: 8, paddingHorizontal: 16, marginBottom: 10, alignSelf: "center",
              }}
            >
              <Ionicons name="arrow-up-circle" size={15} color={theme.primary} />
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: theme.primary }}>
                {pendingFeedItems.length} novo{pendingFeedItems.length !== 1 ? "s" : ""} post{pendingFeedItems.length !== 1 ? "s" : ""} · toque para ver
              </Text>
            </TouchableOpacity>
          )}

          {feedLoading ? (
            <View style={{ gap: 10 }}>
              {[1, 2].map((i) => (
                <View key={i} style={{ height: 90, borderRadius: S.cardR, backgroundColor: theme.cardBg, borderWidth: 1, borderColor: theme.border }} />
              ))}
            </View>
          ) : feedItems.length === 0 ? (
            <View style={{ padding: 28, alignItems: "center", gap: 12, borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg }}>
              <View style={{ width: 64, height: 64, borderRadius: 22, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="people-outline" size={32} color={theme.primary} />
              </View>
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1, textAlign: "center" }}>
                Sem posts ainda
              </Text>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3, textAlign: "center", lineHeight: 19 }}>
                Siga amigos e os posts de evolução deles vão aparecer aqui. Você também pode publicar o seu!
              </Text>
              <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
                <TouchableOpacity
                  onPress={() => { setSearchQuery(""); setSearchResults([]); setShowFollowModal(true); }}
                  style={{ height: 38, paddingHorizontal: 16, borderRadius: 99, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center" }}
                >
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: "#fff" }}>Seguir alguém</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { setCreateCaption(""); setShowCreatePost(true); }}
                  style={{ height: 38, paddingHorizontal: 16, borderRadius: 99, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center" }}
                >
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.primary }}>Criar post</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View
              style={{ gap: 10 }}
              onLayout={(e) => { feedContainerYRef.current = e.nativeEvent.layout.y; }}
            >
              {feedItems.map((post) => (
                <View
                  key={post.id}
                  onLayout={(e) => { postYOffsetsRef.current[post.id] = e.nativeEvent.layout.y; }}
                >
                  <FeedPostCard
                    post={post}
                    runWithAuth={runWithAuth}
                    showToast={showToast}
                    viewerId={user?.id ?? ""}
                    onNavigateToProvider={(id) =>
                      navigation.getParent<any>()?.navigate("ProfessionalDetail", { professionalId: id })
                    }
                    onNavigateToProfile={openUserProfile}
                    onCommentFocus={() => {
                      const y = feedContainerYRef.current + (postYOffsetsRef.current[post.id] ?? 0);
                      setTimeout(() => feedScrollRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: true }), 120);
                    }}
                    onDeletePost={(postId) => {
                      setFeedItems((prev) => prev.filter((p) => p.id !== postId));
                    }}
                  />
                </View>
              ))}
            </View>
          )}
          {feedLoadingMore && (
            <View style={{ paddingVertical: 20, alignItems: "center" }}>
              <ActivityIndicator size="small" color={theme.primary} />
            </View>
          )}
        </View>
      </ScrollView>
      </ScreenEntrance>

      <ClientBottomNavV2
        activeTab="community"
        badges={{ community: pendingFeedItems.length }}
        onNavigate={(tab) => {
          if (tab === "home") navigation.navigate("ClientHome");
          if (tab === "agenda") navigation.navigate("ClientBookings");
          if (tab === "trainings") navigation.navigate("MyTraining");
          if (tab === "profile") navigation.navigate("ClientProfile");
        }}
      />

      {/* ── Botão voltar ao topo ────────────────────────────────────── */}
      {showScrollTop && (
        <TouchableOpacity
          onPress={() => feedScrollRef.current?.scrollTo({ y: 0, animated: true })}
          accessibilityRole="button"
          accessibilityLabel="Voltar ao topo"
          style={{
            position: "absolute",
            right: 20,
            bottom: insets.bottom + 132,
            width: 40, height: 40, borderRadius: 20,
            backgroundColor: theme.cardBg, borderWidth: 1, borderColor: theme.border,
            alignItems: "center", justifyContent: "center",
            shadowColor: "#000", shadowOpacity: 0.2, shadowOffset: { width: 0, height: 2 }, shadowRadius: 4,
            elevation: 4,
          }}
        >
          <Ionicons name="arrow-up" size={18} color={theme.text2} />
        </TouchableOpacity>
      )}

      {/* ── FAB — Criar post ──────────────────────────────────────────── */}
      <TouchableOpacity
        onPress={() => { setCreateCaption(""); setShowCreatePost(true); }}
        accessibilityRole="button"
        accessibilityLabel="Criar post"
        style={{
          position: "absolute",
          right: 20,
          bottom: insets.bottom + 72,
          width: 52, height: 52, borderRadius: 26,
          backgroundColor: theme.primary,
          alignItems: "center", justifyContent: "center",
          shadowColor: "#000", shadowOpacity: 0.3, shadowOffset: { width: 0, height: 4 }, shadowRadius: 8,
          elevation: 8,
        }}
      >
        <Ionicons name="add" size={26} color="#fff" />
      </TouchableOpacity>

      {/* ── Modal de criação de post ─────────────────────────────────── */}
      <Modal
        visible={showCreatePost}
        transparent
        animationType="slide"
        onRequestClose={closeCreatePost}
        statusBarTranslucent
      >
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" }} onPress={closeCreatePost}>
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={{
                backgroundColor: theme.inputBg,
                borderTopLeftRadius: 24, borderTopRightRadius: 24,
                paddingBottom: insets.bottom + 16,
                maxHeight: Dimensions.get("window").height * 0.88,
              }}
            >
              {/* Drag handle */}
              <View style={{ width: 36, height: 4, borderRadius: 99, backgroundColor: theme.border, alignSelf: "center", marginTop: 12, marginBottom: 16 }} />

              {/* Header com avatar + saudação + fechar */}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, marginBottom: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                  <MvAvatar
                    initials={(user?.name ?? "?").slice(0, 2).toUpperCase()}
                    photoUri={user?.photoUrl ?? null}
                    tone="green"
                    size="sm"
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 16, color: theme.text1, letterSpacing: -0.3 }}>
                      {user?.name?.split(" ")[0] ? `Oi, ${user.name.split(" ")[0]}!` : "Compartilhe!"}
                    </Text>
                    <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3 }} numberOfLines={1}>
                      o que você quer compartilhar com a galera?
                    </Text>
                  </View>
                </View>
                <TouchableOpacity onPress={closeCreatePost} hitSlop={12} disabled={createSubmitting}>
                  <Ionicons name="close" size={22} color={theme.text3} />
                </TouchableOpacity>
              </View>

              {/* Área rolável: campo de texto + preview da foto */}
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
                style={{ flexGrow: 0 }}
              >
                <TextInput
                  value={createCaption}
                  onChangeText={setCreateCaption}
                  placeholder="Conta pra galera! Como foi o treino hoje?"
                  placeholderTextColor={theme.text3}
                  multiline
                  maxLength={300}
                  autoFocus
                  style={{
                    fontFamily: "DMSans_400Regular",
                    fontSize: 15,
                    color: theme.text1,
                    lineHeight: 22,
                    minHeight: createPhotoUri ? 50 : 80,
                    maxHeight: createPhotoUri ? 80 : 140,
                    paddingTop: 0,
                  }}
                />

                {/* Preview da foto selecionada — altura fixa para não transbordar */}
                {createPhotoUri && (
                  <View style={{ borderRadius: 12, overflow: "hidden", height: 130 }}>
                    <Image source={{ uri: createPhotoUri }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                    <TouchableOpacity
                      onPress={() => { setCreatePhotoUri(null); setCreatePhotoData(null); }}
                      style={{ position: "absolute", top: 8, right: 8, width: 28, height: 28, borderRadius: 99, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" }}
                    >
                      <Ionicons name="close" size={16} color="#fff" />
                    </TouchableOpacity>
                  </View>
                )}
              </ScrollView>

              {/* Divisor */}
              <View style={{ height: 1, backgroundColor: theme.border, marginTop: 12, marginBottom: 12 }} />

              {/* Footer: botão de foto + contador + publicar */}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20 }}>
                <TouchableOpacity
                  onPress={() => void pickCreatePhoto()}
                  disabled={createSubmitting}
                  hitSlop={8}
                  style={{
                    flexDirection: "row", alignItems: "center", gap: 6,
                    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99,
                    borderWidth: 1,
                    borderColor: createPhotoUri ? theme.primary : theme.border,
                    backgroundColor: createPhotoUri ? theme.primarySubtle : "transparent",
                  }}
                >
                  <Ionicons name="camera-outline" size={17} color={createPhotoUri ? theme.primary : theme.text3} />
                  <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 12, color: createPhotoUri ? theme.primary : theme.text3 }}>
                    {createPhotoUri ? "Foto adicionada" : "Adicionar foto"}
                  </Text>
                </TouchableOpacity>

                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3 }}>
                    {createCaption.length}/300
                  </Text>
                  <TouchableOpacity
                    onPress={() => void submitCreatePost()}
                    disabled={!createCaption.trim() || createSubmitting}
                    style={{
                      height: 40, paddingHorizontal: 20, borderRadius: 99,
                      backgroundColor: createCaption.trim() ? theme.primary : (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"),
                      alignItems: "center", justifyContent: "center",
                      flexDirection: "row", gap: 6,
                    }}
                  >
                    {createSubmitting
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Ionicons name="paper-plane" size={15} color={createCaption.trim() ? "#fff" : theme.text3} />
                    }
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: createCaption.trim() ? "#fff" : theme.text3 }}>
                      {createSubmitting ? "Publicando..." : "Publicar"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Modal: Todas as Conquistas ──────────────────────────────── */}
      <Modal
        visible={showAllAchievements}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAllAchievements(false)}
        statusBarTranslucent
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" }}
          onPress={() => setShowAllAchievements(false)}
        >
          <Pressable onPress={(e) => e.stopPropagation()} style={{
            backgroundColor: theme.inputBg,
            borderTopLeftRadius: 28, borderTopRightRadius: 28,
            paddingBottom: insets.bottom + 24,
            maxHeight: "85%",
          }}>
            {/* Drag handle */}
            <View style={{ width: 36, height: 4, borderRadius: 99, backgroundColor: theme.border, alignSelf: "center", marginTop: 12, marginBottom: 8 }} />
            <View style={{ paddingHorizontal: 24, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border }}>
              <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 22, color: theme.text1, letterSpacing: -0.3 }}>Conquistas</Text>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3, marginTop: 2 }}>
                {achievements.filter((a) => a.unlocked).length}/{achievements.length} desbloqueadas
              </Text>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 24, gap: 12 }}>
              {(() => {
                const grouped = CATEGORY_ORDER
                  .map((cat) => ({ label: CATEGORY_LABELS[cat] ?? cat, items: achievements.filter((a) => a.category === cat) }))
                  .filter((g) => g.items.length > 0);

                const renderRow = (ach: Achievement) => {
                  const { color: accentColor, dim: accentDim, border: accentBorder } = achAccentColors(ach.tier, theme);
                  const pct = ach.progress
                    ? Math.min(100, Math.round((ach.progress.current / ach.progress.target) * 100))
                    : 0;
                  return (
                    <TouchableOpacity
                      key={ach.id}
                      onPress={() => {
                        if (!ach.unlocked) return;
                        setShowAllAchievements(false);
                        setTimeout(() => { void hapticAchievement(); setCelebratingAchievement(ach); }, 300);
                      }}
                      activeOpacity={ach.unlocked ? 0.7 : 1}
                      style={{
                        flexDirection: "row", alignItems: "center", gap: 14,
                        padding: 14, borderRadius: 16,
                        backgroundColor: ach.unlocked ? accentDim : (isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)"),
                        borderWidth: 1, borderColor: ach.unlocked ? accentBorder : theme.border,
                        opacity: ach.unlocked ? 1 : 0.6,
                      }}
                    >
                      <AchievementBadgeSvg
                        tier={ach.tier}
                        icon={ach.icon}
                        category={ach.category}
                        size={48}
                        unlocked={ach.unlocked}
                      />
                      <View style={{ flex: 1, gap: 4 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: ach.unlocked ? theme.text1 : theme.labelColor }} numberOfLines={1}>
                            {ach.label}
                          </Text>
                          {ach.unlocked ? (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: accentDim, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: accentBorder, flexShrink: 0 }}>
                              <Ionicons name="checkmark-circle" size={12} color={accentColor} />
                              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: accentColor }}>+{ach.points} XP</Text>
                            </View>
                          ) : (
                            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3, flexShrink: 0 }}>
                              {ach.progress ? `${ach.progress.current}/${ach.progress.target}` : ""}
                            </Text>
                          )}
                        </View>
                        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3, lineHeight: 17 }}>
                          {ach.requirement}
                        </Text>
                        {!ach.unlocked && ach.progress && (
                          <View style={{ height: 4, borderRadius: 99, backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)", marginTop: 2 }}>
                            <View style={{ height: "100%", width: `${pct}%`, borderRadius: 99, backgroundColor: accentColor, opacity: 0.7 }} />
                          </View>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                };

                if (grouped.length > 0) {
                  return grouped.map(({ label, items }) => (
                    <View key={label} style={{ gap: 8 }}>
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: theme.text3, textTransform: "uppercase", letterSpacing: 0.8, marginTop: 4 }}>
                        {label}
                      </Text>
                      {items.map(renderRow)}
                    </View>
                  ));
                }
                return achievements.map(renderRow);
              })()}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Banner de boas-vindas à Comunidade ──────────────────────────── */}
      <Modal
        animationType="fade"
        transparent
        visible={showWelcomeBanner}
        onRequestClose={() => void dismissWelcomeBanner()}
        statusBarTranslucent
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.88)", alignItems: "center", justifyContent: "center", padding: 24 }}
          onPress={() => void dismissWelcomeBanner()}
        >
          <Pressable onPress={(e) => e.stopPropagation()} style={{
            width: "100%", maxWidth: 360,
            backgroundColor: theme.inputBg, borderRadius: 28, padding: 28,
            alignItems: "center", gap: 16,
            borderWidth: 1, borderColor: theme.primarySubtleBorder,
            shadowColor: theme.primary, shadowOpacity: 0.35, shadowRadius: 40, elevation: 14,
          }}>
            {/* Ícone central */}
            <View style={{ width: 72, height: 72, borderRadius: 24, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="people" size={36} color={theme.primary} />
            </View>

            {/* Título */}
            <View style={{ alignItems: "center", gap: 6 }}>
              <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 24, color: theme.text1, letterSpacing: -0.3, textAlign: "center" }}>
                Bem-vindo à Comunidade!
              </Text>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 14, color: theme.text2, textAlign: "center", lineHeight: 22 }}>
                Olá,{" "}
                <Text style={{ fontFamily: "DMSans_700Bold", color: theme.primary }}>
                  @{user?.apelido ?? user?.name ?? "você"}
                </Text>
                ! Aqui você evolui junto com seus amigos.
              </Text>
            </View>

            {/* Feature list */}
            <View style={{ width: "100%", gap: 10 }}>
              {([
                { icon: "person-add-outline" as const,  text: "Siga amigos e seja seguido de volta" },
                { icon: "trophy-outline" as const,       text: "Dispute o ranking de XP dos amigos" },
                { icon: "flame-outline" as const,        text: "Acompanhe o feed de evolução da turma" },
                { icon: "heart-outline" as const,        text: "Curta e comente as conquistas" },
                { icon: "medal-outline" as const,        text: "Desbloqueie conquistas e suba de nível" },
              ]).map(({ icon, text }) => (
                <View key={text} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Ionicons name={icon} size={16} color={theme.primary} />
                  </View>
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: C.zinc300, lineHeight: 20, flex: 1 }}>{text}</Text>
                </View>
              ))}
            </View>

            {/* CTA */}
            <TouchableOpacity
              onPress={() => void dismissWelcomeBanner()}
              style={{ height: S.btnH, borderRadius: S.btnR, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", width: "100%", marginTop: 4, shadowColor: theme.primary, shadowOpacity: 0.3, shadowRadius: 12, elevation: 5 }}
            >
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.textOnPrimary }}>Quero conhecer!</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Modal de celebração de conquista ─────────────────────────── */}
      <Modal
        animationType="fade"
        transparent
        visible={celebratingAchievement !== null}
        onRequestClose={() => setCelebratingAchievement(null)}
        statusBarTranslucent
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.85)", alignItems: "center", justifyContent: "center", padding: 24 }}
          onPress={() => setCelebratingAchievement(null)}
        >
          <Pressable onPress={(e) => e.stopPropagation()} style={{
            width: "100%", maxWidth: 350,
            backgroundColor: theme.inputBg, borderRadius: 28, padding: 28,
            alignItems: "center", gap: 12,
            borderWidth: 1, borderColor: theme.primarySubtleBorder,
            shadowColor: theme.primary, shadowOpacity: 0.4, shadowRadius: 40, elevation: 12,
          }}>
            {celebratingAchievement && (
              <>
                <View style={{ width: 72, height: 72, borderRadius: 24, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name={celebratingAchievement.icon as any} size={36} color={theme.primary} />
                </View>
                <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 26, color: theme.text1, letterSpacing: -0.02 * 26, textAlign: "center" }}>
                  Conquista desbloqueada!
                </Text>
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, textAlign: "center", lineHeight: 20 }}>
                  {celebratingAchievement.label} — {celebratingAchievement.description}. Continue assim!
                </Text>
                <View style={{ flexDirection: "row", gap: 8, justifyContent: "center" }}>
                  <View style={{ backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, borderRadius: S.chipR, paddingHorizontal: 12, paddingVertical: 4 }}>
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: theme.primary }}>+{celebratingAchievement.points} pts</Text>
                  </View>
                  <View style={{ backgroundColor: C.amberDim, borderWidth: 1, borderColor: C.amberBorder, borderRadius: S.chipR, paddingHorizontal: 12, paddingVertical: 4 }}>
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: C.amber }}>Medalha {celebratingAchievement.tier}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => setCelebratingAchievement(null)}
                  style={{ height: S.btnH, borderRadius: S.btnR, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", width: "100%", marginTop: 8, shadowColor: theme.primary, shadowOpacity: 0.28, shadowRadius: 10, elevation: 4 }}
                >
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.textOnPrimary }}>Incrível!</Text>
                </TouchableOpacity>
              </>
            )}
          </Pressable>
        </Pressable>

        {/* Confetti — dispara ao abrir o modal */}
        <ConfettiCannon
          ref={confettiRef}
          count={120}
          origin={{ x: Dimensions.get("window").width / 2, y: 0 }}
          colors={[theme.primary, C.amber, C.sky, theme.text1]}
          fadeOut
          autoStart={false}
          explosionSpeed={350}
          fallSpeed={3000}
        />
      </Modal>

      {/* ── Modal de busca para seguir amigos ──────────────────────────────── */}
      <Modal
        visible={showFollowModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowFollowModal(false)}
        statusBarTranslucent
        onShow={() => {
          setTimeout(() => searchInputRef.current?.focus(), 50);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}
          onPress={() => setShowFollowModal(false)}
        >
          <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: theme.cardBg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: Math.max(24, insets.bottom + 16), paddingTop: 20, borderTopWidth: 1, borderColor: theme.border, maxHeight: Dimensions.get("window").height * 0.85 }}>
            {/* Handle + título */}
            <View style={{ alignItems: "center", marginBottom: 16, paddingHorizontal: S.px }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border, marginBottom: 14 }} />
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 20, color: theme.text1, letterSpacing: -0.02 * 20 }}>Seguir um amigo</Text>
                <TouchableOpacity onPress={() => setShowFollowModal(false)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="close" size={16} color={theme.text1} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Campo de busca */}
            <View style={{ paddingHorizontal: S.px, marginBottom: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", height: S.btnH, borderRadius: S.btnR, borderWidth: 1, borderColor: theme.borderMid, backgroundColor: theme.inputBg, paddingHorizontal: 14, gap: 8 }}>
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.primary }}>@</Text>
                <TextInput
                  ref={searchInputRef}
                  value={searchQuery}
                  onChangeText={(t) => setSearchQuery(t.replace(/^@/, ""))}
                  placeholder="apelido ou nome do amigo"
                  placeholderTextColor={theme.text3}
                  selectionColor={theme.primary}
                  autoCapitalize="none"
                  style={{ flex: 1, fontFamily: "DMSans_400Regular", fontSize: 14, color: theme.text1 }}
                />
                {searchLoading && <ActivityIndicator size="small" color={theme.primary} />}
              </View>
            </View>

            {/* Resultados */}
            <ScrollView contentContainerStyle={{ paddingHorizontal: S.px, gap: 8, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
              {searchQuery.trim().length < 2 ? (
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3, textAlign: "center", paddingVertical: 20 }}>
                  Digite pelo menos 2 caracteres para buscar
                </Text>
              ) : !searchLoading && searchResults.length === 0 ? (
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3, textAlign: "center", paddingVertical: 20 }}>
                  Nenhum usuário encontrado para "@{searchQuery}"
                </Text>
              ) : (
                searchResults.map((u) => {
                  const isFollowing = followingIds.has(u.id);
                  const isMe = u.id === user?.id;
                  return (
                    <TouchableOpacity
                      key={u.id}
                      onPress={() => void openUserProfile(u.id)}
                      style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: theme.inputBg, borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, padding: 12, minHeight: S.touchMin }}
                    >
                      <MvAvatar initials={(u.name ?? "?").slice(0, 2).toUpperCase()} photoUri={u.photoUrl ?? null} tone="green" size="sm" />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }} numberOfLines={1}>{u.name}</Text>
                        {u.apelido && <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3 }}>@{u.apelido}</Text>}
                      </View>
                      {!isMe && (
                        <TouchableOpacity
                          onPress={() => void handleFollow(u.id)}
                          style={{ height: 32, paddingHorizontal: 14, borderRadius: S.chipR, backgroundColor: isFollowing ? "rgba(255,255,255,0.06)" : theme.primary, borderWidth: 1, borderColor: isFollowing ? theme.border : "transparent", alignItems: "center", justifyContent: "center" }}
                        >
                          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: isFollowing ? theme.text2 : theme.textOnPrimary }}>
                            {isFollowing ? "Seguindo" : "Seguir"}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Modal: Ranking completo ──────────────────────────────────────── */}
      <Modal
        visible={showRankingModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRankingModal(false)}
        statusBarTranslucent
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" }}
          onPress={() => setShowRankingModal(false)}
        >
          <Pressable onPress={(e) => e.stopPropagation()} style={{
            backgroundColor: theme.inputBg,
            borderTopLeftRadius: 28, borderTopRightRadius: 28,
            paddingBottom: insets.bottom + 24,
            maxHeight: "85%",
          }}>
            <View style={{ width: 36, height: 4, borderRadius: 99, backgroundColor: theme.border, alignSelf: "center", marginTop: 12, marginBottom: 8 }} />
            <View style={{ paddingHorizontal: 24, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="trophy" size={18} color={C.amber} />
                <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 22, color: theme.text1, letterSpacing: -0.3 }}>Ranking dos Amigos</Text>
              </View>
              <View style={{ flexDirection: "row", backgroundColor: "rgba(255,255,255,0.05)", borderRadius: S.chipR, padding: 3, gap: 2 }}>
                {([["WEEKLY", "Semana"], ["MONTHLY", "Mês"], ["ALLTIME", "Geral"]] as [RankingPeriod, string][]).map(([key, label]) => {
                  const active = rankingPeriod === key;
                  return (
                    <TouchableOpacity
                      key={key}
                      onPress={() => setRankingPeriod(key)}
                      style={{ paddingHorizontal: 10, height: 26, borderRadius: S.chipR, backgroundColor: active ? theme.primarySubtle : "transparent", borderWidth: active ? 1 : 0, borderColor: theme.primarySubtleBorder, justifyContent: "center" }}
                    >
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: active ? theme.primary : theme.text3 }}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            <View style={{ padding: 24 }}>
              {rankingLoading ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <View key={i} style={{ width: 80, height: 118, borderRadius: 14, backgroundColor: theme.cardBg, borderWidth: 1, borderColor: theme.border }} />
                  ))}
                </ScrollView>
              ) : rankingItems.length === 0 && !rankingTransitioning ? (
                <View style={{ padding: 24, alignItems: "center", gap: 8, borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg }}>
                  <Ionicons name="people-outline" size={28} color={theme.labelColor} />
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3, textAlign: "center" }}>
                    Siga amigos mutuamente para aparecer no ranking.
                  </Text>
                </View>
              ) : (
                <View style={{ opacity: rankingTransitioning ? 0.45 : 1 }} pointerEvents={rankingTransitioning ? "none" : "auto"}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
                    {rankingItems.map((entry) => {
                      const medalColor = entry.position === 1 ? C.amber : entry.position === 2 ? C.zinc300 : entry.position === 3 ? "#cd7f32" : null;
                      const isTop3 = entry.position <= 3;
                      return (
                        <View
                          key={entry.userId}
                          style={{
                            width: 82, alignItems: "center",
                            borderRadius: 14, borderWidth: 1,
                            borderColor: entry.isViewer ? theme.primarySubtleBorder : (medalColor ? `rgba(${entry.position === 1 ? "245,166,35" : entry.position === 2 ? "180,180,190" : "160,100,50"},0.30)` : theme.border),
                            backgroundColor: entry.isViewer ? theme.primarySubtle : theme.cardBg,
                            paddingVertical: 12, paddingHorizontal: 8, gap: 5,
                          }}
                        >
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                            {medalColor ? <Ionicons name="trophy" size={11} color={medalColor} /> : null}
                            <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 11, color: medalColor ?? theme.text3 }}>
                              {isTop3 ? "" : "#"}{entry.position}
                            </Text>
                          </View>
                          <MvAvatar
                            initials={(entry.name ?? entry.apelido ?? "?").slice(0, 2).toUpperCase()}
                            photoUri={entry.photoUrl ?? null}
                            tone="green"
                            size="sm"
                          />
                          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: entry.isViewer ? theme.primary : theme.text1, textAlign: "center" }} numberOfLines={1}>
                            {entry.isViewer ? "Você" : (entry.name?.split(" ")[0] ?? entry.apelido ?? "—")}
                          </Text>
                          <View style={{ alignItems: "center" }}>
                            <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 13, color: entry.isViewer ? theme.primary : theme.text1, letterSpacing: -0.5 }}>
                              {entry.xpEarned >= 1000 ? `${(entry.xpEarned / 1000).toFixed(1)}k` : entry.xpEarned.toLocaleString("pt-BR")}
                            </Text>
                            <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 9, color: theme.labelColor }}>XP</Text>
                          </View>
                        </View>
                      );
                    })}
                    {viewerPosition && viewerPosition > rankingItems.length && (
                      <View style={{ width: 82, alignItems: "center", borderRadius: 14, borderWidth: 1, borderColor: theme.primarySubtleBorder, backgroundColor: theme.primarySubtle, paddingVertical: 12, paddingHorizontal: 8, gap: 5 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 11, color: theme.primary }}>#{viewerPosition}</Text>
                        </View>
                        <MvAvatar
                          initials={(user?.name ?? "?").slice(0, 2).toUpperCase()}
                          photoUri={user?.photoUrl ?? null}
                          tone="green"
                          size="sm"
                        />
                        <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: theme.primary, textAlign: "center" }} numberOfLines={1}>Você</Text>
                        <View style={{ alignItems: "center" }}>
                          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 13, color: theme.primary, letterSpacing: -0.5 }}>
                            {viewerXp >= 1000 ? `${(viewerXp / 1000).toFixed(1)}k` : viewerXp.toLocaleString("pt-BR")}
                          </Text>
                          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 9, color: theme.labelColor }}>XP</Text>
                        </View>
                      </View>
                    )}
                  </ScrollView>
                </View>
              )}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Modal de perfil público do usuário ────────────────────────────── */}
      <Modal
        visible={profileUserId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setProfileUserId(null)}
        statusBarTranslucent
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.75)", alignItems: "center", justifyContent: "center", padding: 24 }}
          onPress={() => setProfileUserId(null)}
        >
          <Pressable onPress={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 360, backgroundColor: theme.cardBg, borderRadius: S.cardR, padding: 20, gap: 14, borderWidth: 1, borderColor: theme.border, maxHeight: "80%" as any }}>
            {/* Botão fechar */}
            <TouchableOpacity onPress={() => setProfileUserId(null)} style={{ position: "absolute", top: 14, right: 14, width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center", zIndex: 1 }}>
              <Ionicons name="close" size={15} color={theme.text1} />
            </TouchableOpacity>

            {profileLoading ? (
              <View style={{ paddingVertical: 40, alignItems: "center", gap: 12 }}>
                <ActivityIndicator size="large" color={theme.primary} />
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2 }}>Carregando perfil...</Text>
              </View>
            ) : profileData ? (
              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Hero do perfil */}
                <View style={{ alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <MvAvatar initials={(profileData.name ?? "?").slice(0, 2).toUpperCase()} photoUri={profileData.photoUrl ?? null} tone="green" size="lg" />
                  <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 20, color: theme.text1, letterSpacing: -0.02 * 20 }}>{profileData.name}</Text>
                  {profileData.apelido && <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3 }}>@{profileData.apelido}</Text>}
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <View style={{ backgroundColor: theme.primarySubtle, borderRadius: S.chipR, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: theme.primarySubtleBorder }}>
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: theme.primary }}>Nível {profileData.currentLevel}{profileData.levelName ? ` · ${profileData.levelName}` : ""}</Text>
                    </View>
                    {profileData.currentStreak > 0 && (
                      <View style={{ backgroundColor: C.amberDim, borderRadius: S.chipR, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: C.amberBorder }}>
                        <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: C.amber }}>{profileData.currentStreak} dias seguidos</Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Stats */}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                  {[
                    { label: "Seguidores", value: String(profileData.followerCount) },
                    { label: "Seguindo", value: String(profileData.followingCount) },
                    { label: "XP total", value: profileData.totalXp.toLocaleString("pt-BR") },
                  ].map((s) => (
                    <View key={s.label} style={{ flex: 1, backgroundColor: theme.inputBg, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 10, alignItems: "center", gap: 2 }}>
                      <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 16, color: theme.text1, letterSpacing: -0.013 * 16 }}>{s.value}</Text>
                      <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 10, color: theme.text3 }}>{s.label}</Text>
                    </View>
                  ))}
                </View>

                {/* Botão seguir */}
                {profileData.id !== user?.id && (
                  <TouchableOpacity
                    onPress={() => void handleFollow(profileData.id)}
                    style={{ height: S.btnH, borderRadius: S.btnR, marginTop: 14, backgroundColor: followingIds.has(profileData.id) ? "rgba(255,255,255,0.06)" : theme.primary, borderWidth: 1, borderColor: followingIds.has(profileData.id) ? theme.border : "transparent", alignItems: "center", justifyContent: "center", shadowColor: theme.primary, shadowOpacity: followingIds.has(profileData.id) ? 0 : 0.28, shadowRadius: 10, elevation: followingIds.has(profileData.id) ? 0 : 4 }}
                  >
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: followingIds.has(profileData.id) ? theme.text2 : theme.textOnPrimary }}>
                      {followingIds.has(profileData.id) ? "Deixar de seguir" : "Seguir"}
                    </Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Modal: Definir metas ─────────────────────────────────────────── */}
      <Modal
        visible={showGoalModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowGoalModal(false)}
        statusBarTranslucent
      >
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          {/* Fundo escuro absolutamente posicionado — não se move com o teclado */}
          <Pressable
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)" }}
            onPress={() => setShowGoalModal(false)}
          />
          {/* Painel sobe com o teclado sem arrastar o fundo */}
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: theme.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingBottom: insets.bottom + 28, paddingTop: 20 }}>
              <View style={{ width: 36, height: 4, borderRadius: 99, backgroundColor: theme.border, alignSelf: "center", marginBottom: 20 }} />

              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
                <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 20, color: theme.text1, letterSpacing: -0.3 }}>Metas de treino</Text>
                <TouchableOpacity
                  onPress={() => setShowGoalModal(false)}
                  style={{ width: 32, height: 32, borderRadius: 99, backgroundColor: "rgba(255,255,255,0.07)", alignItems: "center", justifyContent: "center" }}
                >
                  <Ionicons name="close" size={18} color={theme.text2} />
                </TouchableOpacity>
              </View>

              <GoalPickerRow
                label="Semana"
                value={weeklyGoalTarget}
                min={1}
                max={7}
                onChange={(v) => { setWeeklyGoalTarget(v); AsyncStorage.setItem("@goal_weekly", String(v)).catch(() => {}); }}
              />

              <GoalPickerRow
                label={new Date().toLocaleString("pt-BR", { month: "long" }).replace(/^\w/, (c) => c.toUpperCase())}
                value={monthlyGoalTarget}
                min={1}
                max={daysInCurrentMonth()}
                onChange={(v) => { setMonthlyGoalTarget(v); AsyncStorage.setItem("@goal_monthly", String(v)).catch(() => {}); }}
              />

              <GoalPickerRow
                label="Ano"
                value={annualGoalTarget}
                min={1}
                max={daysInCurrentYear()}
                onChange={(v) => { setAnnualGoalTarget(v); AsyncStorage.setItem("@goal_annual", String(v)).catch(() => {}); }}
              />
            </Pressable>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}
