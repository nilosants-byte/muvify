import { AchievementConditionType } from "@prisma/client";
import { prisma } from "../../../config/prisma";
import { awardXp, computeLevel, getTotalXp } from "./xp.service";
import { NotificationService } from "../../notifications/services/notification.service";

export type AchievementTrigger = AchievementConditionType;

export type UnlockedAchievement = {
  key: string;
  name: string;
  medalType: string;
  xpRewarded: number;
};

const notificationService = new NotificationService();

// Épico de Frentes, Frente 8, Lote 12: nível, streak, conquista e ranking
// não geravam push nenhum - só criavam o FeedPost automático, visto só se
// o usuário abrisse a aba Comunidade por conta própria. Centralizado aqui
// (em vez de em cada call site de checkAndUnlock/checkLevelAchievements)
// pra cobrir todo mundo que desbloqueia uma conquista, não só um fluxo.
async function notifyAchievementsUnlocked(userId: string, unlocked: UnlockedAchievement[]): Promise<void> {
  for (const achievement of unlocked) {
    await notificationService.sendToUsers([userId], {
      title: "Conquista desbloqueada!",
      body: `Você desbloqueou "${achievement.name}" no Muvify.`,
      data: { type: "ACHIEVEMENT_UNLOCKED", achievementKey: achievement.key },
      preferenceType: "COMMUNITY",
    }).catch(() => { /* best effort */ });
  }
}

