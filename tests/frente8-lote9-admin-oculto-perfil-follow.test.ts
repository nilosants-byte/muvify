import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { UserRole } from "@prisma/client";
import { env } from "../src/config/env";
import { prisma } from "../src/config/prisma";
import { followUser, getUserPublicProfile } from "../src/modules/community/services/social.service";
import { AppError } from "../src/shared/errors/app-error";

// Épico de Frentes, Frente 8 (Comunidade e engajamento pós-treino), Lote 9:
// buscas/sugestões já ocultavam contas admin corretamente (hiddenFromCommunity,
// correção documentada no próprio código), mas o perfil público e o follow
// por ID direto só checavam role === CLIENT, sem aplicar o mesmo filtro -
// dava pra ver o perfil de um admin ou segui-lo diretamente por ID.

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let adminDisguisedId = "";
let clientId = "";
const userIds: string[] = [];

describe("Frente 8, Lote 9 — conta admin não é acessível por ID direto na comunidade", () => {
  beforeAll(async () => {
    await prisma.$connect();

    if (env.ADMIN_ALLOWED_EMAILS.length === 0) {
      throw new Error("ADMIN_ALLOWED_EMAILS precisa estar configurado no ambiente de teste para este teste fazer sentido.");
    }

    // "Admin disfarçado de CLIENT" - mesma modelagem descrita no comentário
    // de hiddenFromCommunity() em social.service.ts. O e-mail admin real já
    // pode existir no banco de teste (fixture compartilhada por outros
    // testes) - reaproveita se já existir, só cria (e só apaga depois) se
    // for de fato novo.
    const existingAdmin = await prisma.user.findUnique({ where: { email: env.ADMIN_ALLOWED_EMAILS[0] } });
    if (existingAdmin) {
      adminDisguisedId = existingAdmin.id;
    } else {
      const adminUser = await prisma.user.create({
        data: {
          name: "Admin Disfarcado Frente Oito Lote Nove",
          email: env.ADMIN_ALLOWED_EMAILS[0],
          password: "x",
          phone: `11${Date.now().toString().slice(-9)}1`,
          role: UserRole.CLIENT
        }
      });
      adminDisguisedId = adminUser.id;
      userIds.push(adminDisguisedId);
    }

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Oito Lote Nove",
        email: `${uid("f8l9_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: UserRole.CLIENT
      }
    });
    clientId = client.id;
    userIds.push(clientId);
  });

  afterAll(async () => {
    await prisma.follow.deleteMany({ where: { followerId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("não é possível ver o perfil público de uma conta admin por ID direto", async () => {
    await expect(getUserPublicProfile(clientId, adminDisguisedId)).rejects.toBeInstanceOf(AppError);
  });

  it("não é possível seguir uma conta admin por ID direto", async () => {
    await expect(followUser(clientId, adminDisguisedId)).rejects.toBeInstanceOf(AppError);

    const follow = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: clientId, followingId: adminDisguisedId } }
    });
    expect(follow).toBeNull();
  });
});
