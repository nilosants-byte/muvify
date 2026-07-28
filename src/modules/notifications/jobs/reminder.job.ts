import { env } from "../../../config/env";
import { prisma } from "../../../config/prisma";
import { isPrismaDatabaseUnavailableError } from "../../../shared/utils/prisma-error";
import { BookingService } from "../../bookings/services/booking.service";
import { ConsultancyService } from "../../consultancy/services/consultancy.service";
import { PresentialPackageService } from "../../presential-packages/services/presential-package.service";

const bookingService = new BookingService();
const consultancyService = new ConsultancyService();
const presentialPackageService = new PresentialPackageService();

let timer: NodeJS.Timeout | null = null;
let running = false;
const reminderJobLockKey = 909_006;
const MAX_DATABASE_BACKOFF_MS = 5 * 60 * 1000;
let consecutiveDatabaseFailures = 0;
let nextAllowedRunAt = 0;

function calculateBackoffMs(baseIntervalMs: number, failures: number) {
  const exponent = Math.max(0, failures - 1);
  return Math.min(baseIntervalMs * 2 ** exponent, MAX_DATABASE_BACKOFF_MS);
}

export function startReminderJob() {
  if (timer || env.NODE_ENV === "test" || !env.RUN_REMINDER_JOBS) {
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
      >`SELECT pg_try_advisory_lock(${reminderJobLockKey})`)?.[0];
      lockAcquired = Boolean(lockResult?.pg_try_advisory_lock);
      if (!lockAcquired) {
        return;
      }

      const JOB_TIMEOUT_MS = 120_000; // 2 minutos
      await Promise.race([
        Promise.all([
          bookingService.sendSessionReminders(),
          bookingService.sendBookingConfirmationReminders(),
          consultancyService.sendConsultancyExpiryReminders(),
          consultancyService.expireStaleConsultancyRequests(),
          consultancyService.expireStalePendingPixConsultancyContracts(),
          consultancyService.sendFichaExpiryReminders(),
          consultancyService.escalateExpiredFichaContracts(),
          presentialPackageService.sendFlexibleSessionPackExpiryReminders(),
        ]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Reminder job timeout after 120s")), JOB_TIMEOUT_MS)
        ),
      ]);
      consecutiveDatabaseFailures = 0;
      nextAllowedRunAt = 0;
    } catch (error) {
      if (isPrismaDatabaseUnavailableError(error)) {
        consecutiveDatabaseFailures += 1;
        const backoffMs = calculateBackoffMs(
          env.REMINDER_JOB_INTERVAL_SECONDS * 1000,
          consecutiveDatabaseFailures
        );
        nextAllowedRunAt = Date.now() + backoffMs;
        console.error(
          `Reminder job paused: database unavailable (${(error as any).code}). Next retry in ${Math.ceil(backoffMs / 1000)}s.`
        );
      } else {
        console.error("Reminder job failed:", error);
      }
    } finally {
      if (lockAcquired) {
        try {
          await prisma.$executeRaw`SELECT pg_advisory_unlock(${reminderJobLockKey})`;
        } catch (unlockError) {
          if (isPrismaDatabaseUnavailableError(unlockError)) {
            console.error("Skipped reminder job lock release because database became unavailable.");
          } else {
            console.error("Failed to release reminder job lock:", unlockError);
          }
        }
      }
      running = false;
    }
  }, env.REMINDER_JOB_INTERVAL_SECONDS * 1000);
}

export function stopReminderJob() {
  if (!timer) {
    return;
  }
  clearInterval(timer);
  timer = null;
  running = false;
  consecutiveDatabaseFailures = 0;
  nextAllowedRunAt = 0;
}
