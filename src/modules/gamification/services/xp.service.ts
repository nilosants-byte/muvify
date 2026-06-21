import { Prisma, XpReason } from "@prisma/client";
import { prisma } from "../../../config/prisma";

export const LEVELS = [
  { level: 1,  name: "Novato",     minXp: 0      },
  { level: 2,  name: "Ativo",      minXp: 300    },
  { level: 3,  name: "Dedicado",   minXp: 800    },
  { level: 4,  name: "Atleta",     minXp: 2000   },
  { level: 5,  name: "Guerreiro",  minXp: 5000   },
  { level: 6,  name: "Campeão",    minXp: 10000  },
  { level: 7,  name: "Elite",      minXp: 20000  },
  { level: 8,  name: "Mestre",     minXp: 40000  },
  { level: 9,  name: "Lenda",      minXp: 75000  },
  { level: 10, name: "Imortal",    minXp: 120000 },
];

export type LevelInfo = {
  level: number;
  name: string;
  minXp: number;
  nextLevelMinXp: number | null;
};

export function computeLevel(totalXp: number): LevelInfo {
  let current = LEVELS[0];
  for (const lvl of LEVELS) {
    if (totalXp >= lvl.minXp) current = lvl;
    else break;
  }
  const next = LEVELS.find((l) => l.level === current.level + 1) ?? null;
  return { ...current, nextLevelMinXp: next?.minXp ?? null };
}

const APP_TZ = "America/Sao_Paulo";

function toLocalDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function getWeekKey(date: Date): string {
  const localStr = toLocalDateKey(date); // "YYYY-MM-DD" in SP
  const d = new Date(`${localStr}T12:00:00Z`); // noon UTC avoids DST edges
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day; // distance to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

export function getMonthKey(date: Date): string {
  return toLocalDateKey(date).slice(0, 7);
}

export async function getTotalXp(userId: string): Promise<number> {
  const result = await prisma.userXpTransaction.aggregate({
    where: { userId },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}

export async function awardXp(
  userId: string,
  amount: number,
  reason: XpReason,
  referenceId?: string
): Promise<{ prevLevel: LevelInfo; newLevel: LevelInfo }> {
  // Idempotência: evita XP duplo se a mesma operação for chamada mais de uma vez
  if (referenceId) {
    const existing = await prisma.userXpTransaction.findFirst({
      where: { userId, reason, referenceId },
      select: { id: true },
    });
    if (existing) {
      const total = await getTotalXp(userId);
      const level = computeLevel(total);
      return { prevLevel: level, newLevel: level };
    }
  }

  const prevTotal = await getTotalXp(userId);
  const prevLevel = computeLevel(prevTotal);

  try {
    await prisma.userXpTransaction.create({
      data: { userId, amount, reason, referenceId },
    });
  } catch (err) {
    // Race condition: outro request criou a mesma transação antes → retorna estado atual
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const total = await getTotalXp(userId);
      const level = computeLevel(total);
      return { prevLevel: level, newLevel: level };
    }
    throw err;
  }

  const now = new Date();
  const weekKey = getWeekKey(now);
  const monthKey = getMonthKey(now);

  await Promise.all([
    prisma.rankingSnapshot.upsert({
      where: { userId_periodType_periodKey: { userId, periodType: "WEEKLY", periodKey: weekKey } },
      update: { xpEarned: { increment: amount } },
      create: { userId, periodType: "WEEKLY", periodKey: weekKey, xpEarned: amount },
    }),
    prisma.rankingSnapshot.upsert({
      where: { userId_periodType_periodKey: { userId, periodType: "MONTHLY", periodKey: monthKey } },
      update: { xpEarned: { increment: amount } },
      create: { userId, periodType: "MONTHLY", periodKey: monthKey, xpEarned: amount },
    }),
    prisma.rankingSnapshot.upsert({
      where: { userId_periodType_periodKey: { userId, periodType: "ALLTIME", periodKey: "alltime" } },
      update: { xpEarned: { increment: amount } },
      create: { userId, periodType: "ALLTIME", periodKey: "alltime", xpEarned: amount },
    }),
  ]);

  const newTotal = prevTotal + amount;
  const newLevel = computeLevel(newTotal);
  return { prevLevel, newLevel };
}

export async function getUserGamificationProfile(userId: string) {
  const now = new Date();
  const weekKey = getWeekKey(now);
  const monthKey = getMonthKey(now);

  const [totalXp, streak, unlockedAchievements, weekSnap, monthSnap] = await Promise.all([
    getTotalXp(userId),
    prisma.userStreak.findUnique({ where: { userId } }),
    prisma.userAchievement.findMany({
      where: { userId },
      include: { achievement: true },
      orderBy: { unlockedAt: "desc" },
    }),
    prisma.rankingSnapshot.findUnique({
      where: { userId_periodType_periodKey: { userId, periodType: "WEEKLY", periodKey: weekKey } },
      select: { xpEarned: true },
    }),
    prisma.rankingSnapshot.findUnique({
      where: { userId_periodType_periodKey: { userId, periodType: "MONTHLY", periodKey: monthKey } },
      select: { xpEarned: true },
    }),
  ]);

  const levelInfo = computeLevel(totalXp);

  return {
    totalXp,
    currentLevel: levelInfo.level,
    levelName: levelInfo.name,
    nextLevelMinXp: levelInfo.nextLevelMinXp,
    xpToNextLevel: levelInfo.nextLevelMinXp != null ? levelInfo.nextLevelMinXp - totalXp : null,
    currentStreak: streak?.currentStreak ?? 0,
    longestStreak: streak?.longestStreak ?? 0,
    weeklyXp: weekSnap?.xpEarned ?? 0,
    monthlyXp: monthSnap?.xpEarned ?? 0,
    unlockedAchievements,
  };
}
