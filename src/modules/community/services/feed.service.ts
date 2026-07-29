import { FeedPostType, Prisma } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { checkAndUnlock } from "../../gamification/services/achievement.service";
import { awardXp } from "../../gamification/services/xp.service";

const POST_SELECT = {
  id: true,
  userId: true,
  type: true,
  referenceId: true,
  imageUrl: true,
  caption: true,
  metadata: true,
  isAutomatic: true,
  createdAt: true,
  user: { select: { id: true, name: true, photoUrl: true } },
  _count: { select: { likes: true, comments: true } },
};

export async function getFeed(viewerId: string, page: number, limit: number) {
  const skip = (page - 1) * limit;

  const following = await prisma.follow.findMany({
    where: { followerId: viewerId, following: { role: "CLIENT" } },
    select: { followingId: true },
  });
  const visibleUserIds = [viewerId, ...following.map((f) => f.followingId)];

  const [posts, total] = await Promise.all([
    prisma.feedPost.findMany({
      where: { userId: { in: visibleUserIds } },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: POST_SELECT,
    }),
    prisma.feedPost.count({ where: { userId: { in: visibleUserIds } } }),
  ]);

  const postIds = posts.map((p) => p.id);
  const viewerLikes = postIds.length
    ? await prisma.feedPostLike.findMany({
        where: { postId: { in: postIds }, userId: viewerId },
        select: { postId: true },
      })
    : [];
  const likedSet = new Set(viewerLikes.map((l) => l.postId));

  return {
    items: posts.map(({ _count, ...p }) => ({
      ...p,
      likesCount: _count.likes,
      commentsCount: _count.comments,
      likedByViewer: likedSet.has(p.id),
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

export async function createManualPhotoPost(
  userId: string,
  imageUrl: string | undefined,
  caption?: string
): Promise<void> {
  const post = await prisma.feedPost.create({
    data: {
      userId,
      type: "MANUAL_PHOTO",
      imageUrl,
      caption,
      isAutomatic: false,
    },
  });

  // Raio-X Muvify, Frente 1 (Autorização/IDOR), Lote 1: referenceId ativa a
  // deduplicação de XP já existente em awardXp — antes, sem esse valor,
  // cada chamada sempre criava uma transação de XP nova.
  await awardXp(userId, 10, "POST_WORKOUT_PHOTO", post.id);
  await checkAndUnlock(userId, ["TOTAL_PHOTO_POSTS"]);
}

export async function createAutoPost(
  userId: string,
  type: FeedPostType,
  options: {
    referenceId?: string;
    imageUrl?: string;
    caption?: string;
    metadata?: Record<string, unknown>;
  } = {}
): Promise<void> {
  // Idempotência: evita posts duplicados para o mesmo (userId, type, referenceId)
  if (options.referenceId) {
    const exists = await prisma.feedPost.findFirst({
      where: { userId, type, referenceId: options.referenceId },
      select: { id: true },
    });
    if (exists) return;
  }

  await prisma.feedPost.create({
    data: {
      userId,
      type,
      referenceId: options.referenceId,
      imageUrl: options.imageUrl,
      caption: options.caption,
      metadata: options.metadata as Prisma.InputJsonObject | undefined,
      isAutomatic: true,
    },
  });
}

// Raio-X Muvify, Frente 1 (Autorização/IDOR), Lote 1: getFeed só mostra
// posts do próprio usuário e de quem ele segue, mas toggleLike/addComment/
// getComments só checavam se o post existia — um postId vazado por
// qualquer canal permitia curtir/comentar/ler comentários fora do feed do
// usuário. Mesmo critério de visibilidade do getFeed, aplicado por post.
async function assertPostVisibleToViewer(authorId: string, viewerId: string): Promise<void> {
  if (authorId === viewerId) return;
  const follows = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: viewerId, followingId: authorId } },
  });
  if (!follows) {
    throw new AppError("Post não encontrado.", StatusCodes.NOT_FOUND);
  }
}

export async function toggleLike(postId: string, userId: string): Promise<{ liked: boolean }> {
  const post = await prisma.feedPost.findUnique({ where: { id: postId }, select: { userId: true } });
  if (!post) throw new AppError("Post não encontrado.", StatusCodes.NOT_FOUND);
  await assertPostVisibleToViewer(post.userId, userId);

  const existing = await prisma.feedPostLike.findUnique({
    where: { postId_userId: { postId, userId } },
  });

  if (existing) {
    await prisma.feedPostLike.delete({ where: { postId_userId: { postId, userId } } });
    return { liked: false };
  }

  await prisma.feedPostLike.create({ data: { postId, userId } });
  return { liked: true };
}

export async function addComment(postId: string, userId: string, content: string) {
  const post = await prisma.feedPost.findUnique({ where: { id: postId }, select: { userId: true } });
  if (!post) throw new AppError("Post não encontrado.", StatusCodes.NOT_FOUND);
  await assertPostVisibleToViewer(post.userId, userId);

  return prisma.feedPostComment.create({
    data: { postId, userId, content },
    select: {
      id: true,
      content: true,
      createdAt: true,
      user: { select: { id: true, name: true, photoUrl: true } },
    },
  });
}

export async function getComments(postId: string, viewerId: string, page: number, limit: number) {
  const post = await prisma.feedPost.findUnique({ where: { id: postId }, select: { userId: true } });
  if (!post) throw new AppError("Post não encontrado.", StatusCodes.NOT_FOUND);
  await assertPostVisibleToViewer(post.userId, viewerId);

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    prisma.feedPostComment.findMany({
      where: { postId },
      orderBy: { createdAt: "asc" },
      skip,
      take: limit,
      select: {
        id: true,
        content: true,
        createdAt: true,
        user: { select: { id: true, name: true, photoUrl: true } },
      },
    }),
    prisma.feedPostComment.count({ where: { postId } }),
  ]);

  return { items, total, page, totalPages: Math.ceil(total / limit) };
}

