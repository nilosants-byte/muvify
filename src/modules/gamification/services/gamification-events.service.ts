import { prisma } from "../../../config/prisma";
import { checkAndUnlock, checkLevelAchievements } from "./achievement.service";
import { recordTraining } from "./streak.service";
import { awardXp, computeLevel, getTotalXp } from "./xp.service";
import { createAutoPost } from "../../community/services/feed.service";
import { toProviderPhotoUrl } from "../../../shared/utils/photo-url";

// ── Tabela de XP aprovada (v2) ────────────────────────────────────────────────
// Presencial concluído: 80 XP  (mais esforço — deslocamento + aula física)
// Online concluído:     50 XP  (menos esforço — feito sozinho com instrução)
// Serviço contratado:   25 XP  (pré-auth/pagamento de qualquer tipo)
// Avaliação enviada:    15 XP
// Primeira sessão c/ novo provider: 25 XP (bônus, já existia)
// Foto pós-treino:      15 XP

export async function onWorkoutCompleted(
  clientId: string,
  bookingId: string,
  includePhoto: boolean,
  photoUrl?: string
): Promise<void> {
  try {
    const isFirstSessionWithProvider = await checkFirstSessionWithProvider(clientId, bookingId);

    const prevTotalXp = await getTotalXp(clientId);
    const prevLevel = computeLevel(prevTotalXp);

    // 80 XP por agendamento presencial concluído
    await awardXp(clientId, 80, "PRESENTIAL_WORKOUT_COMPLETED", bookingId);

    if (isFirstSessionWithProvider) {
      await awardXp(clientId, 25, "NEW_PROVIDER_FIRST_SESSION", bookingId);
    }

    if (includePhoto && photoUrl) {
      await awardXp(clientId, 15, "POST_WORKOUT_PHOTO", bookingId);
    }

    const { milestoneHit, alreadyTrainedToday } = await recordTraining(clientId);

    const newTotalXp = await getTotalXp(clientId);
    const newLevel = computeLevel(newTotalXp);

    if (newLevel.level > prevLevel.level) {
      await createAutoPost(clientId, "LEVEL_UP", {
        metadata: { newLevel: newLevel.level, levelName: newLevel.name, totalXp: newTotalXp },
      }).catch((e) => console.error("Gamification: LEVEL_UP post failed", e));
      await checkLevelAchievements(clientId).catch((e) => console.error("Gamification: checkLevelAchievements failed", e));
    }

    if (milestoneHit && !alreadyTrainedToday) {
      await createAutoPost(clientId, "STREAK_MILESTONE", {
        metadata: { sessions: milestoneHit },
      }).catch((e) => console.error("Gamification: STREAK_MILESTONE post failed", e));
      await onStreakMilestone(clientId, milestoneHit);
    }

    // Fetch provider info to store in post metadata for the collab UI in the feed
    const bookingForPost = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        provider: {
          select: { id: true, displayName: true, photoUrl: true, updatedAt: true }
        }
      }
    }).catch(() => null);

    const providerMeta = bookingForPost?.provider
      ? {
          providerId: bookingForPost.provider.id,
          providerName: bookingForPost.provider.displayName,
          providerPhotoUrl: toProviderPhotoUrl(
            bookingForPost.provider.id,
            bookingForPost.provider.photoUrl,
            bookingForPost.provider.updatedAt
          ),
        }
      : {};

    await createAutoPost(clientId, "WORKOUT_COMPLETED", {
      referenceId: bookingId,
      imageUrl: includePhoto ? photoUrl : undefined,
      metadata: { type: "PRESENTIAL", ...providerMeta },
    }).catch((e) => console.error("Gamification: WORKOUT_COMPLETED post failed", e));

    await checkAndUnlock(clientId, [
      "STREAK_SESSIONS",
      "TOTAL_WORKOUTS",
      "DISTINCT_PROVIDERS_TRAINED",
    ]).catch((e) => console.error("Gamification: checkAndUnlock failed", e));
  } catch (error) {
    console.error("Gamification: onWorkoutCompleted failed", error);
  }
}

export async function onTrainingPlanCompleted(
  clientId: string,
  completionId: string,
  providerId: string
): Promise<void> {
  try {
    const prevTotalXp = await getTotalXp(clientId);
    const prevLevel = computeLevel(prevTotalXp);

    // 50 XP por treino de consultoria concluído (online, menos esforço).
    // referenceId e o id da conclusao (unico por vez que o cliente finaliza),
    // nao o contrato — senao XP e post so acontecem na primeira conclusao de
    // cada contrato, mesmo que o cliente conclua o treino varias vezes.
    await awardXp(clientId, 50, "ONLINE_WORKOUT_COMPLETED", completionId);

    const { milestoneHit, alreadyTrainedToday } = await recordTraining(clientId);

    const newTotalXp = await getTotalXp(clientId);
    const newLevel = computeLevel(newTotalXp);

    if (newLevel.level > prevLevel.level) {
      await createAutoPost(clientId, "LEVEL_UP", {
        metadata: { newLevel: newLevel.level, levelName: newLevel.name, totalXp: newTotalXp },
      });
      await checkLevelAchievements(clientId);
    }

    if (milestoneHit && !alreadyTrainedToday) {
      await createAutoPost(clientId, "STREAK_MILESTONE", {
        metadata: { sessions: milestoneHit },
      });
    }

    const provider = await prisma.providerProfile.findUnique({
      where: { id: providerId },
      select: { id: true, displayName: true, photoUrl: true, updatedAt: true }
    }).catch(() => null);

    const onlineProviderMeta = provider
      ? {
          providerId: provider.id,
          providerName: provider.displayName,
          providerPhotoUrl: toProviderPhotoUrl(provider.id, provider.photoUrl, provider.updatedAt),
        }
      : {};

    await createAutoPost(clientId, "WORKOUT_COMPLETED", {
      referenceId: completionId,
      metadata: { type: "ONLINE", ...onlineProviderMeta },
    });

    await checkAndUnlock(clientId, [
      "STREAK_SESSIONS",
      "TOTAL_WORKOUTS",
      "DISTINCT_PROVIDERS_TRAINED",
    ]);
  } catch (error) {
    console.error("Gamification: onTrainingPlanCompleted failed", error);
  }
}

