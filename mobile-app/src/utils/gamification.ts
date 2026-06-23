/**
 * Gamificação Fase 1 — cálculo client-side a partir dos bookings existentes.
 * Não requer nenhum endpoint novo no backend.
 *
 * Fase 2 (futura): substituir por chamada a /api/users/me/gamification
 * quando o backend de gamificação estiver implementado.
 */

import type { Booking } from "../services/api/client";
import type { UserProgress, Achievement } from "../types/gamification";

// ── Constantes de pontuação ───────────────────────────────────────────────────
const PTS_PRESENCIAL = 80;        // aula presencial concluída
const PTS_CONSULTORIA = 100;      // consultoria entregue (bookingType = treino liberado)
const PTS_PER_LEVEL = 500;        // pontos por nível

// ── Helpers de data ───────────────────────────────────────────────────────────
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isoDateKey(date: Date): string {
  return date.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// Usa partes locais da data para evitar desvio de timezone (UTC vs local)
function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfWeek(date: Date): Date {
  const d = startOfDay(new Date(date));
  d.setDate(d.getDate() - d.getDay()); // domingo
  return d;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

// ── Cálculo de streak (dias consecutivos com ≥1 treino) ───────────────────────
function computeStreak(completedDates: Date[]): number {
  if (completedDates.length === 0) return 0;

  // Cria conjunto de datas únicas (YYYY-MM-DD) usando data local, não UTC
  const uniqueDays = Array.from(
    new Set(completedDates.map((d) => localDateKey(d)))
  ).sort((a, b) => b.localeCompare(a)); // mais recentes primeiro

  if (uniqueDays.length === 0) return 0;

  // Se o dia mais recente não é hoje nem ontem, streak foi quebrado
  const now = new Date();
  const todayKey = localDateKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = localDateKey(yesterday);
  if (uniqueDays[0] !== todayKey && uniqueDays[0] !== yesterdayKey) return 0;

  let streak = 1;
  for (let i = 1; i < uniqueDays.length; i++) {
    // Append T00:00:00 to force local timezone parsing instead of UTC midnight
    const prev = new Date(uniqueDays[i - 1]! + "T00:00:00");
    const curr = new Date(uniqueDays[i]! + "T00:00:00");
    const diffDays = Math.round((prev.getTime() - curr.getTime()) / 86400000);
    if (diffDays === 1) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

// ── Função principal ──────────────────────────────────────────────────────────
export function computeUserProgress(bookings: Booking[]): UserProgress {
  const completed = bookings.filter((b) => b.status === "COMPLETED");
  const completedDates = completed
    .map((b) => new Date(b.completedAt ?? b.scheduledAt))
    .filter((d) => Number.isFinite(d.getTime()));

  const now = new Date();
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);

  const weeklyCompleted = completedDates.filter((d) => d >= weekStart).length;
  const monthlyCompleted = completedDates.filter((d) => d >= monthStart).length;

  const totalWorkouts = completed.length;
  const streak = computeStreak(completedDates);
  const points = totalWorkouts * PTS_PRESENCIAL; // simplificado: todos presenciais
  const level = Math.floor(points / PTS_PER_LEVEL) + 1;

  return {
    level,
    points,
    streak,
    weeklyGoal: { current: weeklyCompleted, target: 4 },
    monthlyGoal: { current: monthlyCompleted, target: 18 },
    totalWorkouts,
  };
}

// ── Conquistas ────────────────────────────────────────────────────────────────
export function computeAchievements(progress: UserProgress): Achievement[] {
  const { totalWorkouts, streak } = progress;

  return [
    {
      id: "iniciante",
      icon: "flash",
      label: "Iniciante",
      description: "10 treinos",
      requirement: "Complete 10 treinos",
      unlocked: totalWorkouts >= 10,
      unlockedAt: totalWorkouts >= 10 ? new Date() : undefined,
      points: 30,
      tier: "bronze",
      progress: { current: Math.min(totalWorkouts, 10), target: 10 },
    },
    {
      id: "mente_focada",
      icon: "flame",
      label: "Mente Focada",
      description: "7 dias seguidos",
      requirement: "7 dias consecutivos de treino",
      unlocked: streak >= 7,
      unlockedAt: streak >= 7 ? new Date() : undefined,
      points: 50,
      tier: "bronze",
      progress: { current: Math.min(streak, 7), target: 7 },
    },
    {
      id: "consistente",
      icon: "trophy",
      label: "Consistente",
      description: "30 dias seguidos",
      requirement: "30 dias consecutivos de treino",
      unlocked: streak >= 30,
      unlockedAt: streak >= 30 ? new Date() : undefined,
      points: 100,
      tier: "silver",
      progress: { current: Math.min(streak, 30), target: 30 },
    },
    {
      id: "elite",
      icon: "medal",
      label: "Elite",
      description: "100 treinos",
      requirement: "Complete 100 treinos",
      unlocked: totalWorkouts >= 100,
      unlockedAt: totalWorkouts >= 100 ? new Date() : undefined,
      points: 500,
      tier: "gold",
      progress: { current: Math.min(totalWorkouts, 100), target: 100 },
    },
  ];
}

// ── Conquistas do backend (Fase 2 — catálogo real, com categorias/medalhas) ───
export type BackendAchievement = {
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

export const ACHIEVEMENT_CONDITION_ICON: Record<string, string> = {
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

export const ACHIEVEMENT_MEDAL_TIER: Record<string, Achievement["tier"]> = {
  BRONZE:  "bronze",
  SILVER:  "silver",
  GOLD:    "gold",
  DIAMOND: "diamond",
  SPECIAL: "special",
};

export function mapBackendAchievement(
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
    icon: ACHIEVEMENT_CONDITION_ICON[ach.conditionType] ?? "ribbon",
    label: ach.name,
    description: ach.description,
    requirement: ach.description,
    unlocked,
    unlockedAt: ach.unlockedAt ? new Date(ach.unlockedAt) : undefined,
    points: ach.xpReward,
    tier: ACHIEVEMENT_MEDAL_TIER[ach.medalType] ?? "bronze",
    category: ach.category,
    progress: currentVal !== undefined && !unlocked
      ? { current: Math.min(currentVal, ach.conditionValue), target: ach.conditionValue }
      : undefined,
  };
}

// ── Scope switch helper ───────────────────────────────────────────────────────
export type ProgressScope = "Semana" | "Mês" | "Geral";

export function progressForScope(
  bookings: Booking[],
  scope: ProgressScope
): { meta: string; metaLabel: string; streak: number; pts: number; pct: number; lvl: number } {
  const completed = bookings.filter((b) => b.status === "COMPLETED");
  const now = new Date();

  let current = 0;
  let target = 4;

  if (scope === "Semana") {
    const weekStart = startOfWeek(now);
    current = completed.filter((b) => new Date(b.completedAt ?? b.scheduledAt) >= weekStart).length;
    target = 4;
  } else if (scope === "Mês") {
    const monthStart = startOfMonth(now);
    current = completed.filter((b) => new Date(b.completedAt ?? b.scheduledAt) >= monthStart).length;
    target = 18;
  } else {
    current = completed.length;
    target = Math.max(current, 10);
  }

  const completedDates = completed
    .map((b) => new Date(b.completedAt ?? b.scheduledAt))
    .filter((d) => Number.isFinite(d.getTime()));
  const streak = computeStreak(completedDates);
  const pts = completed.length * PTS_PRESENCIAL;
  const lvl = Math.floor(pts / PTS_PER_LEVEL) + 1;
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

  return {
    meta: scope === "Geral" ? String(current) : `${current}/${target}`,
    metaLabel: scope === "Geral"
      ? current === 1 ? "treino no total" : "treinos no total"
      : current === 1 ? "treino" : "treinos",
    streak,
    pts,
    pct,
    lvl,
  };
}
