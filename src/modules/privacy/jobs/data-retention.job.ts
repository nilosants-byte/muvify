import * as Sentry from "@sentry/node";
import { env } from "../../../config/env";
import { prisma } from "../../../config/prisma";
import { recordJobFailure, recordJobSuccess } from "../../../observability/metrics";
import { isPrismaDatabaseUnavailableError } from "../../../shared/utils/prisma-error";
import { DataRetentionService } from "../services/data-retention.service";

const retentionService = new DataRetentionService();
const retentionJobLockKey = 909_005;
const MAX_DATABASE_BACKOFF_MS = 5 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;
let consecutiveDatabaseFailures = 0;
let nextAllowedRunAt = 0;

function calculateBackoffMs(baseIntervalMs: number, failures: number) {
  const exponent = Math.max(0, failures - 1);
  return Math.min(baseIntervalMs * 2 ** exponent, MAX_DATABASE_BACKOFF_MS);
}

function parseLegalHoldUserIds() {
  return env.DATA_RETENTION_LEGAL_HOLD_USER_IDS.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function startDataRetentionJob() {
  if (timer || env.NODE_ENV === "test" || !env.RUN_DATA_RETENTION_JOBS) {
    return;
  }

  const intervalMs = env.DATA_RETENTION_JOB_INTERVAL_MINUTES * 60 * 1000;
  timer = setInterval(async () => {
    if (running || Date.now() < nextAllowedRunAt) {
      return;
    }

    running = true;
    let lockAcquired = false;
    try {
      const lockResult = (await prisma.$queryRaw<
        Array<{ pg_try_advisory_lock: boolean }>
      >`SELECT pg_try_advisory_lock(${retentionJobLockKey})`)?.[0];
      lockAcquired = Boolean(lockResult?.pg_try_advisory_lock);
      if (!lockAcquired) {
        return;
      }

      const legalHoldUserIds = await retentionService.resolveLegalHoldUserIds(parseLegalHoldUserIds());
      const result = await retentionService.run({
        dryRun: env.DATA_RETENTION_DRY_RUN,
        triggeredBy: "SYSTEM_SCHEDULED_JOB",
        legalHoldUserIds
      });

      console.log(
        `[DATA_RETENTION] success dryRun=${String(result.dryRun)} matched=${result.totals.matchedCount} affected=${result.totals.affectedCount}`
      );
      if (result.status === "PARTIAL_FAILURE") {
        recordJobFailure("data-retention-job");
      } else {
        recordJobSuccess("data-retention-job");
      }

      consecutiveDatabaseFailures = 0;
      nextAllowedRunAt = 0;
    } catch (error) {
      if (isPrismaDatabaseUnavailableError(error)) {
        consecutiveDatabaseFailures += 1;
        const backoffMs = calculateBackoffMs(intervalMs, consecutiveDatabaseFailures);
        nextAllowedRunAt = Date.now() + backoffMs;
        console.error(
          `Data retention job paused: database unavailable (${error.code}). Next retry in ${Math.ceil(backoffMs / 1000)}s.`
        );
      } else {
        // Frente 2 (segunda camada), Lote 8: mesmo padrão já usado em
        // reminder.job.ts/payment-jobs.ts (Frente 9, Lote 14).
        console.error("[DATA_RETENTION] failed:", error);
        Sentry.captureException(error, { tags: { area: "data-retention-job" } });
        recordJobFailure("data-retention-job");
      }
    } finally {
      if (lockAcquired) {
        try {
          await prisma.$executeRaw`SELECT pg_advisory_unlock(${retentionJobLockKey})`;
        } catch (unlockError) {
          if (isPrismaDatabaseUnavailableError(unlockError)) {
            console.error(
              "Skipped data retention job lock release because database became unavailable."
            );
          } else {
            console.error("Failed to release data retention job lock:", unlockError);
          }
        }
      }
      running = false;
    }
  }, intervalMs);
}

export function stopDataRetentionJob() {
  if (!timer) {
    return;
  }
  clearInterval(timer);
  timer = null;
  running = false;
  consecutiveDatabaseFailures = 0;
  nextAllowedRunAt = 0;
}
