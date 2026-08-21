import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../shared/errors/app-error";
import { prisma } from "../../../config/prisma";
import { getWeekKey } from "./xp.service";

const STREAK_MILESTONES = [15, 30, 45, 90];
// Épico de Frentes - redesenho do streak semanal (05/08/2026): marcos novos
// de SEMANAS seguidas batendo a própria meta, separados dos marcos em dias
// acima - os dois convivem, um não substitui o outro (decisão do usuário).
const WEEK_STREAK_MILESTONES = [4, 8, 12, 26, 52];
const APP_TZ = "America/Sao_Paulo";

function toLocalDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function diffInCalendarDays(a: Date, b: Date): number {
  const dayA = new Date(`${toLocalDateKey(a)}T12:00:00Z`);
  const dayB = new Date(`${toLocalDateKey(b)}T12:00:00Z`);
  return Math.round((dayA.getTime() - dayB.getTime()) / (1000 * 60 * 60 * 24));
}

// Extraído pra job de lembrete de treino (goal-reminder.job.ts): esse
// cálculo de "já bateu a meta desta semana" já existia duplicado inline em
// xp.service.ts (getUserGamificationProfile) e aqui mesmo (fechamento de
// semana em recordTraining) - centraliza numa função só, com o mesmo
// tratamento de weekKey desatualizado (streak de uma semana antiga não
// conta pra semana corrente).
export function hasMetWeeklyGoal(
  streak: { weekKey: string | null; daysTrainedThisWeek: number; trainingDaysPerWeek: number } | null | undefined,
  weekKey: string
): boolean {
  if (!streak) return false;
  const trainedThisWeek = streak.weekKey === weekKey ? streak.daysTrainedThisWeek : 0;
  return trainedThisWeek >= streak.trainingDaysPerWeek;
}

