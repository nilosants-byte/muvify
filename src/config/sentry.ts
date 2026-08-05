import * as Sentry from "@sentry/node";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { env } from "./env";

type LegacyHandlers = {
  requestHandler: (options?: { request?: string[] | boolean }) => RequestHandler;
  errorHandler: () => ErrorRequestHandler;
};

const sentryLegacyHandlers = (Sentry as unknown as { Handlers?: LegacyHandlers }).Handlers;
const noopRequestHandler: RequestHandler = (_req, _res, next) => next();
const noopErrorHandler: ErrorRequestHandler = (error, _req, _res, next) => next(error);

// Épico de Frentes, Frente 11, Lote 4: exportada separadamente (em vez de
// inline dentro de Sentry.init) pra dar pra testar a lógica de scrubbing
// sem precisar inicializar o SDK de verdade.
export function sentryBeforeSend(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request?.headers) {
    const { authorization, cookie, ...safeHeaders } = event.request.headers as Record<string, string>;
    event.request.headers = safeHeaders;
  }
  // requestHandler já restringe o que é capturado (ver abaixo), mas isso é
  // opção de configuração, não uma garantia estrutural - cinto e
  // suspensório contra corpo de requisição (senha, anamnese, etc.) vazar
  // num evento de erro.
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
  }
  if (event.user) {
    delete event.user.ip_address;
    delete event.user.email;
  }
  return event;
}

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
    beforeSend: sentryBeforeSend,
  });
}

/**
 * Middlewares legados do Sentry para Express.
 * Ficam em no-op quando a versao do SDK nao expor Handlers.
 */
// Épico de Frentes, Frente 11, Lote 4: sem opções, o requestHandler captura
// o corpo da requisição por padrão (senha, resposta de anamnese, etc.) -
// a política afirma o contrário. Restringe ao essencial pra debug.
export const sentryRequestHandler =
  typeof sentryLegacyHandlers?.requestHandler === "function"
    ? sentryLegacyHandlers.requestHandler({ request: ["method", "url"] })
    : noopRequestHandler;

export const sentryErrorHandler =
  typeof sentryLegacyHandlers?.errorHandler === "function"
    ? sentryLegacyHandlers.errorHandler()
    : noopErrorHandler;
