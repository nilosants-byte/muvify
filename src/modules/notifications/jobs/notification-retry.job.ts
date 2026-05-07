import { prisma } from "../../../config/prisma";
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
    let lockAcquired = false;
    try {
      const lockResult = (await prisma.$queryRaw<
        Array<{ pg_try_advisory_lock: boolean }>
      >`SELECT pg_try_advisory_lock(${notificationRetryLockKey})`)?.[0];
      lockAcquired = Boolean(lockResult?.pg_try_advisory_lock);
      if (!lockAcquired) {
        return;
      }
      await notificationService.processRetryQueue();
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
        console.error("Notification retry job failed:", error);
      }
    } finally {
      if (lockAcquired) {
        try {
          await prisma.$executeRaw`SELECT pg_advisory_unlock(${notificationRetryLockKey})`;
        } catch (unlockError) {
          if (isPrismaDatabaseUnavailableError(unlockError)) {
            console.error(
              "Skipped notification retry job lock release because database became unavailable."
            );
          } else {
            console.error("Failed to release notification retry job lock:", unlockError);
          }
        }
      }
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
