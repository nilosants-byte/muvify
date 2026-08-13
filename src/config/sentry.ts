import * as Sentry from "@sentry/node";
import type { Express } from "express";
import { env } from "./env";

// Épico de Frentes, Frente 11, Lote 4: exportada separadamente (em vez de
// inline dentro de Sentry.init) pra dar pra testar a lógica de scrubbing
// sem precisar inicializar o SDK de verdade.
export function sentryBeforeSend(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request?.headers) {
    const { authorization, cookie, ...safeHeaders } = event.request.headers as Record<string, string>;
    event.request.headers = safeHeaders;
  }
  // Cinto e suspensório contra corpo de requisição (senha, anamnese, etc.)
  // vazar num evento de erro — independente do que a integração automática
  // do Express decidir anexar ao evento.
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

// Frente 13 (segunda camada), Lote 1: `Sentry.Handlers.requestHandler`/
// `.errorHandler` (API usada aqui até então) foi removida a partir do
// @sentry/node v8 — a versão instalada (10.x) não expõe mais `Handlers`,
// então a checagem antiga (`typeof sentryLegacyHandlers?.errorHandler ===
// "function"`) sempre dava falso e os dois middlewares caíam num no-op
// silencioso: nenhum erro de rota chegava ao Sentry, sem log nem aviso
// nenhum sobre essa degradação (só os pontos com `Sentry.captureException`
// manual escapavam disso). Não existe mais um "request handler" próprio pra
// registrar — a integração Express (automática, contanto que
// `initSentry()` rode antes do Express carregar, ver src/instrument.ts) já
// cobre isso sozinha.
//
// `Sentry.setupExpressErrorHandler(app)` (em vez de só
// `app.use(Sentry.expressErrorHandler())`) foi escolhido de propósito: além
// de registrar o error handler (mesmo filtro padrão do antigo
// `Handlers.errorHandler()` — só reporta erro com status >= 500, então
// AppError 4xx nunca vira ruído no Sentry, já que `error.statusCode` é lido
// automaticamente), ele confere se `app.use` já foi instrumentado e imprime
// um `console.warn` explícito se não tiver sido — exatamente o tipo de
// diagnóstico que teria pego este bug (ordem de import errada) muito antes.
export function attachSentryErrorHandler(app: Express) {
  Sentry.setupExpressErrorHandler(app);
}
