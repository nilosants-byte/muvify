import * as Sentry from "@sentry/node";
import { prisma } from "../../../config/prisma";
import { env } from "../../../config/env";
import { recordJobFailure, recordJobSuccess } from "../../../observability/metrics";
import { isPrismaDatabaseUnavailableError } from "../../../shared/utils/prisma-error";
import { NotificationService } from "../../notifications/services/notification.service";
import { getWeekKey } from "../services/xp.service";
import { diffInCalendarDays, hasMetWeeklyGoal } from "../services/streak.service";

// Retenção: lembrete diário de treino (só quem já configurou meta semanal
// de propósito, ver weeklyGoalConfiguredAt em updateTrainingDaysConfig) e
// nudge semanal sugerindo configurar meta pra quem nunca mexeu nisso.
// Job próprio (não entra em reminder.job.ts) porque compara hora do
// relógio (meio-dia local), não deadlines individuais salvos no banco -
// mesmo tipo de padrão que community.jobs.ts já usa pra "hoje é
// segunda?"/"hoje é dia 1?".
const GOAL_REMINDER_JOB_LOCK_KEY = 909_007;
const MAX_DATABASE_BACKOFF_MS = 5 * 60 * 1000;
const DAILY_REMINDER_THROTTLE_MS = 20 * 60 * 60 * 1000;
const WEEKLY_NUDGE_THROTTLE_MS = 6.5 * 24 * 60 * 60 * 1000;
const NOON_LOCAL_HOUR = 12;

const notificationService = new NotificationService();

let timer: NodeJS.Timeout | null = null;
let running = false;
let consecutiveDatabaseFailures = 0;
let nextAllowedRunAt = 0;

function calculateBackoffMs(intervalMs: number, failures: number) {
  return Math.min(intervalMs * 2 ** Math.max(0, failures - 1), MAX_DATABASE_BACKOFF_MS);
}

function isPastLocalNoon(now: Date): boolean {
  const localHour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: env.APP_TIMEZONE, hour: "2-digit", hour12: false }).format(now)
  );
  return localHour >= NOON_LOCAL_HOUR;
}

// Exportadas só pra permitir teste direto (mesmo padrão de
// processDailyPositionTracker em community.jobs.ts), sem depender do timer
// real de startGoalReminderJob.
export async function sendDailyTrainingReminders(now: Date) {
  if (!isPastLocalNoon(now)) return;

  const candidates = await prisma.user.findMany({
    where: {
      role: "CLIENT",
      weeklyGoalConfiguredAt: { not: null },
      OR: [
        { lastGoalReminderSentAt: null },
        { lastGoalReminderSentAt: { lt: new Date(now.getTime() - DAILY_REMINDER_THROTTLE_MS) } }
      ]
    },
    select: { id: true, streak: true },
    take: 200
  });
  if (candidates.length === 0) return;

  const weekKey = getWeekKey(now);
  const toRemind = candidates.filter((user) => {
    if (hasMetWeeklyGoal(user.streak, weekKey)) return false;
    const trainedToday = user.streak?.lastTrainingDate
      ? diffInCalendarDays(now, user.streak.lastTrainingDate) === 0
      : false;
    return !trainedToday;
  });
  if (toRemind.length === 0) return;

  await prisma.user.updateMany({
    where: { id: { in: toRemind.map((u) => u.id) } },
    data: { lastGoalReminderSentAt: now }
  });

  for (const user of toRemind) {
    void notificationService
      .sendToUsers([user.id], {
        preferenceType: "COMMUNITY",
        title: "Ainda dá tempo de treinar hoje",
        body: "Você ainda não treinou hoje e sua meta da semana está esperando por você.",
        data: { type: "DAILY_TRAINING_REMINDER" }
      })
      .catch((e) => console.error("Daily training reminder failed:", e));
  }
}

export async function sendWeeklyGoalSetupNudges(now: Date) {
  const candidates = await prisma.user.findMany({
    where: {
      role: "CLIENT",
      weeklyGoalConfiguredAt: null,
      OR: [
        { lastGoalSetupNudgeSentAt: null },
        { lastGoalSetupNudgeSentAt: { lt: new Date(now.getTime() - WEEKLY_NUDGE_THROTTLE_MS) } }
      ]
    },
    select: { id: true },
    take: 200
  });
  if (candidates.length === 0) return;

  await prisma.user.updateMany({
    where: { id: { in: candidates.map((u) => u.id) } },
    data: { lastGoalSetupNudgeSentAt: now }
  });

  for (const user of candidates) {
    void notificationService
      .sendToUsers([user.id], {
        preferenceType: "COMMUNITY",
        title: "Que tal definir sua meta da semana?",
        body: "Configure quantos dias por semana você quer treinar e crie o hábito com lembretes personalizados.",
        data: { type: "WEEKLY_GOAL_SETUP_NUDGE" }
      })
      .catch((e) => console.error("Weekly goal setup nudge failed:", e));
  }
}

export function startGoalReminderJob() {
  if (timer || env.NODE_ENV === "test" || !env.RUN_GOAL_REMINDER_JOBS) {
    return;
  }
  timer = setInterval(async () => {
    if (running || Date.now() < nextAllowedRunAt) return;
    running = true;
    let lockAcquired = false;

    try {
      const lockResult = (
        await prisma.$queryRaw<Array<{ pg_try_advisory_lock: boolean }>>`
          SELECT pg_try_advisory_lock(${GOAL_REMINDER_JOB_LOCK_KEY})
        `
      )?.[0];
      lockAcquired = Boolean(lockResult?.pg_try_advisory_lock);
      if (!lockAcquired) return;

      const now = new Date();
      await sendDailyTrainingReminders(now);
      await sendWeeklyGoalSetupNudges(now);

      recordJobSuccess("goal-reminder-job");
      consecutiveDatabaseFailures = 0;
      nextAllowedRunAt = 0;
    } catch (error) {
      if (isPrismaDatabaseUnavailableError(error)) {
        consecutiveDatabaseFailures += 1;
        const backoff = calculateBackoffMs(env.GOAL_REMINDER_JOB_INTERVAL_MINUTES * 60 * 1000, consecutiveDatabaseFailures);
        nextAllowedRunAt = Date.now() + backoff;
        console.error(`Goal reminder job paused: database unavailable. Next retry in ${Math.ceil(backoff / 1000)}s.`);
      } else {
        console.error("Goal reminder job failed:", error);
        Sentry.captureException(error, { tags: { area: "goal-reminder-job" } });
        recordJobFailure("goal-reminder-job");
      }
    } finally {
      if (lockAcquired) {
        try {
          await prisma.$executeRaw`SELECT pg_advisory_unlock(${GOAL_REMINDER_JOB_LOCK_KEY})`;
        } catch {
          // ignore unlock errors on DB failure
        }
      }
      running = false;
    }
  }, env.GOAL_REMINDER_JOB_INTERVAL_MINUTES * 60 * 1000);
}

export function stopGoalReminderJob() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  running = false;
  consecutiveDatabaseFailures = 0;
  nextAllowedRunAt = 0;
}
