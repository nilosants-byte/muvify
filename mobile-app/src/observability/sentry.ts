import * as Sentry from "@sentry/react-native";
import type { AuthUser } from "../services/api/client";

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
