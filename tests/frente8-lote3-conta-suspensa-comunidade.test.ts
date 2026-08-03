import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { getFeed } from "../src/modules/community/services/feed.service";
import { followUser, getUserPublicProfile, searchUsers } from "../src/modules/community/services/social.service";
import { getRanking } from "../src/modules/community/services/ranking.service";
import { AppError } from "../src/shared/errors/app-error";

// Épico de Frentes, Frente 8 (Comunidade e engajamento pós-treino), Lote 3:
// suspender uma conta (admin.service.ts::suspendUser) só bloqueava o próprio
// login dela - nenhuma consulta da comunidade filtrava suspendedAt, então o
// usuário suspenso continuava 100% visível pra quem já estava logado (feed,
// busca, perfil, follow, ranking).

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let suspendedId = "";
let viewerId = "";
const suspendedName = uid("SuspensoF8L3");
const userIds: string[] = [];
const postIds: string[] = [];

describe("Frente 8, Lote 3 — conta suspensa some da comunidade", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const suspended = await prisma.user.create({
      data: {
        name: suspendedName,
        email: `${uid("f8l3_suspended")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.CLIENT,
        suspendedAt: new Date(),
        suspensionReason: "teste"
      }
    });
    suspendedId = suspended.id;
    userIds.push(suspendedId);

    const viewer = await prisma.user.create({
      data: {
        name: "Visualizador Frente Oito Lote Tres",
        email: `${uid("f8l3_viewer")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: UserRole.CLIENT
      }
    });
    viewerId = viewer.id;
    userIds.push(viewerId);

    // Follow mútuo, criado ANTES da suspensão ser checada (suspender não
    // remove Follow já existente) - simula exatamente o cenário do achado.
    await prisma.follow.createMany({
      data: [
        { followerId: viewerId, followingId: suspendedId },
        { followerId: suspendedId, followingId: viewerId }
      ]
    });

    const post = await prisma.feedPost.create({
      data: { userId: suspendedId, type: "MANUAL_PHOTO", caption: "post do suspenso", isAutomatic: false }
    });
    postIds.push(post.id);
  });

  afterAll(async () => {
    await prisma.follow.deleteMany({ where: { followerId: { in: userIds } } });
    await prisma.feedPost.deleteMany({ where: { id: { in: postIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("post do usuário suspenso some do feed de quem já o seguia", async () => {
    const feed = await getFeed(viewerId, 1, 20);
    expect(feed.items.some((p) => p.id === postIds[0])).toBe(false);
  });

  it("não é possível seguir um usuário suspenso", async () => {
    await expect(followUser(viewerId, suspendedId)).rejects.toBeInstanceOf(AppError);
  });

  it("usuário suspenso não aparece na busca", async () => {
    const result = await searchUsers(viewerId, suspendedName, 1, 20);
    expect(result.items.some((u) => u.id === suspendedId)).toBe(false);
  });

  it("perfil público do usuário suspenso não é acessível", async () => {
    await expect(getUserPublicProfile(viewerId, suspendedId)).rejects.toBeInstanceOf(AppError);
  });

  it("usuário suspenso some do ranking de amigos mesmo com follow mútuo pré-existente", async () => {
    const ranking = await getRanking(viewerId, "WEEKLY", 1, 20);
    expect(ranking.items.some((r) => r.userId === suspendedId)).toBe(false);
  });
});
