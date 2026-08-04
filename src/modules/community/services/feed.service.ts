import { FeedPostType, Prisma } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { checkAndUnlock } from "../../gamification/services/achievement.service";
import { awardXp, getMonthKey, getWeekKey } from "../../gamification/services/xp.service";
import { deleteMediaByUrl } from "../../../shared/services/storage.service";

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

  // Épico de Frentes, Frente 8, Lote 3: suspender uma conta não removia o
  // Follow já existente, e a checagem de role nunca olhava suspendedAt -
  // posts de um usuário suspenso continuavam aparecendo indefinidamente
  // pra quem já o seguia.
  const following = await prisma.follow.findMany({
    where: { followerId: viewerId, following: { role: "CLIENT", suspendedAt: null } },
    select: { followingId: true },
  });
  const visibleUserIds = [viewerId, ...following.map((f) => f.followingId)];

  // Épico de Frentes, Frente 8, Lote 2: post denunciado passa a sumir do
  // feed de quem denunciou (sem afetar a visão de outros seguidores) - o
  // "Denunciar" do app não fazia nada até este lote.
  // Frente 10, Lote 1: post ocultado por um admin (denúncia procedente)
  // some pra todo mundo, não só pra quem denunciou.
  const where = {
    userId: { in: visibleUserIds },
    reports: { none: { reporterId: viewerId } },
    hiddenByAdminAt: null,
  };

  const [posts, total] = await Promise.all([
    prisma.feedPost.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: POST_SELECT,
    }),
    prisma.feedPost.count({ where }),
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

  // Épico de Frentes, Frente 8, Lote 1: o schema aceita imageUrl OU
  // caption, então um post só-texto (sem nenhuma foto de treino de
  // verdade) chegava a ganhar o mesmo XP de "postou foto do treino" — dava
  // pra farmar XP só digitando legenda, sem nenhum vínculo com um treino
  // real. Post só-texto continua permitido, só não concede mais esse XP.
  if (imageUrl) {
    // Raio-X Muvify, Frente 1 (Autorização/IDOR), Lote 1: referenceId ativa a
    // deduplicação de XP já existente em awardXp — antes, sem esse valor,
    // cada chamada sempre criava uma transação de XP nova.
    await awardXp(userId, 10, "POST_WORKOUT_PHOTO", post.id);
    await checkAndUnlock(userId, ["TOTAL_PHOTO_POSTS"]);
  }
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
async function assertFollowsOrOwnsPost(authorId: string, viewerId: string): Promise<void> {
  if (authorId === viewerId) return;
  const follows = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: viewerId, followingId: authorId } },
  });
  if (!follows) {
    throw new AppError("Post não encontrado.", StatusCodes.NOT_FOUND);
  }
  // Épico de Frentes, Frente 8, Lote 3: suspender o autor não invalida o
  // Follow já existente - sem essa checagem, curtir/comentar/ler um post
  // dele continuava funcionando via postId direto mesmo depois de sumir do
  // getFeed (que já filtra suspendedAt).
  const author = await prisma.user.findUnique({ where: { id: authorId }, select: { suspendedAt: true } });
  if (author?.suspendedAt) {
    throw new AppError("Post não encontrado.", StatusCodes.NOT_FOUND);
  }
}

// Épico de Frentes, Frente 8, Lote 2: mesmo critério de "sumiu do feed"
// aplicado individualmente por post - sem isso, curtir/comentar/ler um post
// já denunciado continuava funcionando normalmente mesmo depois dele sumir
// da listagem principal.
async function assertNotReportedByViewer(postId: string, viewerId: string): Promise<void> {
  const reported = await prisma.feedPostReport.findUnique({
    where: { postId_reporterId: { postId, reporterId: viewerId } },
  });
  if (reported) {
    throw new AppError("Post não encontrado.", StatusCodes.NOT_FOUND);
  }
}

// Épico de Frentes, Frente 10, Lote 1: post ocultado por um admin (denúncia
// procedente) precisa desaparecer de curtir/comentar/ler comentários pra
// todo mundo, não só da listagem principal do feed - mesmo raciocínio já
// aplicado a post denunciado (assertNotReportedByViewer, por viewer) e a
// post de autor suspenso (assertFollowsOrOwnsPost).
async function assertNotHiddenByAdmin(postId: string): Promise<void> {
  const post = await prisma.feedPost.findUnique({ where: { id: postId }, select: { hiddenByAdminAt: true } });
  if (post?.hiddenByAdminAt) {
    throw new AppError("Post não encontrado.", StatusCodes.NOT_FOUND);
  }
}

async function assertPostVisibleToViewer(postId: string, authorId: string, viewerId: string): Promise<void> {
  await assertFollowsOrOwnsPost(authorId, viewerId);
  await assertNotReportedByViewer(postId, viewerId);
  await assertNotHiddenByAdmin(postId);
}

