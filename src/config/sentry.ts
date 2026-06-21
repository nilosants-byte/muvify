import * as Sentry from "@sentry/node";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { env } from "./env";

type LegacyHandlers = {
  requestHandler: () => RequestHandler;
  errorHandler: () => ErrorRequestHandler;
};

const sentryLegacyHandlers = (Sentry as unknown as { Handlers?: LegacyHandlers }).Handlers;
const noopRequestHandler: RequestHandler = (_req, _res, next) => next();
const noopErrorHandler: ErrorRequestHandler = (error, _req, _res, next) => next(error);

/**
 * Inicializa o Sentry para monitoramento de erros em producao.
 *
 * O Sentry so captura erros quando SENTRY_DSN estiver definido.
 * Em dev/test, funciona como no-op silencioso.
 */
export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1.0,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.headers) {
        const { authorization, cookie, ...safeHeaders } = event.request.headers as Record<string, string>;
        event.request.headers = safeHeaders;
      }
      if (event.user) {
        delete event.user.ip_address;
        delete event.user.email;
      }
      return event;
    },
  });
}

/**
 * Middlewares legados do Sentry para Express.
 * Ficam em no-op quando a versao do SDK nao expor Handlers.
 */
export const sentryRequestHandler =
  typeof sentryLegacyHandlers?.requestHandler === "function"
    ? sentryLegacyHandlers.requestHandler()
    : noopRequestHandler;

export const sentryErrorHandler =
  typeof sentryLegacyHandlers?.errorHandler === "function"
    ? sentryLegacyHandlers.errorHandler()
    : noopErrorHandler;
