import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../config/prisma";
import { env } from "../../../config/env";
import { AppError } from "../../../shared/errors/app-error";
import { checkAndUnlock } from "../../gamification/services/achievement.service";
import { NotificationService } from "../../notifications/services/notification.service";

// Emails de admin nunca devem aparecer como membros visíveis da comunidade,
// independentemente do role armazenado no banco (que é CLIENT por design)
const hiddenFromCommunity = () =>
  env.ADMIN_ALLOWED_EMAILS.length > 0
    ? { email: { notIn: env.ADMIN_ALLOWED_EMAILS } }
    : {};

const notificationService = new NotificationService();

export async function followUser(followerId: string, followingId: string): Promise<void> {
  if (followerId === followingId) {
    throw new AppError("Você não pode seguir a si mesmo.", StatusCodes.UNPROCESSABLE_ENTITY);
  }

  // Busca dados do seguidor para personalizar a notificação
  const [follower, target] = await Promise.all([
    prisma.user.findUnique({ where: { id: followerId }, select: { id: true, name: true, apelido: true } }),
    prisma.user.findUnique({ where: { id: followingId }, select: { id: true, role: true } }),
  ]);

  if (!target) throw new AppError("Usuário não encontrado.", StatusCodes.NOT_FOUND);

  // A comunidade é exclusiva para clientes — ADMIN e PROVIDER não são membros visíveis
  if (target.role !== "CLIENT") {
    throw new AppError("Usuário não encontrado.", StatusCodes.NOT_FOUND);
  }

  await prisma.follow.upsert({
    where: { followerId_followingId: { followerId, followingId } },
    update: {},
    create: { followerId, followingId },
  });

  await Promise.all([
    checkAndUnlock(followerId, ["TOTAL_FOLLOWING"]),
    checkAndUnlock(followingId, ["TOTAL_FOLLOWERS"]),
  ]);

  // Notifica o usuário seguido (best effort — não bloqueia a operação)
  const followerDisplay = follower?.apelido ? `@${follower.apelido}` : (follower?.name ?? "Alguém");
  notificationService.sendToUsers([followingId], {
    title: "Novo seguidor",
    body: `${followerDisplay} começou a te seguir no Muvify.`,
    data: {
      type: "NEW_FOLLOWER",
      followerId,
      followerApelido: follower?.apelido ?? "",
      followerName: follower?.name ?? "",
    },
  }).catch(() => { /* best effort */ });
}

export async function unfollowUser(followerId: string, followingId: string): Promise<void> {
  await prisma.follow.deleteMany({ where: { followerId, followingId } });
}

