import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { checkAndUnlock } from "../src/modules/gamification/services/achievement.service";
import { getWeekKey } from "../src/modules/gamification/services/xp.service";

// Épico de Frentes, Frente 8 (Comunidade e engajamento pós-treino), Lote 13:
// gatherStats sempre definia weeklyTop3ConsecutiveWeeks = 0 (stub) - as
// conquistas "Dupla Dominância" (2 semanas) e "Dominante" (4 semanas) nunca
// podiam ser desbloqueadas por ninguém. Decisão do usuário: implementar o
// cálculo real usando o histórico de RankingSnapshot.

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function subtractOneWeek(weekKey: string): string {
  const d = new Date(`${weekKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

let userId = "";
const achievementIds: string[] = [];

describe("Frente 8, Lote 13 — conquista de semanas consecutivas no top 3 é alcançável de verdade", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const user = await prisma.user.create({
      data: {
        name: "Cliente Frente Oito Lote Treze",
        email: `${uid("f8l13_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.CLIENT
      }
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.userAchievement.deleteMany({ where: { userId } });
    await prisma.achievement.deleteMany({ where: { id: { in: achievementIds } } });
    await prisma.rankingSnapshot.deleteMany({ where: { userId } });
    await prisma.userXpTransaction.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("2 semanas seguidas no top 3 desbloqueia a conquista de 2 semanas consecutivas", async () => {
    const doubleAch = await prisma.achievement.create({
      data: {
        key: uid("f8l13_double"),
        name: "Dupla Dominância (teste)",
        description: "2 semanas seguidas no top 3.",
        category: "RANKING",
        medalType: "SILVER",
        xpReward: 0,
        conditionType: "WEEKLY_TOP3_CONSECUTIVE_WEEKS",
        conditionValue: 2
      }
    });
    achievementIds.push(doubleAch.id);

    const lastWeek = subtractOneWeek(getWeekKey(new Date()));
    const twoWeeksAgo = subtractOneWeek(lastWeek);

    await prisma.rankingSnapshot.createMany({
      data: [
        { userId, periodType: "WEEKLY", periodKey: lastWeek, xpEarned: 100 },
        { userId, periodType: "WEEKLY", periodKey: twoWeeksAgo, xpEarned: 100 },
      ]
    });

    const unlocked = await checkAndUnlock(userId, ["WEEKLY_TOP3_CONSECUTIVE_WEEKS"]);
    expect(unlocked.some((a) => a.key === doubleAch.key)).toBe(true);
  });

  it("interromper a sequência (buraco numa semana) não desbloqueia a conquista de 4 semanas seguidas", async () => {
    const quadAch = await prisma.achievement.create({
      data: {
        key: uid("f8l13_quad"),
        name: "Dominante (teste)",
        description: "4 semanas seguidas no top 3.",
        category: "RANKING",
        medalType: "GOLD",
        xpReward: 0,
        conditionType: "WEEKLY_TOP3_CONSECUTIVE_WEEKS",
        conditionValue: 4
      }
    });
    achievementIds.push(quadAch.id);

    // As últimas 2 semanas já têm snapshot (do teste anterior). A 3ª semana
    // atrás fica sem snapshot de propósito (buraco), e a 4ª tem - mas a
    // sequência CONSECUTIVA para na semana faltante, então nunca chega a 4.
    const lastWeek = subtractOneWeek(getWeekKey(new Date()));
    const twoWeeksAgo = subtractOneWeek(lastWeek);
    const fourWeeksAgo = subtractOneWeek(subtractOneWeek(twoWeeksAgo));

    await prisma.rankingSnapshot.create({
      data: { userId, periodType: "WEEKLY", periodKey: fourWeeksAgo, xpEarned: 100 }
    });

    const unlocked = await checkAndUnlock(userId, ["WEEKLY_TOP3_CONSECUTIVE_WEEKS"]);
    expect(unlocked.some((a) => a.key === quadAch.key)).toBe(false);
  });
});
