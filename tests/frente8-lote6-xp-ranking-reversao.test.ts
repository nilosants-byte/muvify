import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { createManualPhotoPost, deletePost } from "../src/modules/community/services/feed.service";
import { getWeekKey, getMonthKey } from "../src/modules/gamification/services/xp.service";

// Épico de Frentes, Frente 8 (Comunidade e engajamento pós-treino), Lote 6:
// excluir um post "farm" dentro da janela de 10min revertia o XP da
// UserXpTransaction (sumia do perfil) mas nunca descontava o mesmo valor do
// RankingSnapshot - o ranking ficava inflado pra sempre com XP que o perfil
// já não tinha mais.

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let userId = "";

describe("Frente 8, Lote 6 — reverter XP de post também desconta do ranking", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const user = await prisma.user.create({
      data: {
        name: "Cliente Frente Oito Lote Seis",
        email: `${uid("f8l6_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.CLIENT
      }
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.rankingSnapshot.deleteMany({ where: { userId } });
    await prisma.userXpTransaction.deleteMany({ where: { userId } });
    await prisma.feedPost.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("excluir o post dentro da janela zera o XP no perfil E no ranking (semanal/mensal/all-time)", async () => {
    const now = new Date();
    const weekKey = getWeekKey(now);
    const monthKey = getMonthKey(now);

    await createManualPhotoPost(userId, "https://fake-bucket.r2.dev/feed-photos/foto.jpg", "com foto");

    const post = await prisma.feedPost.findFirstOrThrow({
      where: { userId },
      orderBy: { createdAt: "desc" }
    });

    // Mede a diferença, não o total: uma conquista temporária de outro arquivo rodando
    // em paralelo (frente8-lote1) pode dar XP extra a este usuário pela mesma foto.
    const postXp = await prisma.userXpTransaction.aggregate({
      where: { userId, reason: "POST_WORKOUT_PHOTO", referenceId: post.id },
      _sum: { amount: true }
    });
    expect(postXp._sum.amount ?? 0).toBe(10);

    const totalXp = async () =>
      (await prisma.userXpTransaction.aggregate({ where: { userId }, _sum: { amount: true } }))._sum.amount ?? 0;
    const rankingXp = async () => {
      const rows = await Promise.all([
        prisma.rankingSnapshot.findUnique({ where: { userId_periodType_periodKey: { userId, periodType: "WEEKLY", periodKey: weekKey } } }),
        prisma.rankingSnapshot.findUnique({ where: { userId_periodType_periodKey: { userId, periodType: "MONTHLY", periodKey: monthKey } } }),
        prisma.rankingSnapshot.findUnique({ where: { userId_periodType_periodKey: { userId, periodType: "ALLTIME", periodKey: "alltime" } } }),
      ]);
      return rows.map((row) => row?.xpEarned ?? 0);
    };

    const xpBefore = await totalXp();
    const rankingBefore = await rankingXp();
    for (const xp of rankingBefore) expect(xp).toBeGreaterThanOrEqual(10);

    await deletePost(post.id, userId);

    expect(await totalXp()).toBe(xpBefore - 10);
    expect(await rankingXp()).toEqual(rankingBefore.map((xp) => xp - 10));
  });
});
