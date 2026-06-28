import http from "node:http";
import { app } from "./app";
import { env } from "./config/env";
import { prisma } from "./config/prisma";
import { connectRedis, redis } from "./config/redis";
import { startPaymentJobs, stopPaymentJobs } from "./modules/payments/jobs/payment-jobs";
import { startEmailRetryJob, stopEmailRetryJob } from "./modules/notifications/jobs/email-retry.job";
import { startNotificationRetryJob, stopNotificationRetryJob } from "./modules/notifications/jobs/notification-retry.job";
import { startDataRetentionJob, stopDataRetentionJob } from "./modules/privacy/jobs/data-retention.job";
import { startCommunityJobs, stopCommunityJobs } from "./modules/community/jobs/community.jobs";
import { startReminderJob, stopReminderJob } from "./modules/notifications/jobs/reminder.job";
import { initSocketServer, stopSocketServer } from "./realtime/socket";
import { initSentry } from "./config/sentry";
import { EmailService } from "./shared/services/email.service";

// Inicializa Sentry antes de tudo (só ativa se SENTRY_DSN estiver no .env)
initSentry();

let server: http.Server | null = null;
let isShuttingDown = false;
const emailService = new EmailService();

async function shutdown(reason: string, error?: unknown) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  // Remove listeners to prevent double-firing during shutdown
  process.off("SIGINT", sigintHandler);
  process.off("SIGTERM", sigtermHandler);
  process.off("uncaughtException", uncaughtHandler);
  process.off("unhandledRejection", rejectionHandler);

  if (error) {
    console.error(reason, error);
  } else {
    console.log(reason);
  }

  // Stop accepting new HTTP requests and wait for in-flight requests to finish
  if (server) {
    await new Promise<void>((resolve) => {
      server!.close(() => resolve());
      // Force-close after 10 s to avoid hanging indefinitely
      setTimeout(() => resolve(), 10_000);
    });
  }

  try {
    stopPaymentJobs();
    stopEmailRetryJob();
    stopNotificationRetryJob();
    stopDataRetentionJob();
    stopCommunityJobs();
    stopReminderJob();
    await stopSocketServer();
    await prisma.$disconnect();
  } catch (disconnectError) {
    console.error("Failed to disconnect Prisma:", disconnectError);
  }

  try {
    if (redis.status === "ready") {
      await redis.quit();
    }
  } catch (redisError) {
    console.error("Failed to quit Redis:", redisError);
  }

  process.exit(error ? 1 : 0);
}

// Named handlers so they can be removed on shutdown
const sigintHandler = () => void shutdown("SIGINT received. Shutting down.");
const sigtermHandler = () => void shutdown("SIGTERM received. Shutting down.");
const uncaughtHandler = (error: Error) =>
  void shutdown("Uncaught exception. Shutting down.", error);
const rejectionHandler = (error: unknown) =>
  void shutdown("Unhandled rejection. Shutting down.", error);

process.on("SIGINT", sigintHandler);
process.on("SIGTERM", sigtermHandler);
process.on("uncaughtException", uncaughtHandler);
process.on("unhandledRejection", rejectionHandler);

async function bootstrap() {
  await prisma.$connect();
  await connectRedis();
  if (env.AUTH_REQUIRE_REDIS_FOR_BLACKLIST && redis.status !== "ready") {
    throw new Error(
      "Redis indisponivel no bootstrap com AUTH_REQUIRE_REDIS_FOR_BLACKLIST=true."
    );
  }
  if (!env.AUTH_REQUIRE_REDIS_FOR_BLACKLIST && redis.status !== "ready") {
    console.warn(
      "Redis indisponivel no bootstrap. Seguindo em modo degradado (fallback local por instancia)."
    );
  }

  if (env.SMTP_VERIFY_ON_STARTUP && emailService.canSendEmail()) {
    try {
      await emailService.verifyConnection();
    } catch (error) {
      if (env.NODE_ENV === "production") {
        throw error;
      }

      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `[SMTP_VERIFY_ON_STARTUP] Falha de verificacao em ${env.NODE_ENV}. ` +
          `Seguindo em modo degradado. reason=${reason}`
      );
    }
  }
  startPaymentJobs();
  if (!env.RUN_PAYMENT_JOBS) {
    console.log("Payment jobs disabled by RUN_PAYMENT_JOBS=false");
  }
  startEmailRetryJob();
  if (!env.RUN_EMAIL_RETRY_JOB) {
    console.log("Email retry job disabled by RUN_EMAIL_RETRY_JOB=false");
  }
  startDataRetentionJob();
  if (!env.RUN_DATA_RETENTION_JOBS) {
    console.log("Data retention job disabled by RUN_DATA_RETENTION_JOBS=false");
  }
  server = app.listen(env.PORT, () => {
    console.log(`HTTP server running on port ${env.PORT}`);
  });
  await initSocketServer(server);
  startNotificationRetryJob();
  startCommunityJobs();
  startReminderJob();
  if (!env.RUN_REMINDER_JOBS) {
    console.log("Reminder job disabled by RUN_REMINDER_JOBS=false");
  }
}

bootstrap().catch((error) => void shutdown("Failed to start application.", error));
