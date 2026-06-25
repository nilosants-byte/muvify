import * as Sentry from "@sentry/react-native";
import { ApiError, type AuthUser } from "../services/api/client";

// Status HTTP que representam comportamento esperado da aplicação (timeout/falha
// de rede, validação, sessão expirada/inválida, recurso não encontrado, conflito,
// rate limit) — não são bugs. Reportá-los como exceção só gera ruído e dispara
// alertas falsos (ex.: cold start do Render após deploy expira o timeout do
// cliente e isso chega no Sentry como se fosse um erro real).
const EXPECTED_API_STATUSES = new Set([0, 400, 401, 403, 404, 409, 429]);

function isExpectedApiError(error: unknown): boolean {
  return error instanceof ApiError && EXPECTED_API_STATUSES.has(error.status);
}

let initialized = false;

function parseSampleRate(input: string | undefined, fallback: number) {
  if (!input) return fallback;
  const value = Number(input);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    return fallback;
  }
  return value;
}

export function initSentry() {
  if (initialized) return;

  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    enabled: true,
    environment:
      process.env.EXPO_PUBLIC_APP_ENV ?? process.env.NODE_ENV ?? "development",
    tracesSampleRate: parseSampleRate(
      process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
      0.1
    ),
    profilesSampleRate: parseSampleRate(
      process.env.EXPO_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE,
      0
    )
  });

  initialized = true;
}

export function captureException(error: unknown, context?: Record<string, unknown>) {
  if (!initialized) return;
  if (isExpectedApiError(error)) return;
  const err = error instanceof Error ? error : new Error(String(error));
  if (context) {
    Sentry.withScope((scope) => {
      scope.setContext("details", context);
      Sentry.captureException(err);
    });
    return;
  }
  Sentry.captureException(err);
}

export function captureMessage(message: string, level: Sentry.SeverityLevel = "info") {
  if (!initialized) return;
  Sentry.captureMessage(message, level);
}

export function setSentryUser(user: AuthUser | null) {
  if (!initialized) return;
  if (!user) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({ id: user.id });
}

export { Sentry };
