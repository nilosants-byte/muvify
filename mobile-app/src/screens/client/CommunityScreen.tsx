import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  FlatList,
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
import { Image as ExpoImage } from "expo-image";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "@react-navigation/native";
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientTabParamList } from "../../navigation/route-types";
import { useAppState } from "../../state/AppState";
import { bookingsApi, Booking, communityApi, CommunityUser, UserPublicProfile, gamificationApi, GamificationProfile, RankingEntry, FeedPost, FeedPostMetadata, FeedComment, uploadsApi, consultancyApi, TrainingPlanCompletion } from "../../services/api/client";
import { MvAvatar } from "../../components/mv";
import {
  computeAchievements,
  progressForScope,
  mapBackendAchievement,
  type ProgressScope as GamificationScope,
  type BackendAchievement,
} from "../../utils/gamification";
import { useMvTheme } from "../../theme/MvThemeContext";
import type { MvTheme } from "../../theme/MvColors";
import { C, S, DISPLAY } from "../../theme/v2tokens";
import { hapticAchievement, hapticLike, hapticComment } from "../../utils/haptics";
import { PressableScale } from "../../components/polish/PressableScale";
import { captureException } from "../../observability/sentry";
import { AnimatedNumber } from "../../components/polish/AnimatedNumber";
import { ClientBottomNavV2 } from "../../components/navigation/ClientBottomNavV2";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import type { Achievement } from "../../types/gamification";
import { AchievementBadgeSvg } from "../../components/community/AchievementBadgeSvg";
import { AchievementsModal } from "../../components/community/AchievementsModal";
import { FeedPostArtSvg } from "../../components/community/FeedPostArtSvg";
import { PhotoLightbox } from "../../components/community/PhotoLightbox";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";

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

// Image.getSize only reads the image header (fast, no full decode), so we can
// know the real aspect ratio before the card renders and avoid the layout
// jump that came from guessing a default ratio and correcting it on load.
// Cached per URL since the same post can scroll in and out of view repeatedly.
const feedImageRatioCache = new Map<string, number>();

function clampFeedRatio(width: number, height: number) {
  return Math.max(FEED_MIN_RATIO, Math.min(FEED_MAX_RATIO, width / height));
}

