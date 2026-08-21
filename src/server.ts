// Frente 13 (segunda camada), Lote 1: precisa ser o primeiro import do
// arquivo (ver comentário em src/instrument.ts) — o Sentry precisa
// inicializar antes de "./app" carregar o Express.
import "./instrument";
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
import { startGoalReminderJob, stopGoalReminderJob } from "./modules/gamification/jobs/goal-reminder.job";
import { initSocketServer, stopSocketServer } from "./realtime/socket";
import * as Sentry from "@sentry/node";
import { EmailService } from "./shared/services/email.service";

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
    stopGoalReminderJob();
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

// Frente 13 (segunda camada), Lote 9: esses dois listeners fazem o shutdown
// gracioso, não reportam ao Sentry por conta própria — dependem das
// integrações padrão do SDK (OnUncaughtException/OnUnhandledRejection,
// habilitadas por padrão em @sentry/node v10 — confirmado via
// Sentry.getDefaultIntegrations()) capturarem ANTES deste handler chamar
// shutdown()/process.exit(). Node permite múltiplos listeners pro mesmo
// evento, então os dois convivem sem conflito. Isso só funciona de verdade
// porque "./instrument" (Lote 1) agora roda antes de qualquer outro import
// deste arquivo — antes, com a ordem de import errada, o registro dessas
// integrações podia nem ter acontecido a tempo de um erro real disparado
// cedo no boot.
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
    const message =
      "Redis indisponivel no bootstrap. Seguindo em modo degradado (fallback local por instancia).";
    console.warn(message);
    // Frente 13 (segunda camada), Lote 9: só console.warn - dava pra saber
    // que o processo tinha subido em modo degradado olhando o log do
    // processo na hora, mas não sobrava nenhum histórico de "quantas vezes
    // isso já aconteceu" pra quem só olha o Sentry (mesmo padrão já usado
    // logo abaixo, no achado do SMTP ausente em produção).
    Sentry.captureMessage(message, "warning");
  }

  // Frente 2 (segunda camada), Lote 8: SENTRY_DSN ausente em produção fazia
  // initSentry() virar no-op silencioso — nenhum Sentry.captureException
  // do sistema inteiro (inclusive os que outras frentes acabaram de
  // corrigir) chegava a algum lugar, e ninguém percebia até precisar
  // debugar um incidente e descobrir que o Sentry está vazio há semanas.
  // Não dá pra usar Sentry.captureMessage aqui pra avisar sobre a própria
  // ausência do Sentry — só um log visível nos logs do processo mesmo.
  if (env.NODE_ENV === "production" && !process.env.SENTRY_DSN) {
    console.error(
      "[Sentry] SENTRY_DSN nao configurado em producao - nenhum erro sera reportado ao Sentry."
    );
  }

  // Épico de Frentes, Frente 9, Lote 12: SMTP totalmente ausente em
  // produção pulava a verificação de boot em silêncio (o if abaixo nem
  // entra), e todo envio subsequente falhava sem nenhum aviso visível -
  // ninguém ficava sabendo que e-mail (verificação, redefinição de senha,
  // avisos de segurança) simplesmente parou de funcionar.
  if (env.NODE_ENV === "production" && !emailService.canSendEmail()) {
    const message =
      "SMTP nao configurado em producao - nenhum e-mail sera enviado (verificacao de conta, redefinicao de senha, avisos de seguranca, etc).";
    console.error(`[SMTP] ${message}`);
    Sentry.captureMessage(message, "error");
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
  startGoalReminderJob();
  if (!env.RUN_GOAL_REMINDER_JOBS) {
    console.log("Goal reminder job disabled by RUN_GOAL_REMINDER_JOBS=false");
  }
}

bootstrap().catch((error) => void shutdown("Failed to start application.", error));
