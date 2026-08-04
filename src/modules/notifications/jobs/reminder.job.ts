import * as Sentry from "@sentry/node";
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

// Épico de Frentes, Frente 9, Lote 14: os catches deste job só usavam
// console.error, sem Sentry.captureException - diferente de pontos
// críticos de pagamento (payment.service.ts) que já usam Sentry
// deliberadamente. Cada sub-job é isolado (mesmo espírito do
// runWithTimeout em payment-jobs.ts - falha de um não impede os demais) e
// reporta ao Sentry com a tag indicando qual sub-job falhou. Exportado
// (em vez de inline) pra ficar testável sem depender do setInterval real.
export function isolateReminderSubJob(fn: () => Promise<void>, name: string) {
  return fn().catch((err) => {
    if (isPrismaDatabaseUnavailableError(err)) throw err;
    console.error(`[reminder-job] ${name} failed:`, err);
    Sentry.captureException(err, { tags: { area: "reminder-job", subJob: name } });
  });
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
          isolateReminderSubJob(() => bookingService.sendSessionReminders(), "sendSessionReminders"),
          isolateReminderSubJob(
            () => bookingService.sendBookingConfirmationReminders(),
            "sendBookingConfirmationReminders"
          ),
          isolateReminderSubJob(
            () => consultancyService.sendConsultancyExpiryReminders(),
            "sendConsultancyExpiryReminders"
          ),
          isolateReminderSubJob(
            () => consultancyService.sendConsultancyResponseReminders(),
            "sendConsultancyResponseReminders"
          ),
          isolateReminderSubJob(
            () => consultancyService.expireStaleConsultancyRequests(),
            "expireStaleConsultancyRequests"
          ),
          isolateReminderSubJob(
            () => consultancyService.expireStalePendingPixConsultancyContracts(),
            "expireStalePendingPixConsultancyContracts"
          ),
          isolateReminderSubJob(() => consultancyService.sendFichaExpiryReminders(), "sendFichaExpiryReminders"),
          isolateReminderSubJob(
            () => consultancyService.escalateExpiredFichaContracts(),
            "escalateExpiredFichaContracts"
          ),
          isolateReminderSubJob(
            () => presentialPackageService.sendFlexibleSessionPackExpiryReminders(),
            "sendFlexibleSessionPackExpiryReminders"
          ),
          isolateReminderSubJob(
            () => presentialPackageService.sendPresentialPackageBillingReminders(),
            "sendPresentialPackageBillingReminders"
          ),
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
        Sentry.captureException(error, { tags: { area: "reminder-job" } });
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