function addDaysToWeekKey(weekKey: string, days: number): string {
  const d = new Date(`${weekKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type StreakResult = {
  streakSessions: number;
  longestStreak: number;
  milestoneHit: number | null;
  weekMilestoneHit: number | null;
  alreadyTrainedToday: boolean;
};

// Épico de Frentes - redesenho do streak semanal (05/08/2026): modelo
// anterior quebrava a sequência se o intervalo entre dois treinos passasse
// de um número fixo de dias de folga - não refletia uma meta escolhida de
// verdade (nenhuma tela deixava configurar trainingDaysPerWeek). Modelo
// novo, desenhado com o usuário: cada dia treinado soma 1 na sequência
// (currentStreak); a sequência só quebra se, no fechamento de uma semana
// (segunda a domingo, mesma getWeekKey do ranking de amigos), o usuário não
// tiver batido a própria meta de dias/semana. Detecta também semana(s)
// inteiras puladas sem nenhum treino (óbvio que não bateram meta nenhuma),
// não só a última semana rastreada.
export async function recordTraining(userId: string): Promise<StreakResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { trainingDaysPerWeek: true },
  });
  const rawDays = user?.trainingDaysPerWeek ?? 3;
  const trainingDaysPerWeek = Math.max(1, Math.min(rawDays, 7));

  const streak = await prisma.userStreak.findUnique({ where: { userId } });
  const now = new Date();

  if (streak?.lastTrainingDate) {
    const daysSinceLast = diffInCalendarDays(now, streak.lastTrainingDate);
    if (daysSinceLast === 0) {
      return {
        streakSessions: streak.currentStreak,
        longestStreak: streak.longestStreak,
        milestoneHit: null,
        weekMilestoneHit: null,
        alreadyTrainedToday: true,
      };
    }
  }

  const currentWeekKey = getWeekKey(now);
  let newStreak: number;
  let newDaysTrainedThisWeek: number;
  let newCurrentStreakWeeks = streak?.currentStreakWeeks ?? 0;
  let weekMilestoneHit: number | null = null;

  if (!streak || !streak.weekKey) {
    // Primeiro treino registrado (ou streak resetada externamente).
    newStreak = 1;
    newDaysTrainedThisWeek = 1;
    newCurrentStreakWeeks = 0;
  } else if (streak.weekKey === currentWeekKey) {
    // Mesma semana já rastreada: só soma o dia, o fechamento da semana (e o
    // marco de semanas) só é avaliado quando a semana virar de fato.
    newStreak = streak.currentStreak + 1;
    newDaysTrainedThisWeek = streak.daysTrainedThisWeek + 1;
  } else {
    // A semana virou desde o último treino - fecha a semana rastreada:
    // bateu a própria meta E é a semana imediatamente seguinte (nenhuma
    // semana inteira foi pulada no meio, o que já quebraria a sequência
    // sozinho, já que uma semana sem nenhum treino nunca bate meta >= 1).
    const goalMetTrackedWeek = streak.daysTrainedThisWeek >= trainingDaysPerWeek;
    const noWeekSkipped = currentWeekKey === addDaysToWeekKey(streak.weekKey, 7);
    if (goalMetTrackedWeek && noWeekSkipped) {
      newStreak = streak.currentStreak + 1;
      newCurrentStreakWeeks = (streak.currentStreakWeeks ?? 0) + 1;
      weekMilestoneHit = WEEK_STREAK_MILESTONES.includes(newCurrentStreakWeeks) ? newCurrentStreakWeeks : null;
    } else {
      newStreak = 1;
      newCurrentStreakWeeks = 0;
    }
    newDaysTrainedThisWeek = 1;
  }

  const prevLongest = streak?.longestStreak ?? 0;
  const newLongest = newStreak > prevLongest ? newStreak : prevLongest;
  const prevLongestWeeks = streak?.longestStreakWeeks ?? 0;
  const newLongestWeeks = newCurrentStreakWeeks > prevLongestWeeks ? newCurrentStreakWeeks : prevLongestWeeks;
  const newTotalDaysTrained = (streak?.totalDaysTrained ?? 0) + 1;

  await prisma.userStreak.upsert({
    where: { userId },
    update: {
      currentStreak: newStreak,
      longestStreak: newLongest,
      lastTrainingDate: now,
      trainingDaysPerWeek,
      weekKey: currentWeekKey,
      daysTrainedThisWeek: newDaysTrainedThisWeek,
      currentStreakWeeks: newCurrentStreakWeeks,
      longestStreakWeeks: newLongestWeeks,
      totalDaysTrained: newTotalDaysTrained,
    },
    create: {
      userId,
      currentStreak: newStreak,
      longestStreak: newLongest,
      lastTrainingDate: now,
      trainingDaysPerWeek,
      weekKey: currentWeekKey,
      daysTrainedThisWeek: newDaysTrainedThisWeek,
      currentStreakWeeks: newCurrentStreakWeeks,
      longestStreakWeeks: newLongestWeeks,
      totalDaysTrained: newTotalDaysTrained,
    },
  });

  const milestoneHit = STREAK_MILESTONES.includes(newStreak) ? newStreak : null;

  return {
    streakSessions: newStreak,
    longestStreak: newLongest,
    milestoneHit,
    weekMilestoneHit,
    alreadyTrainedToday: false,
  };
}

export async function updateTrainingDaysConfig(userId: string, trainingDaysPerWeek: number): Promise<void> {
  if (!Number.isInteger(trainingDaysPerWeek) || trainingDaysPerWeek < 1 || trainingDaysPerWeek > 7) {
    throw new AppError("trainingDaysPerWeek deve ser um inteiro entre 1 e 7.", StatusCodes.BAD_REQUEST);
  }
  // Distingue "usuário configurou a meta de propósito" do default de
  // cadastro (trainingDaysPerWeek=3 sem o usuário nunca ter tocado nisso) -
  // usado pelo lembrete diário de treino (goal-reminder.job.ts) pra decidir
  // quem recebe o lembrete de verdade e quem recebe só o nudge sugerindo
  // configurar uma meta.
  await prisma.user.update({
    where: { id: userId },
    data: { trainingDaysPerWeek, weeklyGoalConfiguredAt: new Date() },
  });

  await prisma.userStreak.upsert({
    where: { userId },
    update: { trainingDaysPerWeek },
    create: {
      userId,
      currentStreak: 0,
      longestStreak: 0,
      trainingDaysPerWeek,
    },
  });
}