export async function toggleLike(postId: string, userId: string): Promise<{ liked: boolean }> {
  const post = await prisma.feedPost.findUnique({ where: { id: postId }, select: { userId: true } });
  if (!post) throw new AppError("Post não encontrado.", StatusCodes.NOT_FOUND);
  await assertPostVisibleToViewer(postId, post.userId, userId);

  const existing = await prisma.feedPostLike.findUnique({
    where: { postId_userId: { postId, userId } },
  });

  // Épico de Frentes, Frente 8, Lote 16: find-then-write não era atômico -
  // duas chamadas quase simultâneas do mesmo usuário podiam colidir no
  // @@unique([postId, userId]) e a que perdesse a corrida vazava o erro
  // cru do Prisma (P2002/P2025) em vez de terminar num estado previsível.
  // Mitigado hoje pelo debounce local no mobile, mas o service em si
  // continua não sendo atômico sem isso.
  if (existing) {
    try {
      await prisma.feedPostLike.delete({ where: { postId_userId: { postId, userId } } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        return { liked: false }; // outra chamada concorrente já removeu
      }
      throw err;
    }
    return { liked: false };
  }

  try {
    await prisma.feedPostLike.create({ data: { postId, userId } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { liked: true }; // outra chamada concorrente já curtiu
    }
    throw err;
  }
  return { liked: true };
}

export async function addComment(postId: string, userId: string, content: string) {
  const post = await prisma.feedPost.findUnique({ where: { id: postId }, select: { userId: true } });
  if (!post) throw new AppError("Post não encontrado.", StatusCodes.NOT_FOUND);
  await assertPostVisibleToViewer(postId, post.userId, userId);

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
  await assertPostVisibleToViewer(postId, post.userId, viewerId);

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

// Épico de Frentes, Frente 8, Lote 2: denúncia real - antes o botão do app
// não persistia nada em lugar nenhum. `upsert` torna a chamada idempotente
// (denunciar o mesmo post duas vezes não duplica nem quebra, graças ao
// @@unique([postId, reporterId])). Só valida visibilidade por follow (não
// "já denunciado" - senão a 2ª denúncia do mesmo post falharia com 404 em
// vez de simplesmente não fazer nada de novo).
export async function reportPost(postId: string, reporterId: string, reason?: string): Promise<void> {
  const post = await prisma.feedPost.findUnique({ where: { id: postId }, select: { userId: true } });
  if (!post) throw new AppError("Post não encontrado.", StatusCodes.NOT_FOUND);
  await assertFollowsOrOwnsPost(post.userId, reporterId);
  if (post.userId === reporterId) {
    throw new AppError("Você não pode denunciar o próprio post.", StatusCodes.BAD_REQUEST);
  }

  await prisma.feedPostReport.upsert({
    where: { postId_reporterId: { postId, reporterId } },
    create: { postId, reporterId, reason },
    update: {},
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
    select: { userId: true, isAutomatic: true, type: true, createdAt: true, imageUrl: true },
  });
  if (!post) throw new AppError("Post não encontrado.", StatusCodes.NOT_FOUND);
  if (post.userId !== userId) throw new AppError("Sem permissão.", StatusCodes.FORBIDDEN);
  if (post.isAutomatic) throw new AppError("Posts automáticos não podem ser excluídos.", StatusCodes.FORBIDDEN);

  await prisma.feedPost.delete({ where: { id: postId } });

  // Épico de Frentes, Frente 8, Lote 10: apagar o post no banco nunca
  // apagava a mídia correspondente no R2 - ficava órfã pra sempre. Best
  // effort: um erro de rede no storage não deve impedir a exclusão do post.
  if (post.imageUrl) {
    await deleteMediaByUrl(post.imageUrl).catch((e) => console.error("Falha ao apagar mídia do post no R2", e));
  }

  if (post.type === "MANUAL_PHOTO" && Date.now() - post.createdAt.getTime() < XP_FARM_REVERSAL_WINDOW_MS) {
    // Épico de Frentes, Frente 8, Lote 6: reverter o XP só apagava a
    // UserXpTransaction (some do total exibido no perfil), mas nunca
    // descontava o mesmo valor do RankingSnapshot (awardXp soma XP nos dois
    // lugares junto) - o ranking ficava inflado pra sempre com XP que o
    // perfil já não tinha mais. Usa a data do post (não "agora") pra achar a
    // mesma semana/mês em que o XP foi originalmente somado, cobrindo o caso
    // raro de excluir bem em cima de uma virada de semana/mês.
    const reverted = await prisma.userXpTransaction.findFirst({
      where: { userId, reason: "POST_WORKOUT_PHOTO", referenceId: postId },
    });
    if (reverted) {
      const weekKey = getWeekKey(post.createdAt);
      const monthKey = getMonthKey(post.createdAt);
      await prisma.$transaction([
        prisma.userXpTransaction.delete({ where: { id: reverted.id } }),
        prisma.rankingSnapshot.updateMany({
          where: { userId, periodType: "WEEKLY", periodKey: weekKey },
          data: { xpEarned: { decrement: reverted.amount } },
        }),
        prisma.rankingSnapshot.updateMany({
          where: { userId, periodType: "MONTHLY", periodKey: monthKey },
          data: { xpEarned: { decrement: reverted.amount } },
        }),
        prisma.rankingSnapshot.updateMany({
          where: { userId, periodType: "ALLTIME", periodKey: "alltime" },
          data: { xpEarned: { decrement: reverted.amount } },
        }),
      ]);
    }
  }
}
