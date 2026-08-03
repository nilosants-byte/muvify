import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { checkAndUnlock } from "../src/modules/gamification/services/achievement.service";
import { onStreakMilestone } from "../src/modules/gamification/services/gamification-events.service";

// Épico de Frentes, Frente 8 (Comunidade e engajamento pós-treino), Lote 12:
// nível, streak, conquista e ranking não geravam push nenhum (só o FeedPost
// automático, visto só se o usuário abrisse a aba Comunidade). O único push
// existente (novo seguidor) não passava preferenceType - sem categoria, o
// filtro de preferência é pulado por completo. Nova categoria COMMUNITY
// aplicada em todos esses pushes.

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function createUser(name: string) {
  const user = await prisma.user.create({
    data: {
      name,
      email: `${uid("f8l12")}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}`,
      role: UserRole.CLIENT
    }
  });
  return user.id;
}

let achievementId = "";
const userIds: string[] = [];

describe("Frente 8, Lote 12 — notificações de gamificação respeitam a preferência COMMUNITY", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const achievement = await prisma.achievement.create({
      data: {
        key: uid("f8l12_ach"),
        name: "Conquista de teste",
        description: "teste",
        category: "VOLUME",
        medalType: "BRONZE",
        xpReward: 10,
        conditionType: "TOTAL_FOLLOWING",
        conditionValue: 1
      }
    });
    achievementId = achievement.id;
  });

  afterAll(async () => {
    await prisma.userNotification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.notificationPreference.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userAchievement.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.achievement.deleteMany({ where: { id: achievementId } });
    await prisma.follow.deleteMany({ where: { followerId: { in: userIds } } });
    await prisma.userXpTransaction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("desbloquear conquista notifica o usuário (categoria COMMUNITY)", async () => {
    const userId = await createUser("Usuário Conquista Frente Oito Lote Doze");
    userIds.push(userId);
    const someoneToFollow = await createUser("Alguém pra seguir Frente Oito Lote Doze");
    userIds.push(someoneToFollow);
    await prisma.follow.create({ data: { followerId: userId, followingId: someoneToFollow } });

    const unlocked = await checkAndUnlock(userId, ["TOTAL_FOLLOWING"]);
    expect(unlocked.length).toBeGreaterThan(0);

    const notifications = await prisma.userNotification.findMany({ where: { userId } });
    const achievementNotif = notifications.find((n) => (n.data as any)?.type === "ACHIEVEMENT_UNLOCKED");
    expect(achievementNotif).toBeDefined();
  });

  it("usuário com preferência COMMUNITY desativada não recebe push de conquista", async () => {
    const userId = await createUser("Usuário Sem Push Frente Oito Lote Doze");
    userIds.push(userId);
    const someoneToFollow = await createUser("Alguém pra seguir 2 Frente Oito Lote Doze");
    userIds.push(someoneToFollow);
    await prisma.notificationPreference.create({
      data: { userId, type: "COMMUNITY", enabled: false }
    });
    await prisma.follow.create({ data: { followerId: userId, followingId: someoneToFollow } });

    const unlocked = await checkAndUnlock(userId, ["TOTAL_FOLLOWING"]);
    expect(unlocked.length).toBeGreaterThan(0);

    const notifications = await prisma.userNotification.findMany({ where: { userId } });
    const achievementNotif = notifications.find((n) => (n.data as any)?.type === "ACHIEVEMENT_UNLOCKED");
    expect(achievementNotif).toBeUndefined();
  });

  it("marco de streak notifica o usuário (categoria COMMUNITY), respeitando a preferência desativada", async () => {
    const userWithPush = await createUser("Usuário Streak Com Push Frente Oito Lote Doze");
    userIds.push(userWithPush);
    const userWithoutPush = await createUser("Usuário Streak Sem Push Frente Oito Lote Doze");
    userIds.push(userWithoutPush);
    await prisma.notificationPreference.create({
      data: { userId: userWithoutPush, type: "COMMUNITY", enabled: false }
    });

    await onStreakMilestone(userWithPush, 15);
    await onStreakMilestone(userWithoutPush, 15);

    const [withPushNotifs, withoutPushNotifs] = await Promise.all([
      prisma.userNotification.findMany({ where: { userId: userWithPush } }),
      prisma.userNotification.findMany({ where: { userId: userWithoutPush } }),
    ]);

    expect(withPushNotifs.some((n) => (n.data as any)?.type === "STREAK_MILESTONE")).toBe(true);
    expect(withoutPushNotifs.some((n) => (n.data as any)?.type === "STREAK_MILESTONE")).toBe(false);
  });
});