export async function checkAndUnlock(
  userId: string,
  triggers: AchievementTrigger[]
): Promise<UnlockedAchievement[]> {
  const [allAchievements, userAchievements] = await Promise.all([
    prisma.achievement.findMany({
      where: { conditionType: { in: triggers } },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.userAchievement.findMany({
      where: { userId },
      select: { achievementId: true },
    }),
  ]);

  const alreadyUnlocked = new Set(userAchievements.map((ua) => ua.achievementId));
  const candidates = allAchievements.filter((a) => !alreadyUnlocked.has(a.id));

  if (candidates.length === 0) return [];

  const stats = await gatherStats(userId, triggers);
  const unlocked: UnlockedAchievement[] = [];

  for (const achievement of candidates) {
    if (await meetsCondition(userId, achievement.conditionType, achievement.conditionValue, stats)) {
      const result = await prisma.userAchievement.createMany({
        data: [{ userId, achievementId: achievement.id }],
        skipDuplicates: true,
      });
      if (result.count === 0) continue;

      if (achievement.xpReward > 0) {
        await awardXp(userId, achievement.xpReward, "ACHIEVEMENT_UNLOCKED", achievement.id);
      }

      unlocked.push({
        key: achievement.key,
        name: achievement.name,
        medalType: achievement.medalType,
        xpRewarded: achievement.xpReward,
      });
    }
  }

  if (unlocked.length > 0) {
    await notifyAchievementsUnlocked(userId, unlocked);
  }

  return unlocked;
}

export async function checkLevelAchievements(userId: string): Promise<UnlockedAchievement[]> {
  const totalXp = await getTotalXp(userId);
  const { level } = computeLevel(totalXp);

  const [levelAchievements, userAchievements] = await Promise.all([
    prisma.achievement.findMany({
      where: { conditionType: "LEVEL_REACHED", conditionValue: { lte: level } },
    }),
    prisma.userAchievement.findMany({
      where: { userId },
      select: { achievementId: true },
    }),
  ]);

  const alreadyUnlocked = new Set(userAchievements.map((ua) => ua.achievementId));
  const candidates = levelAchievements.filter((a) => !alreadyUnlocked.has(a.id));

  if (candidates.length === 0) return [];

  // createMany com skipDuplicates previne P2002 em race conditions
  await prisma.userAchievement.createMany({
    data: candidates.map((a) => ({ userId, achievementId: a.id })),
    skipDuplicates: true,
  });

  const unlocked = candidates.map((achievement) => ({
    key: achievement.key,
    name: achievement.name,
    medalType: achievement.medalType,
    xpRewarded: 0,
  }));

  await notifyAchievementsUnlocked(userId, unlocked);

  return unlocked;
}

type Stats = {
  currentStreak?: number;
  totalWorkouts?: number;
  totalFollowing?: number;
  totalFollowers?: number;
  totalReviews?: number;
  totalPhotoPosts?: number;
  distinctProviders?: number;
  weeklyTop3Reached?: boolean;
  weekly1stReached?: boolean;
  weeklyTop3ConsecutiveWeeks?: number;
};

async function gatherStats(userId: string, triggers: AchievementTrigger[]): Promise<Stats> {
  const stats: Stats = {};
  const needs = new Set(triggers);

  await Promise.all([
    needs.has("STREAK_SESSIONS") &&
      prisma.userStreak
        .findUnique({ where: { userId }, select: { currentStreak: true } })
        .then((s) => { stats.currentStreak = s?.currentStreak ?? 0; }),

    needs.has("TOTAL_WORKOUTS") &&
      prisma.booking
        .count({ where: { clientId: userId, status: "COMPLETED" } })
        .then((c) => { stats.totalWorkouts = c; }),

    needs.has("TOTAL_FOLLOWING") &&
      prisma.follow
        .count({ where: { followerId: userId } })
        .then((c) => { stats.totalFollowing = c; }),

    needs.has("TOTAL_FOLLOWERS") &&
      prisma.follow
        .count({ where: { followingId: userId } })
        .then((c) => { stats.totalFollowers = c; }),

    needs.has("TOTAL_REVIEWS_SUBMITTED") &&
      prisma.review
        .count({ where: { userId } })
        .then((c) => { stats.totalReviews = c; }),

    // Épico de Frentes, Frente 8, Lote 1: MANUAL_PHOTO podia ser um post
    // só-texto (schema aceita imageUrl OU caption) - contar sem exigir
    // imageUrl inflava "TOTAL_PHOTO_POSTS" com posts que nunca tiveram foto.
    needs.has("TOTAL_PHOTO_POSTS") &&
      prisma.feedPost
        .count({ where: { userId, type: "MANUAL_PHOTO", imageUrl: { not: null } } })
        .then((c) => { stats.totalPhotoPosts = c; }),

    needs.has("DISTINCT_PROVIDERS_TRAINED") &&
      prisma.booking
        .groupBy({
          by: ["providerId"],
          where: { clientId: userId, status: "COMPLETED" },
        })
        .then((rows) => { stats.distinctProviders = rows.length; }),

    (needs.has("WEEKLY_TOP3_REACHED") || needs.has("WEEKLY_1ST_REACHED")) &&
      (async () => {
        const { getWeekKey } = await import("./xp.service");
        const weekKey = getWeekKey(new Date());
        const userSnap = await prisma.rankingSnapshot.findUnique({
          where: { userId_periodType_periodKey: { userId, periodType: "WEEKLY", periodKey: weekKey } },
          select: { xpEarned: true },
        });
        if (!userSnap || userSnap.xpEarned === 0) return;
        const betterCount = await prisma.rankingSnapshot.count({
          where: { periodType: "WEEKLY", periodKey: weekKey, xpEarned: { gt: userSnap.xpEarned } },
        });
        stats.weeklyTop3Reached = betterCount < 3;
        stats.weekly1stReached = betterCount === 0;
      })(),

    needs.has("WEEKLY_TOP3_CONSECUTIVE_WEEKS") &&
      Promise.resolve().then(() => { stats.weeklyTop3ConsecutiveWeeks = 0; }),
  ].filter(Boolean));

  return stats;
}

async function meetsCondition(
  _userId: string,
  conditionType: AchievementConditionType,
  conditionValue: number,
  stats: Stats
): Promise<boolean> {
  switch (conditionType) {
    case "STREAK_SESSIONS":
      return (stats.currentStreak ?? 0) >= conditionValue;
    case "TOTAL_WORKOUTS":
      return (stats.totalWorkouts ?? 0) >= conditionValue;
    case "TOTAL_FOLLOWING":
      return (stats.totalFollowing ?? 0) >= conditionValue;
    case "TOTAL_FOLLOWERS":
      return (stats.totalFollowers ?? 0) >= conditionValue;
    case "TOTAL_REVIEWS_SUBMITTED":
      return (stats.totalReviews ?? 0) >= conditionValue;
    case "TOTAL_PHOTO_POSTS":
      return (stats.totalPhotoPosts ?? 0) >= conditionValue;
    case "DISTINCT_PROVIDERS_TRAINED":
      return (stats.distinctProviders ?? 0) >= conditionValue;
    case "WEEKLY_TOP3_REACHED":
      return stats.weeklyTop3Reached === true;
    case "WEEKLY_1ST_REACHED":
      return stats.weekly1stReached === true;
    case "WEEKLY_TOP3_CONSECUTIVE_WEEKS":
      return (stats.weeklyTop3ConsecutiveWeeks ?? 0) >= conditionValue;
    default:
      return false;
  }
}

export async function getAllAchievements(userId: string) {
  const [allAchievements, userAchievements] = await Promise.all([
    prisma.achievement.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.userAchievement.findMany({
      where: { userId },
      select: { achievementId: true, unlockedAt: true },
    }),
  ]);

  const unlockMap = new Map(userAchievements.map((ua) => [ua.achievementId, ua.unlockedAt]));

  return allAchievements.map((a) => ({
    ...a,
    unlocked: unlockMap.has(a.id),
    unlockedAt: unlockMap.get(a.id) ?? null,
  }));
}
