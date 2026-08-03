import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { toggleLike } from "../src/modules/community/services/feed.service";
import { getGeneralRanking } from "../src/modules/community/services/ranking.service";
import { getWeekKey } from "../src/modules/gamification/services/xp.service";

// Épico de Frentes, Frente 8 (Comunidade e engajamento pós-treino), Lote 16:
// polish restante - toggleLike sem proteção contra corrida (find-then-write
// não atômico, colisão no @@unique vazava erro cru) e ranking geral
// inexistente (só havia o "de amigos", filtrado por seguidores mútuos).

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let authorId = "";
let likerId = "";
let postId = "";
const rankingUserIds: string[] = [];

describe("Frente 8, Lote 16 — polish restante", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const author = await prisma.user.create({
      data: {
        name: "Autor Frente Oito Lote Dezesseis",
        email: `${uid("f8l16_author")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.CLIENT
      }
    });
    authorId = author.id;

    const liker = await prisma.user.create({
      data: {
        name: "Curtidor Frente Oito Lote Dezesseis",
        email: `${uid("f8l16_liker")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: UserRole.CLIENT
      }
    });
    likerId = liker.id;
    await prisma.follow.create({ data: { followerId: likerId, followingId: authorId } });

    const post = await prisma.feedPost.create({
      data: { userId: authorId, type: "MANUAL_PHOTO", caption: "post pra curtir", isAutomatic: false }
    });
    postId = post.id;
  });

  afterAll(async () => {
    await prisma.feedPostLike.deleteMany({ where: { postId } });
    await prisma.feedPost.deleteMany({ where: { id: postId } });
    await prisma.follow.deleteMany({ where: { followerId: likerId } });
    await prisma.rankingSnapshot.deleteMany({ where: { userId: { in: rankingUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [authorId, likerId, ...rankingUserIds] } } });
    await prisma.$disconnect();
  });

  it("toggleLike sob concorrência (2 chamadas quase simultâneas) não gera erro não tratado", async () => {
    const results = await Promise.allSettled([
      toggleLike(postId, likerId),
      toggleLike(postId, likerId),
    ]);

    // Nenhuma das duas deve rejeitar com erro cru do Prisma - ambas
    // resolvem (uma curte, a outra vê o resultado já consolidado).
    for (const r of results) {
      expect(r.status).toBe("fulfilled");
    }

    // Estado final é consistente: no máximo 1 curtida registrada.
    const likeCount = await prisma.feedPostLike.count({ where: { postId, userId: likerId } });
    expect(likeCount).toBeLessThanOrEqual(1);
  });

  it("ranking geral retorna os usuários com mais XP no período, sem exigir follow mútuo", async () => {
    const weekKey = getWeekKey(new Date());

    const userA = await prisma.user.create({
      data: {
        name: "Ranking Geral A Frente Oito Lote Dezesseis",
        email: `${uid("f8l16_rank_a")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}3`,
        role: UserRole.CLIENT
      }
    });
    rankingUserIds.push(userA.id);

    const userB = await prisma.user.create({
      data: {
        name: "Ranking Geral B Frente Oito Lote Dezesseis",
        email: `${uid("f8l16_rank_b")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}4`,
        role: UserRole.CLIENT
      }
    });
    rankingUserIds.push(userB.id);

    // userA e userB não se seguem entre si nem seguem o viewer - um
    // ranking "de amigos" (getRanking) nunca os mostraria juntos.
    await prisma.rankingSnapshot.createMany({
      data: [
        { userId: userA.id, periodType: "WEEKLY", periodKey: weekKey, xpEarned: 500 },
        { userId: userB.id, periodType: "WEEKLY", periodKey: weekKey, xpEarned: 300 },
      ]
    });

    const result = await getGeneralRanking(authorId, "WEEKLY", 1, 50);
    const ids = result.items.map((i) => i.userId);
    expect(ids).toContain(userA.id);
    expect(ids).toContain(userB.id);

    const posA = result.items.find((i) => i.userId === userA.id)!.position;
    const posB = result.items.find((i) => i.userId === userB.id)!.position;
    expect(posA).toBeLessThan(posB);
  });
});
