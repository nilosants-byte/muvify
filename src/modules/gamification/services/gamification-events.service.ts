import * as Sentry from "@sentry/node";
import { prisma } from "../../../config/prisma";
import { checkAndUnlock, checkLevelAchievements } from "./achievement.service";
import { recordTraining } from "./streak.service";
import { awardXp, computeLevel, getTotalXp, getWeekKey } from "./xp.service";
import { createAutoPost } from "../../community/services/feed.service";
import { toProviderPhotoUrl } from "../../../shared/utils/photo-url";
import { NotificationService } from "../../notifications/services/notification.service";

const notificationService = new NotificationService();

// Frente 2 (segunda camada), Lote 8: este arquivo não tinha nenhum import de
// Sentry — as falhas de evento de gamificação abaixo só chegavam ao
// console. Severidade baixa (XP/post automático não é crítico pro negócio),
// mas ainda assim vale ter visibilidade real em vez de silêncio total.
function reportGamificationFailure(context: string, error: unknown) {
  console.error(`Gamification: ${context} failed`, error);
  Sentry.captureException(error, { tags: { area: "gamification" }, extra: { context } });
}

// Épico de Frentes, Frente 8, Lote 8: o post automático de treino concluído
// carrega providerName/providerPhotoUrl no metadata "para a collab UI no
// feed", mas o profissional nunca tinha nenhuma forma de saber que apareceu
// no post de um aluno - decisão do usuário: notificação push simples.
async function notifyProviderOfWorkoutPost(providerUserId: string | undefined, clientId: string): Promise<void> {
  if (!providerUserId) return;
  const client = await prisma.user.findUnique({
    where: { id: clientId },
    select: { name: true, apelido: true },
  }).catch(() => null);
  const clientDisplay = client?.apelido ? `@${client.apelido}` : (client?.name ?? "Um aluno");
  await notificationService.sendToUsers([providerUserId], {
    title: "Novo post sobre o treino com você",
    body: `${clientDisplay} postou na comunidade sobre o treino com você no Muvify.`,
    data: { type: "STUDENT_POST_MENTION", clientId },
    preferenceType: "COMMUNITY",
  }).catch(() => { /* best effort */ });
}

// ── Tabela de XP aprovada (v2) ────────────────────────────────────────────────
// Presencial concluído: 80 XP  (mais esforço — deslocamento + aula física)
// Online concluído:     50 XP  (menos esforço — feito sozinho com instrução)
// Serviço contratado:   25 XP  (pré-auth/pagamento de qualquer tipo)
// Avaliação enviada:    15 XP
// Primeira sessão c/ novo provider: 25 XP (bônus, já existia)
// Foto pós-treino:      10 XP (concedido só em createManualPhotoPost, ver community/feed.service.ts)

