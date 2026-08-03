import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { createManualPhotoPost } from "../src/modules/community/services/feed.service";

// Épico de Frentes, Frente 8 (Comunidade e engajamento pós-treino), Lote 1:
// createPhotoPostSchema aceita imageUrl OU caption, e createManualPhotoPost
// concedia os mesmos 10 XP de "POST_WORKOUT_PHOTO" mesmo num post só-texto,
// sem nenhum vínculo com uma foto de treino real - dava pra farmar XP só
// digitando legenda. Agora só concede XP (e progride a conquista de fotos)
// quando o post de fato tem imageUrl.

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let userId = "";
let achievementId = "";
const postIds: string[] = [];

describe("Frente 8, Lote 1 — post sem foto não ganha XP de foto de treino", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const user = await prisma.user.create({
      data: {
        name: "Cliente Frente Oito Lote Um",
        email: `${uid("f8l1_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.CLIENT
      }
    });
    userId = user.id;

    // Banco de teste não tem a tabela `Achievement` populada (não roda o
    // seed de produção) - cria a conquista mínima necessária pra validar
    // que TOTAL_PHOTO_POSTS só conta post com imageUrl de verdade.
    const achievement = await prisma.achievement.create({
      data: {
        key: uid("f8l1_photos_1"),
        name: "Primeiro Click (teste)",
        description: "Primeira foto pós-treino.",
        category: "VOLUME",
        medalType: "BRONZE",
        xpReward: 10,
        conditionType: "TOTAL_PHOTO_POSTS",
        conditionValue: 1
      }
    });
    achievementId = achievement.id;
  });

  afterAll(async () => {
    await prisma.userAchievement.deleteMany({ where: { userId } });
    await prisma.achievement.deleteMany({ where: { id: achievementId } });
    await prisma.feedPostLike.deleteMany({ where: { userId } });
    await prisma.feedPostComment.deleteMany({ where: { userId } });
    await prisma.userXpTransaction.deleteMany({ where: { userId } });
    await prisma.feedPost.deleteMany({ where: { id: { in: postIds } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("post só-texto (sem imageUrl) não concede XP nem progride a conquista de fotos", async () => {
    await createManualPhotoPost(userId, undefined, "Treinei muito hoje, sem foto");

    const post = await prisma.feedPost.findFirstOrThrow({
      where: { userId },
      orderBy: { createdAt: "desc" }
    });
    postIds.push(post.id);

    const xpTx = await prisma.userXpTransaction.findMany({
      where: { userId, reason: "POST_WORKOUT_PHOTO" }
    });
    expect(xpTx).toHaveLength(0);

    const unlocked = await prisma.userAchievement.findMany({
      where: { userId, achievement: { conditionType: "TOTAL_PHOTO_POSTS" } }
    });
    expect(unlocked).toHaveLength(0);
  });

  it("post com imageUrl real concede os 10 XP e progride a conquista de fotos", async () => {
    await createManualPhotoPost(userId, "https://fake-bucket.r2.dev/feed-photos/foto.jpg", "Com foto de verdade");

    const post = await prisma.feedPost.findFirstOrThrow({
      where: { userId, imageUrl: { not: null } },
      orderBy: { createdAt: "desc" }
    });
    postIds.push(post.id);

    const xpTx = await prisma.userXpTransaction.findFirstOrThrow({
      where: { userId, reason: "POST_WORKOUT_PHOTO", referenceId: post.id }
    });
    expect(xpTx.amount).toBe(10);

    const unlocked = await prisma.userAchievement.findMany({
      where: { userId, achievement: { conditionType: "TOTAL_PHOTO_POSTS" } }
    });
    expect(unlocked.length).toBeGreaterThan(0);
  });
});
