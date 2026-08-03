import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { addComment } from "../src/modules/community/services/feed.service";
import { UserService } from "../src/modules/users/services/user.service";
import { hashValue } from "../src/shared/utils/hash";

// Épico de Frentes, Frente 8 (Comunidade e engajamento pós-treino), Lote 14:
// deleteMe apagava os posts do próprio usuário (cascata de likes/comments
// NELES), mas comentários que esse usuário deixou em posts DE OUTRAS
// PESSOAS continuavam intactos com o conteúdo original, atribuídos ao
// registro já anonimizado - inconsistente com o padrão já usado no mesmo
// método pra mensagem/review/textos de solicitação.

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

const userService = new UserService();
const PASSWORD = "Test1234";

let authorId = "";
let commenterId = "";
let postId = "";
let commentId = "";

describe("Frente 8, Lote 14 — excluir conta anonimiza comentários deixados em posts de terceiros", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const author = await prisma.user.create({
      data: {
        name: "Autor Frente Oito Lote Quatorze",
        email: `${uid("f8l14_author")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.CLIENT
      }
    });
    authorId = author.id;

    const hashed = await hashValue(PASSWORD);
    const commenter = await prisma.user.create({
      data: {
        name: "Comentarista Frente Oito Lote Quatorze",
        email: `${uid("f8l14_commenter")}@test.com`,
        password: hashed,
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: UserRole.CLIENT,
        termsAcceptedAt: new Date(),
        privacyPolicyAcceptedAt: new Date(),
        termsVersion: "2026.05"
      }
    });
    commenterId = commenter.id;

    // Precisa seguir o autor pra poder comentar (visibilidade do feed).
    await prisma.follow.create({ data: { followerId: commenterId, followingId: authorId } });

    const post = await prisma.feedPost.create({
      data: { userId: authorId, type: "MANUAL_PHOTO", caption: "post do autor", isAutomatic: false }
    });
    postId = post.id;

    const comment = await addComment(postId, commenterId, "Comentário original que devia sumir");
    commentId = comment.id;
  });

  afterAll(async () => {
    await prisma.feedPostComment.deleteMany({ where: { postId } });
    await prisma.feedPost.deleteMany({ where: { id: postId } });
    await prisma.follow.deleteMany({ where: { followerId: { in: [authorId, commenterId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [authorId, commenterId] } } });
    await prisma.$disconnect();
  });

  it("excluir a conta do comentarista anonimiza o conteúdo do comentário, sem apagar o registro", async () => {
    await userService.deleteMe(commenterId, PASSWORD);

    const comment = await prisma.feedPostComment.findUnique({ where: { id: commentId } });
    expect(comment).not.toBeNull();
    expect(comment!.content).toBe("[Comentário removido]");
    expect(comment!.userId).toBe(commenterId);

    // O post do autor (terceiro) não foi afetado.
    const post = await prisma.feedPost.findUnique({ where: { id: postId } });
    expect(post).not.toBeNull();

    const commentCount = await prisma.feedPostComment.count({ where: { postId } });
    expect(commentCount).toBe(1);
  });
});