export async function onWorkoutCompleted(
  clientId: string,
  bookingId: string
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

    const { milestoneHit, weekMilestoneHit, alreadyTrainedToday } = await recordTraining(clientId);

    const newTotalXp = await getTotalXp(clientId);
    const newLevel = computeLevel(newTotalXp);

    if (newLevel.level > prevLevel.level) {
      // Épico de Frentes, Frente 8, Lote 11: sem referenceId, dois eventos
      // de XP quase simultâneos (ex: concluir presencial e consultoria bem
      // próximos) podiam ler o mesmo nível anterior antes de qualquer
      // commit e ambos concluir "subiu de nível", gerando dois posts pro
      // mesmo salto. Dedup já existente em createAutoPost passa a valer
      // aqui também.
      await createAutoPost(clientId, "LEVEL_UP", {
        referenceId: `level_up:${newLevel.level}`,
        metadata: { newLevel: newLevel.level, levelName: newLevel.name, totalXp: newTotalXp },
      }).catch((e) => reportGamificationFailure("LEVEL_UP post", e));
      await checkLevelAchievements(clientId).catch((e) => reportGamificationFailure("checkLevelAchievements", e));
    }

    if (milestoneHit && !alreadyTrainedToday) {
      await createAutoPost(clientId, "STREAK_MILESTONE", {
        metadata: { sessions: milestoneHit },
      }).catch((e) => reportGamificationFailure("STREAK_MILESTONE post", e));
      await onStreakMilestone(clientId, milestoneHit);
    }
    if (weekMilestoneHit && !alreadyTrainedToday) {
      await createAutoPost(clientId, "STREAK_MILESTONE", {
        metadata: { weeks: weekMilestoneHit },
      }).catch((e) => reportGamificationFailure("STREAK_MILESTONE (weeks) post", e));
      await onWeekStreakMilestone(clientId, weekMilestoneHit);
    }

    // Fetch provider info to store in post metadata for the collab UI in the feed
    const bookingForPost = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        provider: {
          select: { id: true, userId: true, displayName: true, photoUrl: true, updatedAt: true }
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
      metadata: { type: "PRESENTIAL", ...providerMeta },
    }).catch((e) => reportGamificationFailure("WORKOUT_COMPLETED post", e));
    await notifyProviderOfWorkoutPost(bookingForPost?.provider?.userId, clientId);

    await checkAndUnlock(clientId, [
      "STREAK_SESSIONS",
      "TOTAL_WORKOUTS",
      "DISTINCT_PROVIDERS_TRAINED",
    ]).catch((e) => reportGamificationFailure("checkAndUnlock", e));
  } catch (error) {
    reportGamificationFailure("onWorkoutCompleted", error);
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

    const { milestoneHit, weekMilestoneHit, alreadyTrainedToday } = await recordTraining(clientId);

    const newTotalXp = await getTotalXp(clientId);
    const newLevel = computeLevel(newTotalXp);

    if (newLevel.level > prevLevel.level) {
      // Épico de Frentes, Frente 8, Lote 11: mesma proteção de dedup do
      // onWorkoutCompleted.
      await createAutoPost(clientId, "LEVEL_UP", {
        referenceId: `level_up:${newLevel.level}`,
        metadata: { newLevel: newLevel.level, levelName: newLevel.name, totalXp: newTotalXp },
      });
      await checkLevelAchievements(clientId);
    }

    if (milestoneHit && !alreadyTrainedToday) {
      await createAutoPost(clientId, "STREAK_MILESTONE", {
        metadata: { sessions: milestoneHit },
      });
      // Épico de Frentes - redesenho do streak semanal (05/08/2026): o
      // caminho online nunca chamava onStreakMilestone (só criava o post,
      // sem XP/push) - assimetria com onWorkoutCompleted encontrada ao
      // mexer nesse trecho pra adicionar o marco de semanas, corrigida
      // junto.
      await onStreakMilestone(clientId, milestoneHit);
    }
    if (weekMilestoneHit && !alreadyTrainedToday) {
      await createAutoPost(clientId, "STREAK_MILESTONE", {
        metadata: { weeks: weekMilestoneHit },
      });
      await onWeekStreakMilestone(clientId, weekMilestoneHit);
    }

    const provider = await prisma.providerProfile.findUnique({
      where: { id: providerId },
      select: { id: true, userId: true, displayName: true, photoUrl: true, updatedAt: true }
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
    await notifyProviderOfWorkoutPost(provider?.userId, clientId);

    await checkAndUnlock(clientId, [
      "STREAK_SESSIONS",
      "TOTAL_WORKOUTS",
      "DISTINCT_PROVIDERS_TRAINED",
    ]);
  } catch (error) {
    reportGamificationFailure("onTrainingPlanCompleted", error);
  }
}

/** 15 XP ao enviar uma avaliação após agendamento. */
export async function onReviewSubmitted(userId: string, reviewId: string): Promise<void> {
  try {
    await awardXp(userId, 15, "REVIEW_SUBMITTED", reviewId);
    await checkAndUnlock(userId, ["TOTAL_REVIEWS_SUBMITTED"]);
  } catch (error) {
    reportGamificationFailure("onReviewSubmitted", error);
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
    reportGamificationFailure("onServicePurchased", error);
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
    // Épico de Frentes, Frente 8, Lote 12: marco de streak não gerava push
    // nenhum, só o FeedPost automático (visto só se o usuário abrisse a
    // aba Comunidade por conta própria).
    await notificationService.sendToUsers([userId], {
      title: "Sequência em alta!",
      body: `${sessions} dias seguidos treinando. Continue assim!`,
      data: { type: "STREAK_MILESTONE", sessions: String(sessions) },
      preferenceType: "COMMUNITY",
    }).catch(() => { /* best effort */ });
  } catch (error) {
    reportGamificationFailure("onStreakMilestone", error);
  }
}

/**
 * XP por marco de SEMANAS seguidas batendo a própria meta pessoal - Épico
 * de Frentes, redesenho do streak semanal (05/08/2026). Convive com
 * onStreakMilestone (marco em dias) em vez de substituí-lo - os dois tipos
 * de prêmio coexistem, decisão do usuário.
 */
export async function onWeekStreakMilestone(userId: string, weeks: number): Promise<void> {
  try {
    const milestoneXp: Record<
      number,
      { xp: number; reason: "STREAK_WEEK_MILESTONE_4" | "STREAK_WEEK_MILESTONE_8" | "STREAK_WEEK_MILESTONE_12" | "STREAK_WEEK_MILESTONE_26" | "STREAK_WEEK_MILESTONE_52" }
    > = {
      4:  { xp: 150,  reason: "STREAK_WEEK_MILESTONE_4" },
      8:  { xp: 300,  reason: "STREAK_WEEK_MILESTONE_8" },
      12: { xp: 500,  reason: "STREAK_WEEK_MILESTONE_12" },
      26: { xp: 1200, reason: "STREAK_WEEK_MILESTONE_26" },
      52: { xp: 3000, reason: "STREAK_WEEK_MILESTONE_52" },
    };
    const entry = milestoneXp[weeks];
    if (!entry) return;
    // referenceId inclui a semana corrente: permite reconquista em semanas
    // diferentes (mesmo padrão do marco em dias), previne duplicata na mesma semana.
    const weekKey = getWeekKey(new Date());
    await awardXp(userId, entry.xp, entry.reason, `${weekKey}:week_milestone_${weeks}`);
    await notificationService.sendToUsers([userId], {
      title: "Foco de verdade!",
      body: `${weeks} semanas seguidas batendo sua meta de treino. Continue assim!`,
      data: { type: "STREAK_MILESTONE", weeks: String(weeks) },
      preferenceType: "COMMUNITY",
    }).catch(() => { /* best effort */ });
  } catch (error) {
    reportGamificationFailure("onWeekStreakMilestone", error);
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
    reportGamificationFailure("onFirstBookingCompleted", error);
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
    reportGamificationFailure("onFirstConsultancyContracted", error);
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
    reportGamificationFailure("onEvery10BookingsCompleted", error);
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
