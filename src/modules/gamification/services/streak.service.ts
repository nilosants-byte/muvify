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