// Raio-X Muvify, Frente 1 (Autorização/IDOR), Lote 2: a rota exige postId
// no path (commentIdParamSchema), mas o service nunca cruzava esse valor
// com o comentário — cosmético (a checagem de dono do comentário já era
// correta), mas fecha a inconsistência.
export async function deleteComment(postId: string, commentId: string, userId: string): Promise<void> {
  const comment = await prisma.feedPostComment.findUnique({
    where: { id: commentId },
    select: { userId: true, postId: true },
  });
  if (!comment || comment.postId !== postId) throw new AppError("Comentário não encontrado.", StatusCodes.NOT_FOUND);
  if (comment.userId !== userId) throw new AppError("Sem permissão.", StatusCodes.FORBIDDEN);
  await prisma.feedPostComment.delete({ where: { id: commentId } });
}

export async function editComment(postId: string, commentId: string, userId: string, content: string) {
  const comment = await prisma.feedPostComment.findUnique({
    where: { id: commentId },
    select: { userId: true, postId: true },
  });
  if (!comment || comment.postId !== postId) throw new AppError("Comentário não encontrado.", StatusCodes.NOT_FOUND);
  if (comment.userId !== userId) throw new AppError("Sem permissão.", StatusCodes.FORBIDDEN);
  return prisma.feedPostComment.update({
    where: { id: commentId },
    data: { content },
    select: {
      id: true,
      content: true,
      createdAt: true,
      user: { select: { id: true, name: true, photoUrl: true } },
    },
  });
}

// Raio-X Muvify, Frente 1 (Autorização/IDOR), Lote 1: janela curta o
// suficiente pra pegar o padrão "cria e apaga na hora" de quem tá farmando
// XP, mas não penalizar quem apaga um post antigo por limpeza normal —
// esse já "valeu a pena" pro engajamento real.
const XP_FARM_REVERSAL_WINDOW_MS = 10 * 60 * 1000;

export async function deletePost(postId: string, userId: string): Promise<void> {
  const post = await prisma.feedPost.findUnique({
    where: { id: postId },
    select: { userId: true, isAutomatic: true, type: true, createdAt: true },
  });
  if (!post) throw new AppError("Post não encontrado.", StatusCodes.NOT_FOUND);
  if (post.userId !== userId) throw new AppError("Sem permissão.", StatusCodes.FORBIDDEN);
  if (post.isAutomatic) throw new AppError("Posts automáticos não podem ser excluídos.", StatusCodes.FORBIDDEN);

  await prisma.feedPost.delete({ where: { id: postId } });

  if (post.type === "MANUAL_PHOTO" && Date.now() - post.createdAt.getTime() < XP_FARM_REVERSAL_WINDOW_MS) {
    await prisma.userXpTransaction.deleteMany({
      where: { userId, reason: "POST_WORKOUT_PHOTO", referenceId: postId },
    });
  }
}
