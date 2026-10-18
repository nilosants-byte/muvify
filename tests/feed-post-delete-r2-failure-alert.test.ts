import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// @sentry/node é ESM com exports não-configuráveis - vi.mock + vi.hoisted,
// mesmo padrão de tests/frente13-lote5-data-retention-partial-failure.test.ts.
const { captureExceptionMock } = vi.hoisted(() => ({ captureExceptionMock: vi.fn() }));
vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
  captureMessage: vi.fn(),
  setUser: vi.fn(),
  setTag: vi.fn()
}));

import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { createManualPhotoPost, deletePost } from "../src/modules/community/services/feed.service";

// Teste manual do checklist (17/10/2026): excluir um post apaga a foto do R2
// em best effort (tests/frente8-lote10-midia-removida-r2.test.ts), mas se
// essa chamada falhasse o erro só ia pro console do servidor - o post sumia
// do app e a foto podia continuar no ar no link público sem alerta nenhum.

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";

describe("excluir post — falha ao apagar a foto no R2 gera alerta", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const client = await prisma.user.create({
      data: {
        name: "Cliente Alerta R2 Post",
        email: `${uid("feed_r2_alert")}@test.com`,
        password: "hash-irrelevante",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: UserRole.CLIENT,
        termsAcceptedAt: new Date(),
        privacyPolicyAcceptedAt: new Date(),
        termsVersion: "2026.05"
      }
    });
    clientId = client.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    captureExceptionMock.mockClear();
  });

  afterAll(async () => {
    await prisma.feedPost.deleteMany({ where: { userId: clientId } });
    await prisma.userXpTransaction.deleteMany({ where: { userId: clientId } });
    await prisma.rankingSnapshot.deleteMany({ where: { userId: clientId } });
    await prisma.user.deleteMany({ where: { id: clientId } });
    await prisma.$disconnect();
  });

  it("R2 fora do ar: o post é excluído mesmo assim e a falha chega ao Sentry", async () => {
    const r2Error = new Error("R2 indisponível");
    vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command: unknown) => {
      if (command instanceof DeleteObjectCommand) throw r2Error;
      return {} as never;
    });

    await createManualPhotoPost(clientId, "https://fake-r2-public.test/feed-photos/falha-ao-apagar.jpg", "post com foto");
    const post = await prisma.feedPost.findFirstOrThrow({ where: { userId: clientId }, orderBy: { createdAt: "desc" } });

    await expect(deletePost(post.id, clientId)).resolves.toBeUndefined();

    expect(await prisma.feedPost.findUnique({ where: { id: post.id } })).toBeNull();
    expect(captureExceptionMock).toHaveBeenCalledWith(
      r2Error,
      expect.objectContaining({
        tags: expect.objectContaining({ area: "community", phase: "post_deletion_r2_cleanup" }),
        extra: expect.objectContaining({ postId: post.id })
      })
    );
  });

  it("R2 funcionando: nenhum alerta", async () => {
    vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);

    await createManualPhotoPost(clientId, "https://fake-r2-public.test/feed-photos/apaga-normal.jpg", "post com foto");
    const post = await prisma.feedPost.findFirstOrThrow({ where: { userId: clientId }, orderBy: { createdAt: "desc" } });

    await deletePost(post.id, clientId);

    expect(await prisma.feedPost.findUnique({ where: { id: post.id } })).toBeNull();
    expect(captureExceptionMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tags: expect.objectContaining({ phase: "post_deletion_r2_cleanup" }) })
    );
  });
});
