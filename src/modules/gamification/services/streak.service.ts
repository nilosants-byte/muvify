import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../shared/errors/app-error";
import { prisma } from "../../../config/prisma";

const STREAK_MILESTONES = [15, 30, 45, 90];
const APP_TZ = "America/Sao_Paulo";

function toLocalDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function diffInCalendarDays(a: Date, b: Date): number {
  const dayA = new Date(`${toLocalDateKey(a)}T12:00:00Z`);
  const dayB = new Date(`${toLocalDateKey(b)}T12:00:00Z`);
  return Math.round((dayA.getTime() - dayB.getTime()) / (1000 * 60 * 60 * 24));
}

export type StreakResult = {
  streakSessions: number;
  longestStreak: number;
  milestoneHit: number | null;
  alreadyTrainedToday: boolean;
};

export async function recordTraining(userId: string): Promise<StreakResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { trainingDaysPerWeek: true },
  });
  // Épico de Frentes, Frente 8, Lote 15: trainingDaysPerWeek foi desenhado
  // pra ser uma meta pessoal configurável (PATCH /gamification/training-days
  // já existe no backend), mas nenhuma tela do app hoje deixa o usuário
  // mudar esse valor - todo mundo fica travado no default de 3 (maxRestDays
  // = 4), então a folga abaixo NÃO reflete uma meta escolhida de fato hoje,
  // só o comportamento padrão fixo. O usuário confirmou que o modelo
  // correto de streak é outro (avaliação semanal contra uma meta de dias
  // configurável, não folga por dia corrido) - fica registrado como
  // iniciativa própria a ser desenhada depois do épico de Frentes, não um
  // ajuste pequeno deste lote.
  const rawDays = user?.trainingDaysPerWeek ?? 3;
  const trainingDaysPerWeek = Math.max(1, Math.min(rawDays, 7));
  const maxRestDays = 7 - trainingDaysPerWeek;

  const streak = await prisma.userStreak.findUnique({ where: { userId } });
  const now = new Date();

  if (streak?.lastTrainingDate) {
    const daysSinceLast = diffInCalendarDays(now, streak.lastTrainingDate);

    if (daysSinceLast === 0) {
      return {
        streakSessions: streak.currentStreak,
        longestStreak: streak.longestStreak,
        milestoneHit: null,
        alreadyTrainedToday: true,
      };
    }
  }

  let newStreak: number;

  if (!streak || !streak.lastTrainingDate) {
    newStreak = 1;
  } else {
    const daysSinceLast = diffInCalendarDays(now, streak.lastTrainingDate);
    const restDaysBetween = daysSinceLast - 1;

    if (restDaysBetween <= maxRestDays) {
      newStreak = streak.currentStreak + 1;
    } else {
      newStreak = 1;
    }
  }

  const prevLongest = streak?.longestStreak ?? 0;
  const newLongest = newStreak > prevLongest ? newStreak : prevLongest;

  await prisma.userStreak.upsert({
    where: { userId },
    update: {
      currentStreak: newStreak,
      longestStreak: newLongest,
      lastTrainingDate: now,
      trainingDaysPerWeek,
    },
    create: {
      userId,
      currentStreak: newStreak,
      longestStreak: newLongest,
      lastTrainingDate: now,
      trainingDaysPerWeek,
    },
  });

  const milestoneHit = STREAK_MILESTONES.includes(newStreak) ? newStreak : null;

  return {
    streakSessions: newStreak,
    longestStreak: newLongest,
    milestoneHit,
    alreadyTrainedToday: false,
  };
}

export async function updateTrainingDaysConfig(userId: string, trainingDaysPerWeek: number): Promise<void> {
  if (!Number.isInteger(trainingDaysPerWeek) || trainingDaysPerWeek < 1 || trainingDaysPerWeek > 7) {
    throw new AppError("trainingDaysPerWeek deve ser um inteiro entre 1 e 7.", StatusCodes.BAD_REQUEST);
  }
  await prisma.user.update({
    where: { id: userId },
    data: { trainingDaysPerWeek },
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
