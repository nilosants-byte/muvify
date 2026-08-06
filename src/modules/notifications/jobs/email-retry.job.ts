import * as Sentry from "@sentry/node";
import { env } from "../../../config/env";
import { prisma } from "../../../config/prisma";
import { EmailQueueService } from "../../../shared/services/email-queue.service";
import { isPrismaDatabaseUnavailableError } from "../../../shared/utils/prisma-error";

const emailQueueService = new EmailQueueService();
const emailRetryLockKey = 909_003;
const RETRY_JOB_INTERVAL_MS = env.EMAIL_RETRY_JOB_INTERVAL_SECONDS * 1000;
const MAX_DATABASE_BACKOFF_MS = 5 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;
let consecutiveDatabaseFailures = 0;
let nextAllowedRunAt = 0;

function calculateBackoffMs(baseIntervalMs: number, failures: number) {
  const exponent = Math.max(0, failures - 1);
  return Math.min(baseIntervalMs * 2 ** exponent, MAX_DATABASE_BACKOFF_MS);
}

export function startEmailRetryJob() {
  if (timer || !env.RUN_EMAIL_RETRY_JOB) {
    return;
  }

  timer = setInterval(async () => {
    if (running || Date.now() < nextAllowedRunAt) {
      return;
    }
    running = true;
    let lockAcquired = false;
    try {
      const lockResult = (await prisma.$queryRaw<
        Array<{ pg_try_advisory_lock: boolean }>
      >`SELECT pg_try_advisory_lock(${emailRetryLockKey})`)?.[0];
      lockAcquired = Boolean(lockResult?.pg_try_advisory_lock);
      if (!lockAcquired) {
        return;
      }
      await emailQueueService.processRetryQueue();
      try {
        await emailQueueService.purgeOldFailures();
      } catch {
        // non-critical — purge failure does not affect retry processing
      }
      consecutiveDatabaseFailures = 0;
      nextAllowedRunAt = 0;
    } catch (error) {
      if (isPrismaDatabaseUnavailableError(error)) {
        consecutiveDatabaseFailures += 1;
        const backoffMs = calculateBackoffMs(RETRY_JOB_INTERVAL_MS, consecutiveDatabaseFailures);
        nextAllowedRunAt = Date.now() + backoffMs;
        console.error(
          `Email retry job paused: database unavailable (${error.code}). Next retry in ${Math.ceil(backoffMs / 1000)}s.`
        );
      } else {
        // Frente 2 (segunda camada), Lote 8: mesmo padrão já usado em
        // reminder.job.ts/payment-jobs.ts (Frente 9, Lote 14) — um bug
        // persistente neste job (não é queda de banco, que já tem
        // tratamento de backoff acima) ficava invisível pra sempre, só
        // com console.error.
        console.error("Email retry job failed:", error);
        Sentry.captureException(error, { tags: { area: "email-retry-job" } });
      }
    } finally {
      if (lockAcquired) {
        try {
          await prisma.$executeRaw`SELECT pg_advisory_unlock(${emailRetryLockKey})`;
        } catch (unlockError) {
          if (isPrismaDatabaseUnavailableError(unlockError)) {
            console.error("Skipped email retry job lock release because database became unavailable.");
          } else {
            console.error("Failed to release email retry job lock:", unlockError);
          }
        }
      }
      running = false;
    }
  }, RETRY_JOB_INTERVAL_MS);
}

export function stopEmailRetryJob() {
  if (!timer) {
    return;
  }
  clearInterval(timer);
  timer = null;
  running = false;
  consecutiveDatabaseFailures = 0;
  nextAllowedRunAt = 0;
}
