import * as Sentry from "@sentry/node";
import { env } from "../../../config/env";
import { prisma } from "../../../config/prisma";
import { isPrismaDatabaseUnavailableError } from "../../../shared/utils/prisma-error";
import { BookingService } from "../../bookings/services/booking.service";
import { ConsultancyService } from "../../consultancy/services/consultancy.service";
import { PresentialPackageService } from "../../presential-packages/services/presential-package.service";
import { PaymentService } from "../services/payment.service";

const bookingService = new BookingService();
const paymentService = new PaymentService();
const consultancyService = new ConsultancyService();
const presentialPackageService = new PresentialPackageService();

let timer: NodeJS.Timeout | null = null;
let running = false;
const paymentJobLockKey = 909_001;
const MAX_DATABASE_BACKOFF_MS = 5 * 60 * 1000;
let consecutiveDatabaseFailures = 0;
let nextAllowedRunAt = 0;

function calculateBackoffMs(baseIntervalMs: number, failures: number) {
  const exponent = Math.max(0, failures - 1);
  return Math.min(baseIntervalMs * 2 ** exponent, MAX_DATABASE_BACKOFF_MS);
}

export function startPaymentJobs() {
  if (timer || env.NODE_ENV === "test" || !env.RUN_PAYMENT_JOBS) {
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
      >`SELECT pg_try_advisory_lock(${paymentJobLockKey})`)?.[0];
      lockAcquired = Boolean(lockResult?.pg_try_advisory_lock);
      if (!lockAcquired) {
        return;
      }

      const JOB_TIMEOUT_MS = 5 * 60 * 1000; // 5 min por job
      const runWithTimeout = (fn: () => Promise<void>, name: string) =>
        Promise.race([
          fn(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`${name} timeout after 5min`)), JOB_TIMEOUT_MS)
          ),
        ]).catch((err) => {
          // Erros de DB indisponível são re-lançados para incrementar consecutiveDatabaseFailures
          if (isPrismaDatabaseUnavailableError(err)) throw err;
          console.error(`[payment-jobs] ${name} failed:`, err);
          // Épico de Frentes, Frente 9, Lote 14: catches deste job só
          // usavam console.error, sem Sentry.captureException - diferente
          // de pontos críticos de pagamento (payment.service.ts) que já
          // usam Sentry deliberadamente.
          Sentry.captureException(err, { tags: { area: "payment-jobs", subJob: name } });
        });

      // Cada job é isolado — falha de um não impede os demais
      await runWithTimeout(() => bookingService.releaseDueAttendanceCodes(), "releaseDueAttendanceCodes");
      await runWithTimeout(() => bookingService.autoExpireStaleBookings(), "autoExpireStaleBookings");
      await runWithTimeout(() => paymentService.autoExpirePixPayments(), "autoExpirePixPayments");
      await runWithTimeout(() => paymentService.autoRefundExpiredBookings(), "autoRefundExpiredBookings");
      await runWithTimeout(() => paymentService.authorizeDuePayments(), "authorizeDuePayments");
      await runWithTimeout(() => paymentService.autoCaptureSingleConfirmation(), "autoCaptureSingleConfirmation");
      await runWithTimeout(() => bookingService.resolveExpiredNoShowReports(), "resolveExpiredNoShowReports");
      await runWithTimeout(() => consultancyService.autoRefundExpiredContracts(), "autoRefundExpiredContracts");
      await runWithTimeout(() => presentialPackageService.chargeDueCycles(), "presentialPackageChargeDueCycles");
      await runWithTimeout(
        () => presentialPackageService.generateDueCardFixedPeriods(),
        "presentialPackageGenerateDueCardFixedPeriods"
      );
      await runWithTimeout(
        () => presentialPackageService.expireStalePendingPixCharges(),
        "presentialPackageExpireStalePendingPixCharges"
      );
      await runWithTimeout(() => paymentService.refreshProviderMpTokens(), "refreshProviderMpTokens");
      consecutiveDatabaseFailures = 0;
      nextAllowedRunAt = 0;
    } catch (error) {
      if (isPrismaDatabaseUnavailableError(error)) {
        consecutiveDatabaseFailures += 1;
        const backoffMs = calculateBackoffMs(
          env.PAYMENT_JOB_INTERVAL_SECONDS * 1000,
          consecutiveDatabaseFailures
        );
        nextAllowedRunAt = Date.now() + backoffMs;
        console.error(
          `Payment job paused: database unavailable (${error.code}). Next retry in ${Math.ceil(backoffMs / 1000)}s.`
        );
      } else {
        console.error("Payment job failed:", error);
        Sentry.captureException(error, { tags: { area: "payment-jobs" } });
      }
    } finally {
      if (lockAcquired) {
        try {
          await prisma.$executeRaw`SELECT pg_advisory_unlock(${paymentJobLockKey})`;
        } catch (unlockError) {
          if (isPrismaDatabaseUnavailableError(unlockError)) {
            console.error("Skipped payment job lock release because database became unavailable.");
          } else {
            console.error("Failed to release payment job lock:", unlockError);
          }
        }
      }
      running = false;
    }
  }, env.PAYMENT_JOB_INTERVAL_SECONDS * 1000);
}

export function stopPaymentJobs() {
  if (!timer) {
    return;
  }
  clearInterval(timer);
  timer = null;
  running = false;
  consecutiveDatabaseFailures = 0;
  nextAllowedRunAt = 0;
}
