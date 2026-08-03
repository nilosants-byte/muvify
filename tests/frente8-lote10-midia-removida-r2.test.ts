import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { createManualPhotoPost, deletePost } from "../src/modules/community/services/feed.service";
import { UserService } from "../src/modules/users/services/user.service";
import { hashValue } from "../src/shared/utils/hash";

// Épico de Frentes, Frente 8 (Comunidade e engajamento pós-treino), Lote 10:
// excluir um post ou uma conta apagava o registro no banco, mas nenhuma
// chamada chegava ao bucket R2 - a imagem ficava órfã pra sempre, ocupando
// espaço/custo indefinidamente. storage.service.ts nunca teve nenhum método
// de delete até este lote.

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

const userService = new UserService();
const PASSWORD = "Test1234";

let clientId = "";

describe("Frente 8, Lote 10 — mídia do post é removida do R2", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const hashed = await hashValue(PASSWORD);
    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Oito Lote Dez",
        email: `${uid("f8l10_client")}@test.com`,
        password: hashed,
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.CLIENT,
        termsAcceptedAt: new Date(),
        privacyPolicyAcceptedAt: new Date(),
        termsVersion: "2026.05"
      }
    });
    clientId = client.id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.feedPost.deleteMany({ where: { userId: clientId } });
    await prisma.userXpTransaction.deleteMany({ where: { userId: clientId } });
    await prisma.user.deleteMany({ where: { id: clientId } });
    await prisma.$disconnect();
  });

  it("excluir um post com foto remove o objeto correspondente do R2", async () => {
    const sendSpy = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);

    const imageUrl = "https://fake-r2-public.test/feed-photos/para-excluir.jpg";
    await createManualPhotoPost(clientId, imageUrl, "post com foto");
    const post = await prisma.feedPost.findFirstOrThrow({ where: { userId: clientId }, orderBy: { createdAt: "desc" } });

    await deletePost(post.id, clientId);

    const deleteCall = sendSpy.mock.calls.find(([cmd]) => cmd instanceof DeleteObjectCommand);
    expect(deleteCall).toBeDefined();
    const input = (deleteCall![0] as DeleteObjectCommand).input;
    expect(input.Key).toBe("feed-photos/para-excluir.jpg");
  });

  it("excluir a conta remove a mídia de todos os posts com foto do usuário", async () => {
    const sendSpy = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);

    await createManualPhotoPost(clientId, "https://fake-r2-public.test/feed-photos/conta-1.jpg", "foto 1");
    await createManualPhotoPost(clientId, "https://fake-r2-public.test/feed-photos/conta-2.jpg", "foto 2");
    await createManualPhotoPost(clientId, undefined, "post só texto, sem foto");

    await userService.deleteMe(clientId, PASSWORD);

    const deletedKeys = sendSpy.mock.calls
      .filter(([cmd]) => cmd instanceof DeleteObjectCommand)
      .map(([cmd]) => (cmd as DeleteObjectCommand).input.Key);

    expect(deletedKeys).toContain("feed-photos/conta-1.jpg");
    expect(deletedKeys).toContain("feed-photos/conta-2.jpg");
    expect(deletedKeys).toHaveLength(2);
  });
});
