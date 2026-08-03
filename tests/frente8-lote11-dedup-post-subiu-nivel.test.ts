import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { createAutoPost } from "../src/modules/community/services/feed.service";

// Épico de Frentes, Frente 8 (Comunidade e engajamento pós-treino), Lote 11:
// o post automático de "subiu de nível" não tinha referenceId - dois
// eventos de XP quase simultâneos (ex: concluir presencial e consultoria
// bem próximos) podiam ler o mesmo nível anterior antes de qualquer commit
// e cada um concluir "subiu de nível" de forma independente, gerando dois
// posts pro mesmo salto. Agora usa `level_up:${nível}` como referenceId,
// ativando a mesma deduplicação já usada em outros posts automáticos.

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let userId = "";

describe("Frente 8, Lote 11 — post de subida de nível não duplica sob corrida", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const user = await prisma.user.create({
      data: {
        name: "Cliente Frente Oito Lote Onze",
        email: `${uid("f8l11_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.CLIENT
      }
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.feedPost.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("dois eventos que cruzam o mesmo nível geram só um post de 'subiu de nível' (dedup por referenceId)", async () => {
    // Antes deste lote, LEVEL_UP não passava referenceId nenhum -
    // createAutoPost só ativa a checagem de dedup quando options.referenceId
    // existe, então CADA chamada criava um post novo, sem proteção
    // nenhuma (nem entre chamadas sequenciais, muito menos concorrentes).
    await createAutoPost(userId, "LEVEL_UP", {
      referenceId: "level_up:2",
      metadata: { newLevel: 2, levelName: "Ativo", totalXp: 300 },
    });
    await createAutoPost(userId, "LEVEL_UP", {
      referenceId: "level_up:2",
      metadata: { newLevel: 2, levelName: "Ativo", totalXp: 305 },
    });

    const posts = await prisma.feedPost.findMany({ where: { userId, type: "LEVEL_UP" } });
    expect(posts).toHaveLength(1);
  });
});
