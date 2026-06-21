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
  await prisma.feedPost.create({
    data: {
      userId,
      type: "MANUAL_PHOTO",
      imageUrl,
      caption,
      isAutomatic: false,
    },
  });

  await awardXp(userId, 10, "POST_WORKOUT_PHOTO");
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

export async function toggleLike(postId: string, userId: string): Promise<{ liked: boolean }> {
  const existing = await prisma.feedPostLike.findUnique({
    where: { postId_userId: { postId, userId } },
  });

  if (existing) {
    await prisma.feedPostLike.delete({ where: { postId_userId: { postId, userId } } });
    return { liked: false };
  }

  const post = await prisma.feedPost.findUnique({ where: { id: postId }, select: { userId: true } });
  if (!post) throw new AppError("Post não encontrado.", StatusCodes.NOT_FOUND);

  await prisma.feedPostLike.create({ data: { postId, userId } });
  return { liked: true };
}

export async function addComment(postId: string, userId: string, content: string) {
  const post = await prisma.feedPost.findUnique({ where: { id: postId }, select: { id: true } });
  if (!post) throw new AppError("Post não encontrado.", StatusCodes.NOT_FOUND);

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

export async function getComments(postId: string, page: number, limit: number) {
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

export async function deleteComment(commentId: string, userId: string): Promise<void> {
  const comment = await prisma.feedPostComment.findUnique({
    where: { id: commentId },
    select: { userId: true },
  });
  if (!comment) throw new AppError("Comentário não encontrado.", StatusCodes.NOT_FOUND);
  if (comment.userId !== userId) throw new AppError("Sem permissão.", StatusCodes.FORBIDDEN);
  await prisma.feedPostComment.delete({ where: { id: commentId } });
}

export async function editComment(commentId: string, userId: string, content: string) {
  const comment = await prisma.feedPostComment.findUnique({
    where: { id: commentId },
    select: { userId: true },
  });
  if (!comment) throw new AppError("Comentário não encontrado.", StatusCodes.NOT_FOUND);
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

export async function deletePost(postId: string, userId: string): Promise<void> {
  const post = await prisma.feedPost.findUnique({ where: { id: postId }, select: { userId: true, isAutomatic: true } });
  if (!post) throw new AppError("Post não encontrado.", StatusCodes.NOT_FOUND);
  if (post.userId !== userId) throw new AppError("Sem permissão.", StatusCodes.FORBIDDEN);
  if (post.isAutomatic) throw new AppError("Posts automáticos não podem ser excluídos.", StatusCodes.FORBIDDEN);

  await prisma.feedPost.delete({ where: { id: postId } });
}