function FeedImage({ uri, fallback }: {
  uri: string;
  fallback: ReturnType<typeof postThematicCard>;
}) {
  const [errored, setErrored] = useState(false);
  const [ratio, setRatio] = useState(() => feedImageRatioCache.get(uri) ?? 4 / 3);

  useEffect(() => {
    if (feedImageRatioCache.has(uri)) {
      setRatio(feedImageRatioCache.get(uri)!);
      return;
    }
    let cancelled = false;
    Image.getSize(
      uri,
      (width, height) => {
        if (cancelled || !width || !height) return;
        const clamped = clampFeedRatio(width, height);
        feedImageRatioCache.set(uri, clamped);
        setRatio(clamped);
      },
      () => { /* fall back to onLoad below */ }
    );
    return () => { cancelled = true; };
  }, [uri]);

  if (errored) {
    return (
      <View style={{ height: 80, borderRadius: 12, backgroundColor: fallback.bg, borderWidth: 1, borderColor: fallback.border, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={fallback.icon} size={24} color={fallback.color} />
      </View>
    );
  }
  return (
    // Frente 11 (engenharia mobile), Lote 11: expo-image (em vez do Image
    // nativo) — cache persistente em disco por padrão (cachePolicy
    // "memory-disk"), então rolar o feed pra frente e voltar não baixa a
    // mesma foto de novo. Image.getSize acima continua usando o Image
    // nativo (react-native) de propósito — expo-image não expõe esse
    // método estático; ver Lote 12 pra revisão desse round-trip extra.
    <ExpoImage
      source={{ uri }}
      style={{ width: "100%", aspectRatio: ratio, borderRadius: 12 }}
      contentFit="cover"
      cachePolicy="memory-disk"
      onLoad={(e) => {
        const { width, height } = e.source;
        if (width && height && !feedImageRatioCache.has(uri)) {
          const clamped = clampFeedRatio(width, height);
          feedImageRatioCache.set(uri, clamped);
          setRatio(clamped);
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
    // Épico de Frentes - redesenho do streak semanal (05/08/2026): mesmo
    // tipo de post pros dois marcos (dias e semanas seguidas) - metadata
    // diferencia qual foi batido.
    const weeks = meta.weeks as number | undefined;
    const sessions = meta.sessions as number | undefined;
    if (weeks) {
      headline = `${weeks} semana${weeks === 1 ? "" : "s"} seguidas na meta!`;
      detail = "Bateu a própria meta toda semana, sem falhar";
    } else {
      headline = sessions ? `${sessions} dias seguidos treinando!` : "Marco de sequência!";
      detail = "Uma sequência incrível de dedicação";
    }
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
// FeedPostCard owns its own like/comment state after mount (initialized once from
// `post`), so it's safe to skip re-render whenever the same post/viewer combo comes
// through again — this avoids re-rendering every card in the feed on every parent
// state change (search, scroll position, etc.) as the list grows while scrolling.
const FeedPostCard = React.memo(function FeedPostCard({
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
  // Frente 11 (engenharia mobile), Lote 3: recebe o id do post (em vez de vir
  // fechada sobre ele) pra poder ser uma função estável (useCallback sem
  // depender do post individual) no componente pai — necessário pro
  // React.memo deste card ter efeito de verdade.
  onCommentFocus: (postId: string) => void;
  onDeletePost: (postId: string) => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
  viewerId: string;
}) {
  const { theme, isDark } = useMvTheme();
  const meta = (post.metadata ?? {}) as FeedPostMetadata & Record<string, unknown>;
  const hasProvider = post.type === "WORKOUT_COMPLETED" && Boolean(meta.providerId);
  const postUser = post.user;

  const [liked, setLiked] = useState(post.likedByViewer ?? false);
  const [likesCount, setLikesCount] = useState<number>(post.likesCount ?? 0);
  const [commentsCount, setCommentsCount] = useState<number>(post.commentsCount ?? 0);
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
    } catch (error) {
      captureException(error, { screen: "CommunityScreen", action: "likePost" });
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
    } catch (error) {
      captureException(error, { screen: "CommunityScreen", action: "loadComments" });
    }
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
    } catch (error) {
      captureException(error, { screen: "CommunityScreen", action: "addComment" });
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
    } catch (error) {
      captureException(error, { screen: "CommunityScreen", action: "editComment" });
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
      captureException(err, { screen: "CommunityScreen", action: "deleteComment" });
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
              onFocus={() => onCommentFocus(post.id)}
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
                onPress={async () => {
                  setShowMenu(false);
                  try {
                    // Épico de Frentes, Frente 8, Lote 2: antes só mostrava o
                    // toast sem chamar nenhuma API — a denúncia não era
                    // persistida em lugar nenhum. Post denunciado some do
                    // próprio feed do denunciante a partir de agora.
                    await runWithAuth((token) => communityApi.reportPost(token, post.id));
                    onDeletePost(post.id);
                    showToast("Denúncia recebida. Obrigado por nos avisar.", "info");
                  } catch (error) {
                    captureException(error, { screen: "CommunityScreen", action: "reportPost" });
                    showToast("Não foi possível enviar a denúncia. Tente novamente.", "error");
                  }
                }}
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
                  } catch (error) {
                    captureException(error, { screen: "CommunityScreen", action: "deletePost" });
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
}, (prev, next) => prev.post.id === next.post.id && prev.viewerId === next.viewerId);

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

  // Épico de Frentes - redesenho do streak semanal (05/08/2026): abre o
  // detalhe da sequência (dias totais, semana corrente, semanas seguidas) -
  // a edição da meta reaproveita o showGoalModal/GoalPickerRow que já existiam.
  const [streakDetailVisible, setStreakDetailVisible] = useState(false);

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
  // Frente 11 (engenharia mobile), Lote 3: era ScrollView com feedItems.map()
  // sem limite — todo post carregado ficava montado o tempo todo, mesmo fora
  // de tela. Virou FlatList (virtualização real: só posts próximos da área
  // visível ficam montados). scrollToIndex substitui o rastreamento manual
  // de offsets em pixel que existia antes (feedContainerYRef/postYOffsetsRef).
  const feedListRef = useRef<FlatList<FeedPost>>(null);
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
  const [createPhotoData, setCreatePhotoData] = useState<{ uri: string; mimeType: string } | null>(null);

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
      } catch (error) {
        captureException(error, { screen: "CommunityScreen", action: "searchUsers" });
      }
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
    } catch (error) {
      captureException(error, { screen: "CommunityScreen", action: "followUnfollow" });
    }
    finally { followInFlightRef.current.delete(targetId); }
  }

  // Frente 11 (engenharia mobile), Lote 3: useCallback (era function comum,
  // recriada a cada render) — passada como onNavigateToProfile pro
  // FeedPostCard memoizado, uma referência nova a cada render derrotava o
  // React.memo dele mesmo com onCommentFocus/onDeletePost já estáveis.
  const openUserProfile = useCallback(async (userId: string) => {
    setProfileUserId(userId);
    setProfileData(null);
    setProfileLoading(true);
    try {
      const profile = await runWithAuth((token) => communityApi.getUserPublicProfile(token, userId));
      setProfileData(profile);
    } catch (error) {
      captureException(error, { screen: "CommunityScreen", action: "getUserPublicProfile" });
    }
    finally { setProfileLoading(false); }
  }, [runWithAuth]);

  // ── Ranking ──────────────────────────────────────────────────────────────────
  type RankingPeriod = "WEEKLY" | "MONTHLY" | "ALLTIME";
  const [rankingPeriod, setRankingPeriod] = useState<RankingPeriod>("WEEKLY");
  const [rankingItems, setRankingItems] = useState<RankingEntry[]>([]);
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
      // Bounds memory/render cost during long scroll sessions — trims the oldest
      // posts once the feed grows past a comfortable in-memory window.
      const FEED_MAX_ITEMS = 100;
      setFeedItems((prev) => {
        const merged = [...prev, ...res.items];
        return merged.length > FEED_MAX_ITEMS ? merged.slice(merged.length - FEED_MAX_ITEMS) : merged;
      });
      setFeedPage(nextPage);
      setFeedHasMore(res.items.length === 20);
    } catch (error) {
      captureException(error, { screen: "CommunityScreen", action: "loadMoreFeed" });
    }
    finally { setFeedLoadingMore(false); }
  }, [feedHasMore, feedLoadingMore, feedPage, runWithAuth]);

  // Frente 11 (engenharia mobile), Lote 3: callbacks estáveis (useCallback,
  // sem depender de feedItems em si) repassados ao FeedPostCard memoizado —
  // antes eram funções inline recriadas a cada render do FeedPostCard.tsx do
  // parent (uma por post, a cada re-render de CommunityScreen inteiro:
  // digitar na busca, trocar de aba do ranking, etc.), o que invalidava o
  // React.memo do card e derrubava a economia de re-render pretendida por ele.
  const feedItemsRef = useRef<FeedPost[]>([]);
  useEffect(() => {
    feedItemsRef.current = feedItems;
  }, [feedItems]);

  const handleNavigateToProvider = useCallback(
    (id: string) => {
      navigation.getParent<any>()?.navigate("ProfessionalDetail", { professionalId: id });
    },
    [navigation]
  );

  const handleCommentFocus = useCallback((postId: string) => {
    const index = feedItemsRef.current.findIndex((p) => p.id === postId);
    if (index < 0) return;
    setTimeout(() => {
      feedListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0 });
    }, 120);
  }, []);

  const handleDeletePost = useCallback((postId: string) => {
    setFeedItems((prev) => prev.filter((p) => p.id !== postId));
  }, []);

  const handleScrollToIndexFailed = useCallback((info: { index: number; averageItemLength: number }) => {
    feedListRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
    setTimeout(() => feedListRef.current?.scrollToIndex({ index: info.index, animated: true }), 50);
  }, []);

  // ── Dados principais: bookings + gamificação + sugestões + conquistas + seguindo
  const communityQuery = useAuthQuery(
    queryKeys.community.all,
    async (token) => {
      const [bks, gam, suggestionsRes, achRes, followingRes, trainingCompletionsRes] = await Promise.all([
        bookingsApi.me(token),
        gamificationApi.getMyProfile(token),
        communityApi.getSuggestions(token, 10).catch(() => [] as CommunityUser[]),
        gamificationApi.getAchievements(token).catch(() => [] as BackendAchievement[]),
        communityApi.getFollowing(token, 1, 200).catch(() => ({ items: [] as CommunityUser[], total: 0 })),
        // Frente 4 (Criação/entrega/evolução do treino), Lote 5: "Meu progresso"
        // só contava sessões presenciais (bookings) — treinos de consultoria
        // online concluídos nunca entravam na meta semanal/mensal/anual.
        consultancyApi.myTrainingCompletions(token).catch(() => [] as TrainingPlanCompletion[]),
      ]);
      return { bookings: bks, gamification: gam, suggestions: suggestionsRes, achievements: achRes, followingItems: followingRes.items, trainingCompletions: trainingCompletionsRes };
    },
    { staleTime: 5 * 60 * 1000 }
  );

  const bookings: Booking[] = communityQuery.data?.bookings ?? [];
  const trainingCompletions: TrainingPlanCompletion[] = communityQuery.data?.trainingCompletions ?? [];
  const gamificationData: GamificationProfile | null = communityQuery.data?.gamification ?? null;
  const suggestions: CommunityUser[] = communityQuery.data?.suggestions ?? [];
  const backendAchievements: BackendAchievement[] = communityQuery.data?.achievements ?? [];

  // Épico de Frentes - redesenho do streak semanal (05/08/2026): a meta
  // semanal já existia como número puramente local (AsyncStorage, só pro
  // widget "Meu progresso") - agora ela também É a meta que o backend usa
  // pra decidir se a sequência quebra ou continua, então sincroniza com o
  // valor real salvo no servidor assim que ele chega (prevalece sobre o
  // que estava só no aparelho).
  useEffect(() => {
    if (gamificationData?.trainingDaysPerWeek) {
      setWeeklyGoalTarget(gamificationData.trainingDaysPerWeek);
    }
  }, [gamificationData?.trainingDaysPerWeek]);

  // Sincroniza followingIds ao carregar/atualizar communityQuery
  useEffect(() => {
    if (!communityQuery.data) return;
    setFollowingIds(new Set(communityQuery.data.followingItems.map((u) => u.id)));
  }, [communityQuery.data]);

  // ── Ranking via TanStack (auto-refetch ao mudar período) ────────────────────
  const rankingQuery = useAuthQuery(
    queryKeys.community.ranking(rankingPeriod),
    (token) => communityApi.getRanking(token, rankingPeriod, 1, 50),
    { staleTime: 2 * 60 * 1000 }
  );

  const rankingLoading = rankingQuery.isLoading;
  const rankingTransitioning = rankingQuery.isFetching && !!rankingQuery.data;

  // Sincroniza ranking com detecção de subida de posição
  useEffect(() => {
    if (!rankingQuery.data) return;
    const res = rankingQuery.data;
    const prev = prevViewerPositionRef.current;
    const next = res.viewerPosition;
    if (prev !== null && next !== null && next < prev) {
      void hapticAchievement();
      showToast(`🎉 Você subiu para #${next} no ranking!`, "success");
    }
    prevViewerPositionRef.current = next;
    setViewerPosition(res.viewerPosition);
    setViewerXp(res.viewerXp ?? 0);
    setRankingItems(res.items);
  }, [rankingQuery.data, showToast]);

  // ── Feed: carga inicial e pull-to-refresh ────────────────────────────────────
  const loadFeed = useCallback(async () => {
    setFeedLoading(true);
    try {
      const feedRes = await runWithAuth((token) =>
        communityApi.getFeed(token, 1, 20).catch((error) => {
          captureException(error, { screen: "CommunityScreen", action: "getFeed" });
          return { items: [] as FeedPost[], total: 0 };
        })
      );
      setFeedItems(feedRes.items);
      setFeedPage(1);
      setFeedHasMore(feedRes.items.length === 20);
      lastFocusRefreshRef.current = Date.now();
      initialLoadDoneRef.current = true;
    } catch (error) {
      captureException(error, { screen: "CommunityScreen", action: "loadFeed" });
    }
    finally { setFeedLoading(false); }
  }, [runWithAuth]);

  useEffect(() => { void loadFeed(); }, [loadFeed]);

  // Pull-to-refresh: atualiza feed + dados principais silenciosamente
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setPendingFeedItems([]);
    lastFocusRefreshRef.current = Date.now();
    try {
      const [feedRes] = await Promise.all([
        runWithAuth((token) => communityApi.getFeed(token, 1, 20).catch(() => ({ items: [] as FeedPost[], total: 0 }))),
        communityQuery.refetch(),
      ]);
      setFeedItems(feedRes.items);
      setFeedPage(1);
      setFeedHasMore(feedRes.items.length === 20);
    } catch (error) {
      captureException(error, { screen: "CommunityScreen", action: "handleRefresh" });
    }
    finally { setRefreshing(false); }
  }, [runWithAuth, communityQuery.refetch]);

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
      allowsEditing: true, quality: 0.7,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset?.uri) { showToast("Não foi possível carregar a imagem.", "error"); return; }
    // Frente 11 (engenharia mobile), Lote 12: mesmo teto já aplicado na foto
    // de perfil (ProfessionalProfileEditorScreen) — a foto do post não tinha
    // limite nenhum.
    if (asset.fileSize && asset.fileSize > 3 * 1024 * 1024) {
      showToast("A foto deve ter no máximo 3MB.", "error");
      return;
    }
    setCreatePhotoUri(asset.uri);
    setCreatePhotoData({ uri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg" });
  }

  async function submitCreatePost() {
    const caption = createCaption.trim();
    if (!caption || createSubmitting) return;
    setCreateSubmitting(true);
    try {
      await runWithAuth(async (token) => {
        let imageUrl: string | undefined;
        if (createPhotoData) {
          const uploaded = await uploadsApi.uploadMedia(
            token,
            { uri: createPhotoData.uri, mimeType: createPhotoData.mimeType, fileName: "feed-photo.jpg" },
            "feed-photos"
          );
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
      const feedRes = await runWithAuth((token) => communityApi.getFeed(token, 1, 20)).catch((error) => {
        captureException(error, { screen: "CommunityScreen", action: "getFeed-after-createPost" });
        return { items: [] as FeedPost[], total: 0 };
      });
      setFeedItems(feedRes.items);
      setFeedPage(1);
      setFeedHasMore(feedRes.items.length === 20);
      showToast("Post publicado!", "success");
    } catch (error) {
      captureException(error, { screen: "CommunityScreen", action: "createPost" });
      Keyboard.dismiss();
      showToast("Não foi possível publicar. Tente novamente.", "error");
    } finally {
      setCreateSubmitting(false);
    }
  }



  // Dados de progresso com metas configuradas pelo usuário
  // As contagens de treino são calculadas aqui para evitar dependência de variáveis
  // declaradas mais abaixo (weeklyCompleted / monthlyCompleted) que causariam TDZ.
  const d = useMemo(() => {
    const base = progressForScope(bookings, scope);
    const done = bookings.filter((b) => b.status === "COMPLETED");
    const onlineDates = trainingCompletions
      .map((c) => new Date(c.completedAt))
      .filter((date) => Number.isFinite(date.getTime()));
    const now = new Date();

    const ws = new Date(now); ws.setHours(0, 0, 0, 0); ws.setDate(ws.getDate() - ws.getDay());
    const wDone = done.filter((b) => new Date(b.completedAt ?? b.scheduledAt) >= ws).length
      + onlineDates.filter((date) => date >= ws).length;

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const mDone = done.filter((b) => new Date(b.completedAt ?? b.scheduledAt) >= monthStart).length
      + onlineDates.filter((date) => date >= monthStart).length;

    const yearStart = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    const yDone = done.filter((b) => new Date(b.completedAt ?? b.scheduledAt) >= yearStart).length
      + onlineDates.filter((date) => date >= yearStart).length;

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
  }, [bookings, trainingCompletions, scope, weeklyGoalTarget, monthlyGoalTarget, annualGoalTarget, gamificationData]);

  const totalWorkouts = useMemo(
    () => bookings.filter((b) => b.status === "COMPLETED").length + trainingCompletions.length,
    [bookings, trainingCompletions]
  );

  const weeklyCompleted = useMemo(() => {
    const completed = bookings.filter((b) => b.status === "COMPLETED");
    const weekStart = new Date();
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const onlineCount = trainingCompletions.filter((c) => new Date(c.completedAt) >= weekStart).length;
    return completed.filter((b) => new Date(b.completedAt ?? b.scheduledAt) >= weekStart).length + onlineCount;
  }, [bookings, trainingCompletions]);

  const monthlyCompleted = useMemo(() => {
    const completed = bookings.filter((b) => b.status === "COMPLETED");
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1, 0, 0, 0, 0);
    const onlineCount = trainingCompletions.filter((c) => new Date(c.completedAt) >= monthStart).length;
    return completed.filter((b) => new Date(b.completedAt ?? b.scheduledAt) >= monthStart).length + onlineCount;
  }, [bookings, trainingCompletions]);

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
      {/* FlatList único — virtualização real do feed (Frente 11, Lote 3: era
          ScrollView + feedItems.map() sem limite, todo post ficava montado
          mesmo fora de tela). Tudo que vem antes do feed (progresso, streak,
          ranking, sugestões) roda como ListHeaderComponent — continua sem
          scroll aninhado (regra V2), agora dentro do mesmo FlatList. */}
      <FlatList
        ref={feedListRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 120, paddingTop: 16 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        removeClippedSubviews
        scrollEventThrottle={400}
        onScroll={(e) => setShowScrollTop(e.nativeEvent.contentOffset.y > 300)}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (!feedLoadingMore && feedHasMore && !feedLoading) void loadMoreFeed();
        }}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
        data={feedItems}
        keyExtractor={(post) => post.id}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        renderItem={({ item: post }) => (
          <View style={{ paddingHorizontal: S.px }}>
            <FeedPostCard
              post={post}
              runWithAuth={runWithAuth}
              showToast={showToast}
              viewerId={user?.id ?? ""}
              onNavigateToProvider={handleNavigateToProvider}
              onNavigateToProfile={openUserProfile}
              onCommentFocus={handleCommentFocus}
              onDeletePost={handleDeletePost}
            />
          </View>
        )}
        ListFooterComponent={
          feedLoadingMore ? (
            <View style={{ paddingHorizontal: S.px, paddingVertical: 20, alignItems: "center" }}>
              <ActivityIndicator size="small" color={theme.primary} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={{ paddingHorizontal: S.px }}>
            {feedLoading ? (
              <View style={{ gap: 10 }}>
                {[1, 2].map((i) => (
                  <View key={i} style={{ height: 90, borderRadius: S.cardR, backgroundColor: theme.cardBg, borderWidth: 1, borderColor: theme.border }} />
                ))}
              </View>
            ) : (
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
            )}
          </View>
        }
        ListHeaderComponent={
        <>
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

              {/* Sequência — toque abre o detalhe (dias totais, semana corrente, semanas seguidas) */}
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => setStreakDetailVisible(true)}
                style={{ flex: 1, borderRadius: 20, padding: 12, backgroundColor: theme.cardBg, borderWidth: 1, borderColor: C.amberBorder }}
              >
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
              </TouchableOpacity>

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
                feedListRef.current?.scrollToOffset({ offset: 0, animated: true });
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
        </View>
        </>
        }
      />
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
          onPress={() => feedListRef.current?.scrollToOffset({ offset: 0, animated: true })}
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
      <AchievementsModal
        visible={showAllAchievements}
        onClose={() => setShowAllAchievements(false)}
        achievements={achievements}
      />

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
                onChange={(v) => {
                  setWeeklyGoalTarget(v);
                  AsyncStorage.setItem("@goal_weekly", String(v)).catch(() => {});
                  // Essa mesma meta agora também é a que decide se a
                  // sequência de dias/semanas quebra ou continua.
                  void runWithAuth((token) => gamificationApi.updateTrainingDays(token, v))
                    .then(() => communityQuery.refetch())
                    .catch(() => showToast("Meta salva no aparelho, mas não deu pra sincronizar com o servidor agora.", "error"));
                }}
              />
              <Text style={{ fontSize: 12, color: theme.text3, marginTop: -14, marginBottom: 22 }}>
                Também é a meta usada pra sua sequência de treinos não quebrar.
              </Text>

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

      {/* ── Modal: detalhe da sequência (Épico de Frentes - redesenho do streak semanal, 05/08/2026) ── */}
      <Modal
        visible={streakDetailVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setStreakDetailVisible(false)}
        statusBarTranslucent
      >
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          <Pressable
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)" }}
            onPress={() => setStreakDetailVisible(false)}
          />
          <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: theme.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingBottom: insets.bottom + 28, paddingTop: 20 }}>
            <View style={{ width: 36, height: 4, borderRadius: 99, backgroundColor: theme.border, alignSelf: "center", marginBottom: 20 }} />

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 20, color: theme.text1, letterSpacing: -0.3 }}>Sua sequência</Text>
              <TouchableOpacity
                onPress={() => setStreakDetailVisible(false)}
                style={{ width: 32, height: 32, borderRadius: 99, backgroundColor: "rgba(255,255,255,0.07)", alignItems: "center", justifyContent: "center" }}
              >
                <Ionicons name="close" size={18} color={theme.text2} />
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: "row", gap: 12, marginBottom: 20 }}>
              <View style={{ flex: 1, borderRadius: 16, padding: 14, backgroundColor: theme.cardBg, borderWidth: 1, borderColor: C.amberBorder }}>
                <Text style={{ fontSize: 11, color: theme.text2 }}>Sequência atual</Text>
                <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 26, color: theme.text1, marginTop: 4 }}>{d.streak}</Text>
                <Text style={{ fontSize: 10, color: theme.text3 }}>dias seguidos</Text>
              </View>
              <View style={{ flex: 1, borderRadius: 16, padding: 14, backgroundColor: theme.cardBg, borderWidth: 1, borderColor: theme.border }}>
                <Text style={{ fontSize: 11, color: theme.text2 }}>Total treinado</Text>
                <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 26, color: theme.text1, marginTop: 4 }}>{gamificationData?.totalDaysTrained ?? 0}</Text>
                <Text style={{ fontSize: 10, color: theme.text3 }}>dias no total, nunca reseta</Text>
              </View>
            </View>

            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1, marginBottom: 8 }}>
              Esta semana: {gamificationData?.daysTrainedThisWeek ?? 0} de {gamificationData?.trainingDaysPerWeek ?? 3} dias
            </Text>
            <View style={{ flexDirection: "row", gap: 4, marginBottom: 20 }}>
              {Array.from({ length: gamificationData?.trainingDaysPerWeek ?? 3 }, (_, i) => {
                const done = i < Math.min(gamificationData?.daysTrainedThisWeek ?? 0, gamificationData?.trainingDaysPerWeek ?? 3);
                return (
                  <View key={i} style={{
                    flex: 1, height: 24, borderRadius: 7,
                    backgroundColor: done ? C.amber + "22" : "rgba(255,255,255,0.05)",
                    borderWidth: 1, borderColor: done ? C.amber + "55" : "rgba(255,255,255,0.10)",
                    alignItems: "center", justifyContent: "center",
                  }}>
                    {done
                      ? <Ionicons name="checkmark" size={12} color={C.amber} />
                      : <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.20)" }} />}
                  </View>
                );
              })}
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 20, padding: 12, borderRadius: 14, backgroundColor: theme.cardBg, borderWidth: 1, borderColor: theme.border }}>
              <Ionicons name="calendar" size={20} color={C.amber} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }}>
                  {gamificationData?.currentStreakWeeks ?? 0} semana{(gamificationData?.currentStreakWeeks ?? 0) === 1 ? "" : "s"} seguidas na meta
                </Text>
                <Text style={{ fontSize: 11, color: theme.text3, marginTop: 1 }}>
                  Bata sua meta toda semana pra manter essa sequência subindo
                </Text>
              </View>
            </View>

            <Text style={{ fontSize: 12, color: theme.text3, marginBottom: 20, lineHeight: 17 }}>
              Cada dia treinado soma na sua sequência. Ela só quebra se você não bater sua meta semanal até o fim da semana (segunda a domingo).
            </Text>

            <TouchableOpacity
              onPress={() => { setStreakDetailVisible(false); setShowGoalModal(true); }}
              style={{ height: S.btnH, borderRadius: S.btnR, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }}>Editar minha meta semanal</Text>
            </TouchableOpacity>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}
