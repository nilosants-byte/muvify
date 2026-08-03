import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { getFeed, reportPost } from "../src/modules/community/services/feed.service";
import { AppError } from "../src/shared/errors/app-error";

// Épico de Frentes, Frente 8 (Comunidade e engajamento pós-treino), Lote 2:
// o botão "Denunciar" do app não chamava nenhuma API - nada era persistido,
// e ninguém via a denúncia. Agora ela é registrada de verdade e o post
// denunciado some do feed de quem denunciou (só dele, não dos demais
// seguidores).

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let authorId = "";
let reporterId = "";
let otherFollowerId = "";
const userIds: string[] = [];
const postIds: string[] = [];

describe("Frente 8, Lote 2 — denúncia de post é persistida e some do feed de quem denunciou", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const author = await prisma.user.create({
      data: {
        name: "Autor Frente Oito Lote Dois",
        email: `${uid("f8l2_author")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.CLIENT
      }
    });
    authorId = author.id;
    userIds.push(authorId);

    const reporter = await prisma.user.create({
      data: {
        name: "Denunciante Frente Oito Lote Dois",
        email: `${uid("f8l2_reporter")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: UserRole.CLIENT
      }
    });
    reporterId = reporter.id;
    userIds.push(reporterId);

    const otherFollower = await prisma.user.create({
      data: {
        name: "Outro Seguidor Frente Oito Lote Dois",
        email: `${uid("f8l2_other")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}3`,
        role: UserRole.CLIENT
      }
    });
    otherFollowerId = otherFollower.id;
    userIds.push(otherFollowerId);

    await prisma.follow.createMany({
      data: [
        { followerId: reporterId, followingId: authorId },
        { followerId: otherFollowerId, followingId: authorId }
      ]
    });
  });

  afterAll(async () => {
    await prisma.feedPostReport.deleteMany({ where: { reporterId: { in: userIds } } });
    await prisma.follow.deleteMany({ where: { followerId: { in: userIds } } });
    await prisma.feedPost.deleteMany({ where: { id: { in: postIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("denunciar um post persiste o registro e some só do feed de quem denunciou", async () => {
    const post = await prisma.feedPost.create({
      data: { userId: authorId, type: "MANUAL_PHOTO", caption: "post pra denunciar", isAutomatic: false }
    });
    postIds.push(post.id);

    await reportPost(post.id, reporterId);

    const report = await prisma.feedPostReport.findUnique({
      where: { postId_reporterId: { postId: post.id, reporterId } }
    });
    expect(report).not.toBeNull();

    const reporterFeed = await getFeed(reporterId, 1, 20);
    expect(reporterFeed.items.some((p) => p.id === post.id)).toBe(false);

    const otherFeed = await getFeed(otherFollowerId, 1, 20);
    expect(otherFeed.items.some((p) => p.id === post.id)).toBe(true);
  });

  it("denunciar o mesmo post duas vezes não duplica nem quebra", async () => {
    const post = await prisma.feedPost.create({
      data: { userId: authorId, type: "MANUAL_PHOTO", caption: "post pra denunciar 2x", isAutomatic: false }
    });
    postIds.push(post.id);

    await reportPost(post.id, reporterId, "spam");
    await reportPost(post.id, reporterId, "spam de novo");

    const reports = await prisma.feedPostReport.findMany({ where: { postId: post.id, reporterId } });
    expect(reports).toHaveLength(1);
  });

  it("não é possível denunciar o próprio post", async () => {
    const post = await prisma.feedPost.create({
      data: { userId: authorId, type: "MANUAL_PHOTO", caption: "meu próprio post", isAutomatic: false }
    });
    postIds.push(post.id);

    await expect(reportPost(post.id, authorId)).rejects.toBeInstanceOf(AppError);
  });
});
