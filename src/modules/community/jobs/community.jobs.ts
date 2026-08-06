import * as Sentry from "@sentry/node";
import { prisma } from "../../../config/prisma";
import { env } from "../../../config/env";
import { isPrismaDatabaseUnavailableError } from "../../../shared/utils/prisma-error";
import { awardXp, getWeekKey, getMonthKey } from "../../gamification/services/xp.service";
import { checkAndUnlock } from "../../gamification/services/achievement.service";
import { createAutoPost } from "../services/feed.service";

// Advisory lock key for community jobs
const COMMUNITY_JOB_LOCK_KEY = 909_004;

const JOB_INTERVAL_MS = 60 * 60 * 1000; // run checks every hour
const MAX_DATABASE_BACKOFF_MS = 5 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;
let consecutiveDatabaseFailures = 0;
let nextAllowedRunAt = 0;

// Track what periods have already been processed this run
const processedWeeks = new Set<string>();
const processedMonths = new Set<string>();
const processedDates = new Set<string>(); // idempotência diária para dailyPositionTracker

function calculateBackoffMs(failures: number) {
  return Math.min(JOB_INTERVAL_MS * 2 ** Math.max(0, failures - 1), MAX_DATABASE_BACKOFF_MS);
}

// Épico de Frentes, Frente 8, Lote 4: getWeekKey/getMonthKey (xp.service.ts)
// já calculam a chave do período corretamente em APP_TIMEZONE - mas o job
// que fecha o período (getPreviousWeekKey/getPreviousMonthKey + o próprio
// gatilho dayOfWeek/dayOfMonth abaixo) usava Date.getDay()/getDate() cru
// (fuso do processo), podendo divergir da chave usada durante a semana/mês
// pra acumular XP se o servidor não rodar em America/Sao_Paulo. localDateKey
// resolve "que dia é hoje" no fuso certo; a subtração de 7 dias/1 mês em
// cima de uma chave (uma data pura) já correta é aritmética de calendário
// seguro, sem reintroduzir fuso do processo.
export function localDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: env.APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function getPreviousWeekKey(now: Date): string {
  const currentWeekKey = getWeekKey(now);
  const d = new Date(`${currentWeekKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

export function getPreviousMonthKey(now: Date): string {
  const [year, month] = getMonthKey(now).split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function runCommunityJobs() {
  const now = new Date();
  const todayKey = localDateKey(now);
  // Segunda-feira é o próprio dia-chave retornado por getWeekKey (que já
  // resolve pra segunda da semana corrente no fuso certo).
  const isMonday = getWeekKey(now) === todayKey;
  const dayOfMonth = Number(todayKey.slice(8, 10));

  // ── Weekly ranking reset (runs on Mondays) ────────────────────────────────
  if (isMonday) {
    const prevWeekKey = getPreviousWeekKey(now);
    if (!processedWeeks.has(prevWeekKey)) {
      // Verifica TODAS as três posições para tolerar falha parcial de execução anterior
      const [p1, p2, p3] = await Promise.all([
        prisma.userXpTransaction.findFirst({ where: { reason: "WEEKLY_RANKING_1ST", referenceId: `weekly:${prevWeekKey}` } }),
        prisma.userXpTransaction.findFirst({ where: { reason: "WEEKLY_RANKING_2ND", referenceId: `weekly:${prevWeekKey}` } }),
        prisma.userXpTransaction.findFirst({ where: { reason: "WEEKLY_RANKING_3RD", referenceId: `weekly:${prevWeekKey}` } }),
      ]);
      if (!p1 || !p2 || !p3) {
        await processWeeklyReset(prevWeekKey);
      }
      processedWeeks.add(prevWeekKey);
    }
  }

  // ── Monthly ranking reset (runs on 1st of month) ──────────────────────────
  if (dayOfMonth === 1) {
    const prevMonthKey = getPreviousMonthKey(now);
    if (!processedMonths.has(prevMonthKey)) {
      const [m1, m2, m3] = await Promise.all([
        prisma.userXpTransaction.findFirst({ where: { reason: "MONTHLY_RANKING_1ST", referenceId: `monthly:${prevMonthKey}` } }),
        prisma.userXpTransaction.findFirst({ where: { reason: "MONTHLY_RANKING_2ND", referenceId: `monthly:${prevMonthKey}` } }),
        prisma.userXpTransaction.findFirst({ where: { reason: "MONTHLY_RANKING_3RD", referenceId: `monthly:${prevMonthKey}` } }),
      ]);
      if (!m1 || !m2 || !m3) {
        await processMonthlyReset(prevMonthKey);
      }
      processedMonths.add(prevMonthKey);
    }
  }

  // ── Daily position tracker ────────────────────────────────────────────────
  if (!processedDates.has(todayKey)) {
    await processDailyPositionTracker(now);
    processedDates.add(todayKey);
  }
}

async function processWeeklyReset(weekKey: string) {
  const snapshots = await prisma.rankingSnapshot.findMany({
    where: { periodType: "WEEKLY", periodKey: weekKey },
    orderBy: { xpEarned: "desc" },
    take: 3,
  });

  const xpByPosition: Record<number, number> = { 1: 300, 2: 200, 3: 100 };
  const reasonByPosition: Record<number, "WEEKLY_RANKING_1ST" | "WEEKLY_RANKING_2ND" | "WEEKLY_RANKING_3RD"> = {
    1: "WEEKLY_RANKING_1ST",
    2: "WEEKLY_RANKING_2ND",
    3: "WEEKLY_RANKING_3RD",
  };
  const postTypeByPosition: Record<number, "RANKING_WEEK_ENDED_TOP3"> = {
    1: "RANKING_WEEK_ENDED_TOP3",
    2: "RANKING_WEEK_ENDED_TOP3",
    3: "RANKING_WEEK_ENDED_TOP3",
  };

  for (let i = 0; i < snapshots.length; i++) {
    const position = i + 1;
    const snap = snapshots[i];

    await awardXp(snap.userId, xpByPosition[position], reasonByPosition[position], `weekly:${weekKey}`);

    await createAutoPost(snap.userId, postTypeByPosition[position], {
      referenceId: `weekly:${weekKey}:pos${position}`,
      metadata: { position, weekKey, xpEarned: snap.xpEarned },
    });

    // Épico de Frentes, Frente 8, Lote 13: só quem de fato fechou a semana
    // no top 3 (este loop) é candidato a ter estendido uma sequência -
    // único lugar do código que fecha um período semanal, então é o único
    // lugar correto pra disparar essa checagem.
    await checkAndUnlock(snap.userId, ["WEEKLY_TOP3_REACHED", "WEEKLY_1ST_REACHED", "WEEKLY_TOP3_CONSECUTIVE_WEEKS"]);

    if (position === 1) {
      const generalTop3 = await prisma.rankingSnapshot.findMany({
        where: { periodType: "ALLTIME", periodKey: "alltime" },
        orderBy: { xpEarned: "desc" },
        take: 3,
      });
      const generalPosition = generalTop3.findIndex((s) => s.userId === snap.userId) + 1;
      if (generalPosition >= 1 && generalPosition <= 3) {
        const generalXp: Record<number, number> = { 1: 2000, 2: 1000, 3: 500 };
        const generalReason = (
          ["GENERAL_RANKING_1ST_REACHED", "GENERAL_RANKING_2ND_REACHED", "GENERAL_RANKING_3RD_REACHED"] as const
        )[generalPosition - 1];

        const alreadyReceivedGeneral = await prisma.userXpTransaction.findFirst({
          where: { userId: snap.userId, reason: generalReason },
        });
        if (!alreadyReceivedGeneral) {
          await awardXp(snap.userId, generalXp[generalPosition], generalReason);
          await createAutoPost(snap.userId, "RANKING_ENTERED_GENERAL_TOP5", {
            referenceId: `general:${weekKey}:pos${generalPosition}`,
            metadata: { position: generalPosition },
          });
        }
      }
    }
  }
}

async function processMonthlyReset(monthKey: string) {
  const snapshots = await prisma.rankingSnapshot.findMany({
    where: { periodType: "MONTHLY", periodKey: monthKey },
    orderBy: { xpEarned: "desc" },
    take: 3,
  });

  const xpByPosition: Record<number, number> = { 1: 800, 2: 500, 3: 300 };
  const reasonByPosition: Record<number, "MONTHLY_RANKING_1ST" | "MONTHLY_RANKING_2ND" | "MONTHLY_RANKING_3RD"> = {
    1: "MONTHLY_RANKING_1ST",
    2: "MONTHLY_RANKING_2ND",
    3: "MONTHLY_RANKING_3RD",
  };

  for (let i = 0; i < snapshots.length; i++) {
    const position = i + 1;
    const snap = snapshots[i];

    await awardXp(snap.userId, xpByPosition[position], reasonByPosition[position], `monthly:${monthKey}`);

    await createAutoPost(snap.userId, "RANKING_MONTH_ENDED_TOP3", {
      referenceId: `monthly:${monthKey}:pos${position}`,
      metadata: { position, monthKey, xpEarned: snap.xpEarned },
    });
  }

  // Check top 5 for monthly feed posts (positions 4 and 5 get a post too)
  const top5 = await prisma.rankingSnapshot.findMany({
    where: { periodType: "MONTHLY", periodKey: monthKey },
    orderBy: { xpEarned: "desc" },
    take: 5,
  });

  for (let i = 3; i < top5.length; i++) {
    await createAutoPost(top5[i].userId, "RANKING_ENTERED_MONTHLY_TOP5", {
      referenceId: `monthly:${monthKey}:top5:${i + 1}`,
      metadata: { position: i + 1, monthKey },
    });
  }
}

async function processDailyPositionTracker(now: Date) {
  const weekKey = getWeekKey(now);

  const snapshots = await prisma.rankingSnapshot.findMany({
    where: { periodType: "WEEKLY", periodKey: weekKey },
    orderBy: { xpEarned: "desc" },
    take: 10000,
  });

  // Compute global positions for this week
  const updates: Array<Promise<void>> = [];

  for (let i = 0; i < snapshots.length; i++) {
    const currentPosition = i + 1;
    const snap = snapshots[i];
    const prevPosition = snap.lastKnownPosition;

    // Update stored position
    updates.push(
      prisma.rankingSnapshot
        .update({
          where: { id: snap.id },
          data: { lastKnownPosition: currentPosition },
        })
        .then(() => undefined)
    );

    if (prevPosition === null || prevPosition === undefined) continue;

    // Position improved
    if (currentPosition < prevPosition) {
      await createAutoPost(snap.userId, "RANKING_POSITION_CLIMBED", {
        referenceId: `climbed:${weekKey}:${snap.userId}:${currentPosition}`,
        metadata: {
          fromPosition: prevPosition,
          toPosition: currentPosition,
          positionsClimbed: prevPosition - currentPosition,
          period: "WEEKLY",
          periodKey: weekKey,
        },
      });

      // Check if entered top 3
      if (currentPosition <= 3 && prevPosition > 3) {
        await createAutoPost(snap.userId, "RANKING_ENTERED_WEEKLY_TOP3", {
          referenceId: `weekly-top3:${weekKey}:${snap.userId}`,
          metadata: { position: currentPosition, weekKey },
        });
        await checkAndUnlock(snap.userId, ["WEEKLY_TOP3_REACHED"]);
      }

      // Check top 5 general
      const generalSnaps = await prisma.rankingSnapshot.findMany({
        where: { periodType: "ALLTIME", periodKey: "alltime" },
        orderBy: { xpEarned: "desc" },
        take: 5,
      });
      const generalPos = generalSnaps.findIndex((s) => s.userId === snap.userId) + 1;
      if (generalPos >= 1 && generalPos <= 5) {
        await createAutoPost(snap.userId, "RANKING_ENTERED_GENERAL_TOP5", {
          referenceId: `general-top5:alltime:${snap.userId}`,
          metadata: { position: generalPos },
        });
      }
    }
  }

  await Promise.all(updates);
}

export function startCommunityJobs() {
  if (timer) return;

  timer = setInterval(async () => {
    if (running || Date.now() < nextAllowedRunAt) return;
    running = true;
    let lockAcquired = false;

    try {
      const lockResult = (
        await prisma.$queryRaw<Array<{ pg_try_advisory_lock: boolean }>>`
          SELECT pg_try_advisory_lock(${COMMUNITY_JOB_LOCK_KEY})
        `
      )?.[0];
      lockAcquired = Boolean(lockResult?.pg_try_advisory_lock);
      if (!lockAcquired) return;

      await runCommunityJobs();
      consecutiveDatabaseFailures = 0;
      nextAllowedRunAt = 0;
    } catch (error) {
      if (isPrismaDatabaseUnavailableError(error)) {
        consecutiveDatabaseFailures += 1;
        const backoff = calculateBackoffMs(consecutiveDatabaseFailures);
        nextAllowedRunAt = Date.now() + backoff;
        console.error(
          `Community jobs paused: database unavailable. Next retry in ${Math.ceil(backoff / 1000)}s.`
        );
      } else {
        // Frente 2 (segunda camada), Lote 8: mesmo padrão já usado em
        // reminder.job.ts/payment-jobs.ts (Frente 9, Lote 14).
        console.error("Community jobs failed:", error);
        Sentry.captureException(error, { tags: { area: "community-jobs" } });
      }
    } finally {
      if (lockAcquired) {
        try {
          await prisma.$executeRaw`SELECT pg_advisory_unlock(${COMMUNITY_JOB_LOCK_KEY})`;
        } catch {
          // ignore unlock errors on DB failure
        }
      }
      running = false;
    }
  }, JOB_INTERVAL_MS);
}

export function stopCommunityJobs() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  running = false;
  consecutiveDatabaseFailures = 0;
  nextAllowedRunAt = 0;
}