/** 15 XP ao enviar uma avaliação após agendamento. */
export async function onReviewSubmitted(userId: string, reviewId: string): Promise<void> {
  try {
    await awardXp(userId, 15, "REVIEW_SUBMITTED", reviewId);
    await checkAndUnlock(userId, ["TOTAL_REVIEWS_SUBMITTED"]);
  } catch (error) {
    console.error("Gamification: onReviewSubmitted failed", error);
  }
}

/**
 * 25 XP ao contratar qualquer serviço (agendamento presencial ou consultoria online).
 * Disparado quando o pagamento é pré-autorizado (CARD) ou confirmado (PIX).
 * Evita duplicidade verificando se já existe transação para este referenceId.
 */
export async function onServicePurchased(clientId: string, referenceId: string): Promise<void> {
  try {
    // Idempotência: não ganha XP duas vezes pelo mesmo serviço
    const alreadyAwarded = await prisma.userXpTransaction.findFirst({
      where: { userId: clientId, referenceId, reason: "SERVICE_PURCHASED" },
      select: { id: true },
    });
    if (alreadyAwarded) return;

    await awardXp(clientId, 25, "SERVICE_PURCHASED", referenceId);
  } catch (error) {
    console.error("Gamification: onServicePurchased failed", error);
  }
}

/** 15 XP ao postar foto de treino no feed. */
export async function onPhotoPosted(userId: string, postId: string): Promise<void> {
  try {
    await awardXp(userId, 15, "POST_WORKOUT_PHOTO", postId);
    await checkAndUnlock(userId, ["TOTAL_PHOTO_POSTS"]);
  } catch (error) {
    console.error("Gamification: onPhotoPosted failed", error);
  }
}

/** XP por milestone de sequência de treinos. */
export async function onStreakMilestone(userId: string, sessions: number): Promise<void> {
  try {
    const milestoneXp: Record<number, { xp: number; reason: "STREAK_MILESTONE_15" | "STREAK_MILESTONE_30" | "STREAK_MILESTONE_45" | "STREAK_MILESTONE_90" }> = {
      15: { xp: 50,  reason: "STREAK_MILESTONE_15" },
      30: { xp: 100, reason: "STREAK_MILESTONE_30" },
      45: { xp: 150, reason: "STREAK_MILESTONE_45" },
      90: { xp: 300, reason: "STREAK_MILESTONE_90" },
    };
    const entry = milestoneXp[sessions];
    if (!entry) return;
    // referenceId inclui o dia: permite reconquista em dias diferentes, previne duplicata intra-dia
    const dayKey = new Date().toISOString().slice(0, 10);
    await awardXp(userId, entry.xp, entry.reason, `${dayKey}:milestone_${sessions}`);
  } catch (error) {
    console.error("Gamification: onStreakMilestone failed", error);
  }
}

/** 50 XP na primeira sessão presencial COMPLETED do usuário. */
export async function onFirstBookingCompleted(clientId: string): Promise<void> {
  try {
    const alreadyAwarded = await prisma.userXpTransaction.findFirst({
      where: { userId: clientId, reason: "FIRST_BOOKING" },
      select: { id: true },
    });
    if (alreadyAwarded) return;

    const completedCount = await prisma.booking.count({
      where: { clientId, status: "COMPLETED" },
    });
    if (completedCount !== 1) return;

    await awardXp(clientId, 50, "FIRST_BOOKING", clientId);
  } catch (error) {
    console.error("Gamification: onFirstBookingCompleted failed", error);
  }
}

/** 50 XP na primeira consultoria contratada (contrato ACTIVE). */
export async function onFirstConsultancyContracted(clientId: string): Promise<void> {
  try {
    const alreadyAwarded = await prisma.userXpTransaction.findFirst({
      where: { userId: clientId, reason: "FIRST_CONSULTANCY" },
      select: { id: true },
    });
    if (alreadyAwarded) return;

    await awardXp(clientId, 50, "FIRST_CONSULTANCY", clientId);
  } catch (error) {
    console.error("Gamification: onFirstConsultancyContracted failed", error);
  }
}

/** 40 XP a cada múltiplo de 10 bookings COMPLETED (10, 20, 30…). */
export async function onEvery10BookingsCompleted(clientId: string): Promise<void> {
  try {
    const completedCount = await prisma.booking.count({
      where: { clientId, status: "COMPLETED" },
    });
    if (completedCount === 0 || completedCount % 10 !== 0) return;

    const milestoneNumber = completedCount / 10; // 1 para 10ª booking, 2 para 20ª, etc.
    // referenceId único por milestone garante idempotência com o @@unique constraint
    await awardXp(clientId, 40, "EVERY_10_BOOKINGS", `milestone_${milestoneNumber}`);
  } catch (error) {
    console.error("Gamification: onEvery10BookingsCompleted failed", error);
  }
}

// ── Helper interno ────────────────────────────────────────────────────────────

async function checkFirstSessionWithProvider(clientId: string, bookingId: string): Promise<boolean> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { providerId: true },
  });
  if (!booking) return false;

  const previousSessions = await prisma.booking.count({
    where: {
      clientId,
      providerId: booking.providerId,
      status: "COMPLETED",
      id: { not: bookingId },
    },
  });

  return previousSessions === 0;
}