export async function getFollowers(userId: string, page: number, limit: number) {
  const skip = (page - 1) * limit;
  const clientOnlyFilter = { follower: { role: "CLIENT" as const } };
  const [items, total] = await Promise.all([
    prisma.follow.findMany({
      where: { followingId: userId, ...clientOnlyFilter },
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        follower: { select: { id: true, name: true, apelido: true, photoUrl: true } },
      },
    }),
    prisma.follow.count({ where: { followingId: userId, ...clientOnlyFilter } }),
  ]);

  return {
    items: items.map((f) => ({ ...f.follower, followedAt: f.createdAt })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getFollowing(userId: string, page: number, limit: number) {
  const skip = (page - 1) * limit;
  const clientOnlyFilter = { following: { role: "CLIENT" as const } };
  const [items, total] = await Promise.all([
    prisma.follow.findMany({
      where: { followerId: userId, ...clientOnlyFilter },
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        following: { select: { id: true, name: true, apelido: true, photoUrl: true } },
      },
    }),
    prisma.follow.count({ where: { followerId: userId, ...clientOnlyFilter } }),
  ]);

  return {
    items: items.map((f) => ({ ...f.following, followedAt: f.createdAt })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

export async function searchUsers(
  requesterId: string,
  query: string,
  page: number,
  limit: number
) {
  const skip = (page - 1) * limit;
  // Remove @ inicial caso o usuário tenha digitado "@apelido"
  const normalizedQuery = query.replace(/^@/, "").trim();

  const where = {
    id: { not: requesterId },
    role: "CLIENT" as const,
    ...hiddenFromCommunity(),
    OR: [
      { name: { contains: normalizedQuery, mode: "insensitive" as const } },
      { apelido: { contains: normalizedQuery, mode: "insensitive" as const } },
    ],
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        apelido: true,
        photoUrl: true,
        followers: {
          where: { followerId: requesterId },
          select: { id: true },
        },
      },
      skip,
      take: limit,
      orderBy: { name: "asc" },
    }),
    prisma.user.count({ where }),
  ]);

  return {
    items: users.map((u) => ({
      id: u.id,
      name: u.name,
      apelido: u.apelido,
      photoUrl: u.photoUrl,
      isFollowing: u.followers.length > 0,
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getSuggestions(userId: string, limit: number) {
  // IDs a excluir: o próprio usuário + quem ele já segue
  const alreadyFollowing = await prisma.follow.findMany({
    where: { followerId: userId },
    select: { followingId: true },
  });
  const excludeIds = new Set([userId, ...alreadyFollowing.map((f) => f.followingId)]);

  // Providers com quem o usuário interagiu (booking ou consultoria)
  const [bookingProviders, consultancyProviders] = await Promise.all([
    prisma.booking.findMany({
      where: { clientId: userId },
      select: { providerId: true },
      distinct: ["providerId"],
    }),
    prisma.consultancyContract.findMany({
      where: { clientId: userId },
      select: { providerId: true },
      distinct: ["providerId"],
    }),
  ]);

  const myProviderIds = [
    ...new Set([
      ...bookingProviders.map((b) => b.providerId),
      ...consultancyProviders.map((c) => c.providerId),
    ]),
  ];

  const candidateIds = new Set<string>();

  if (myProviderIds.length > 0) {
    const [sameProviderBookers, sameProviderContracters] = await Promise.all([
      prisma.booking.findMany({
        where: { providerId: { in: myProviderIds }, clientId: { not: userId } },
        select: { clientId: true },
        distinct: ["clientId"],
        take: limit * 4,
      }),
      prisma.consultancyContract.findMany({
        where: { providerId: { in: myProviderIds }, clientId: { not: userId } },
        select: { clientId: true },
        distinct: ["clientId"],
        take: limit * 4,
      }),
    ]);

    for (const b of sameProviderBookers) {
      if (!excludeIds.has(b.clientId)) candidateIds.add(b.clientId);
    }
    for (const c of sameProviderContracters) {
      if (!excludeIds.has(c.clientId)) candidateIds.add(c.clientId);
    }
  }

  // Fallback: preenche com usuários CLIENT recentes se houver menos que o limite
  if (candidateIds.size < limit) {
    const fallback = await prisma.user.findMany({
      where: {
        id: { notIn: [...excludeIds, ...candidateIds] },
        role: "CLIENT",
        ...hiddenFromCommunity(),
      },
      select: { id: true },
      take: limit - candidateIds.size,
      orderBy: { createdAt: "desc" },
    });
    for (const u of fallback) candidateIds.add(u.id);
  }

  const ids = [...candidateIds].slice(0, limit);
  if (ids.length === 0) return [];

  return prisma.user.findMany({
    where: { id: { in: ids }, role: "CLIENT", ...hiddenFromCommunity() },
    select: { id: true, name: true, apelido: true, photoUrl: true },
  });
}

export async function getUserPublicProfile(requesterId: string, targetId: string) {
  const [user, followerCount, followingCount, isFollowing] = await Promise.all([
    prisma.user.findUnique({
      where: { id: targetId, role: "CLIENT" },
      select: { id: true, name: true, apelido: true, photoUrl: true, createdAt: true },
    }),
    prisma.follow.count({ where: { followingId: targetId } }),
    prisma.follow.count({ where: { followerId: targetId } }),
    prisma.follow.findFirst({ where: { followerId: requesterId, followingId: targetId } }),
  ]);

  if (!user) throw new AppError("Usuário não encontrado.", StatusCodes.NOT_FOUND);

  const xpResult = await prisma.userXpTransaction.aggregate({
    where: { userId: targetId },
    _sum: { amount: true },
  });
  const totalXp = xpResult._sum.amount ?? 0;

  const { computeLevel } = await import("../../gamification/services/xp.service");
  const levelInfo = computeLevel(totalXp);

  const streak = await prisma.userStreak.findUnique({
    where: { userId: targetId },
    select: { currentStreak: true, longestStreak: true },
  });

  return {
    ...user,
    followerCount,
    followingCount,
    isFollowing: isFollowing !== null,
    totalXp,
    currentLevel: levelInfo.level,
    levelName: levelInfo.name,
    currentStreak: streak?.currentStreak ?? 0,
    longestStreak: streak?.longestStreak ?? 0,
  };
}
