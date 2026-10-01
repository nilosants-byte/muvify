import * as Sentry from "@sentry/node";
import { recordJobFailure, recordJobSuccess } from "../../../observability/metrics";
import { withJobLock } from "../../../shared/utils/job-lock";
import { isPrismaDatabaseUnavailableError } from "../../../shared/utils/prisma-error";
import { NotificationService } from "../services/notification.service";

const notificationService = new NotificationService();
const notificationRetryLockKey = 909_002;
const RETRY_JOB_INTERVAL_MS = 30_000; // run every 30 s
const MAX_DATABASE_BACKOFF_MS = 5 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;
let consecutiveDatabaseFailures = 0;
let nextAllowedRunAt = 0;

function calculateBackoffMs(baseIntervalMs: number, failures: number) {
  const exponent = Math.max(0, failures - 1);
  return Math.min(baseIntervalMs * 2 ** exponent, MAX_DATABASE_BACKOFF_MS);
}

export function startNotificationRetryJob() {
  if (timer) {
    return;
  }
  timer = setInterval(async () => {
    if (running || Date.now() < nextAllowedRunAt) {
      return;
    }
    running = true;
    try {
      const acquired = await withJobLock(notificationRetryLockKey, async () => {
        const JOB_TIMEOUT_MS = 120_000; // 2 minutos
        await Promise.race([
          notificationService.processRetryQueue(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Notification retry job timeout after 120s")), JOB_TIMEOUT_MS)
          ),
        ]);
      });
      if (!acquired) {
        return;
      }
      recordJobSuccess("notification-retry-job");
      consecutiveDatabaseFailures = 0;
      nextAllowedRunAt = 0;
    } catch (error) {
      if (isPrismaDatabaseUnavailableError(error)) {
        consecutiveDatabaseFailures += 1;
        const backoffMs = calculateBackoffMs(RETRY_JOB_INTERVAL_MS, consecutiveDatabaseFailures);
        nextAllowedRunAt = Date.now() + backoffMs;
        console.error(
          `Notification retry job paused: database unavailable (${error.code}). Next retry in ${Math.ceil(backoffMs / 1000)}s.`
        );
      } else {
        // Frente 2 (segunda camada), Lote 8: mesmo padrão já usado em
        // reminder.job.ts/payment-jobs.ts (Frente 9, Lote 14).
        console.error("Notification retry job failed:", error);
        Sentry.captureException(error, { tags: { area: "notification-retry-job" } });
        recordJobFailure("notification-retry-job");
      }
    } finally {
      running = false;
    }
  }, RETRY_JOB_INTERVAL_MS);
}

export function stopNotificationRetryJob() {
  if (!timer) {
    return;
  }
  clearInterval(timer);
  timer = null;
  running = false;
  consecutiveDatabaseFailures = 0;
  nextAllowedRunAt = 0;
}
