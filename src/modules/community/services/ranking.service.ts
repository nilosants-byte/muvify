import { RankingPeriodType } from "@prisma/client";
import { prisma } from "../../../config/prisma";
import { computeLevel, getMonthKey, getWeekKey } from "../../gamification/services/xp.service";
import { hiddenFromCommunity } from "./social.service";

function getCurrentPeriodKey(period: RankingPeriodType): string {
  const now = new Date();
  if (period === "WEEKLY") return getWeekKey(now);
  if (period === "MONTHLY") return getMonthKey(now);
  return "alltime";
}

export async function getRanking(
  viewerId: string,
  period: RankingPeriodType,
  page: number,
  limit: number
) {
  const periodKey = getCurrentPeriodKey(period);

  // Épico de Frentes, Frente 8, Lote 3: usuário suspenso continuava
  // aparecendo no ranking de amigos indefinidamente - suspender uma conta
  // nunca removia o Follow já existente nem era checado aqui.
  // Apenas seguidores MÚTUOS: viewer segue E é seguido de volta
  const [following, followers] = await Promise.all([
    prisma.follow.findMany({ where: { followerId: viewerId, following: { role: "CLIENT", suspendedAt: null } }, select: { followingId: true }, take: 5000 }),
    prisma.follow.findMany({ where: { followingId: viewerId, follower: { role: "CLIENT", suspendedAt: null } }, select: { followerId: true }, take: 5000 }),
  ]);
  const followingSet = new Set(following.map((f) => f.followingId));
  const followerSet = new Set(followers.map((f) => f.followerId));
  // Mútuo = viewerId segue o outro E o outro segue viewerId
  const mutualIds = [...followingSet].filter((id) => followerSet.has(id));
  const visibleUserIds = [viewerId, ...mutualIds];

  const [snapshots, userProfiles] = await Promise.all([
    prisma.rankingSnapshot.findMany({
      where: { userId: { in: visibleUserIds }, periodType: period, periodKey },
      orderBy: { xpEarned: "desc" },
    }),
    prisma.user.findMany({
      where: { id: { in: visibleUserIds } },
      select: { id: true, name: true, apelido: true, photoUrl: true },
    }),
  ]);

  const userMap = new Map(userProfiles.map((u) => [u.id, u]));
  const snapMap = new Map(snapshots.map((s) => [s.userId, s]));

  const allUsersWithXp = visibleUserIds.map((uid) => ({
    userId: uid,
    xpEarned: snapMap.get(uid)?.xpEarned ?? 0,
    user: userMap.get(uid),
  }));

  allUsersWithXp.sort((a, b) => b.xpEarned - a.xpEarned);

  const ranked = allUsersWithXp.map((entry, index) => ({
    position: index + 1,
    userId: entry.userId,
    name: entry.user?.name ?? null,
    apelido: (entry.user as any)?.apelido ?? null,
    photoUrl: entry.user?.photoUrl ?? null,
    xpEarned: entry.xpEarned,
    isViewer: entry.userId === viewerId,
  }));

  const viewerEntry = ranked.find((r) => r.userId === viewerId);
  const total = ranked.length;
  const skip = (page - 1) * limit;
  const pageItems = ranked.slice(skip, skip + limit);

  return {
    items: pageItems,
    viewerPosition: viewerEntry?.position ?? null,
    viewerXp: viewerEntry?.xpEarned ?? 0,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    period,
    periodKey,
  };
}

// Épico de Frentes, Frente 8, Lote 16: getRanking sempre filtra pra
// seguidores mútuos ("ranking de amigos") - não existia nenhum ranking
// geral (todos os usuários) exposto ao app, mesmo o dado global já
// existindo internamente pra distribuir os prêmios de 1º-3º lugar
// (getTopNForPeriod). Reaproveita o mesmo RankingSnapshot, sem filtro de
// follow, com os mesmos filtros de visibilidade já usados em outras
// consultas da comunidade (suspenso, admin disfarçado).
export async function getGeneralRanking(
  viewerId: string,
  period: RankingPeriodType,
  page: number,
  limit: number
) {
  const periodKey = getCurrentPeriodKey(period);
  const skip = (page - 1) * limit;

  const visibilityFilter = {
    user: { role: "CLIENT" as const, suspendedAt: null, ...hiddenFromCommunity() },
  };

  const [snapshots, total] = await Promise.all([
    prisma.rankingSnapshot.findMany({
      where: { periodType: period, periodKey, xpEarned: { gt: 0 }, ...visibilityFilter },
      orderBy: { xpEarned: "desc" },
      skip,
      take: limit,
      include: { user: { select: { id: true, name: true, apelido: true, photoUrl: true } } },
    }),
    prisma.rankingSnapshot.count({ where: { periodType: period, periodKey, xpEarned: { gt: 0 }, ...visibilityFilter } }),
  ]);

  const items = snapshots.map((snap, index) => ({
    position: skip + index + 1,
    userId: snap.userId,
    name: snap.user.name,
    apelido: snap.user.apelido,
    photoUrl: snap.user.photoUrl,
    xpEarned: snap.xpEarned,
    isViewer: snap.userId === viewerId,
  }));

  return {
    items,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    period,
    periodKey,
  };
}

export async function getUserRankingPosition(
  userId: string,
  followerId: string,
  period: RankingPeriodType
): Promise<number | null> {
  const ranking = await getRanking(followerId, period, 1, 9999);
  const entry = ranking.items.find((r: { userId: string }) => r.userId === userId);
  return entry ? (entry as { position: number }).position : null;
}

export async function getTopNForPeriod(
  period: RankingPeriodType,
  periodKey: string,
  topN: number
): Promise<Array<{ userId: string; xpEarned: number; position: number }>> {
  const snapshots = await prisma.rankingSnapshot.findMany({
    where: { periodType: period, periodKey },
    orderBy: { xpEarned: "desc" },
    take: topN,
  });

  return snapshots.map((s, i) => ({
    userId: s.userId,
    xpEarned: s.xpEarned,
    position: i + 1,
  }));
}

export async function getUserXpInPeriod(
  userId: string,
  period: RankingPeriodType,
  periodKey: string
): Promise<number> {
  const snap = await prisma.rankingSnapshot.findUnique({
    where: { userId_periodType_periodKey: { userId, periodType: period, periodKey } },
    select: { xpEarned: true },
  });
  return snap?.xpEarned ?? 0;
}

export async function getUserLevelInfo(userId: string) {
  const result = await prisma.userXpTransaction.aggregate({
    where: { userId },
    _sum: { amount: true },
  });
  const totalXp = result._sum.amount ?? 0;
  return computeLevel(totalXp);
}
