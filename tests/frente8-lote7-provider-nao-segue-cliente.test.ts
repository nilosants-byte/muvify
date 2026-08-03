import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { followUser } from "../src/modules/community/services/social.service";
import { AppError } from "../src/shared/errors/app-error";

// Épico de Frentes, Frente 8 (Comunidade e engajamento pós-treino), Lote 7:
// followUser só validava o role de quem ERA seguido (precisa ser CLIENT),
// nunca o de quem está seguindo - um profissional podia seguir um cliente e
// ler o feed dele via getFeed, mas getFollowers só lista seguidores CLIENT,
// então o profissional nunca aparecia na lista de seguidores do cliente -
// canal de vigilância silenciosa.

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let providerUserId = "";
let clientAId = "";
let clientBId = "";
const userIds: string[] = [];

describe("Frente 8, Lote 7 — comunidade é exclusiva para clientes no follow", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Oito Lote Sete",
        email: `${uid("f8l7_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;
    userIds.push(providerUserId);

    const clientA = await prisma.user.create({
      data: {
        name: "Cliente A Frente Oito Lote Sete",
        email: `${uid("f8l7_clienta")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: UserRole.CLIENT
      }
    });
    clientAId = clientA.id;
    userIds.push(clientAId);

    const clientB = await prisma.user.create({
      data: {
        name: "Cliente B Frente Oito Lote Sete",
        email: `${uid("f8l7_clientb")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}3`,
        role: UserRole.CLIENT
      }
    });
    clientBId = clientB.id;
    userIds.push(clientBId);
  });

  afterAll(async () => {
    await prisma.follow.deleteMany({ where: { followerId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("profissional não consegue seguir um cliente", async () => {
    await expect(followUser(providerUserId, clientAId)).rejects.toBeInstanceOf(AppError);

    const follow = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: providerUserId, followingId: clientAId } }
    });
    expect(follow).toBeNull();
  });

  it("cliente seguindo cliente continua funcionando normalmente", async () => {
    await followUser(clientAId, clientBId);

    const follow = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: clientAId, followingId: clientBId } }
    });
    expect(follow).not.toBeNull();
  });
});
