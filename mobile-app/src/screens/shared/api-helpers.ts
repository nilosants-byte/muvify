import { captureException } from "../../observability/sentry";
import { ApiError } from "../../services/api/client";

type ToastFn = (message: string, type?: "success" | "error" | "info") => void;

type NavigationLike = {
  navigate?: (screen: string, params?: unknown) => void;
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function extractApiMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message || fallback;
  }
  if (error instanceof Error) {
    return error.message || fallback;
  }
  return fallback;
}

export function isSessionExpiredError(message: string) {
  const normalized = normalizeText(message);
  return normalized.includes("sessão expirada") || normalized.includes("sessão inválida");
}

export function handleScreenError(options: {
  error: unknown;
  showToast: ToastFn;
  fallbackMessage: string;
  navigation?: NavigationLike;
}) {
  const message = extractApiMessage(options.error, options.fallbackMessage);
  captureException(options.error, {
    fallbackMessage: options.fallbackMessage,
    normalizedMessage: message
  });
  options.showToast(message, "error");
  if (isSessionExpiredError(message) && options.navigation?.navigate) {
    options.navigation.navigate("SessionExpired");
  }
}

export function formatPriceFromCents(priceCents?: number) {
  if (typeof priceCents !== "number") return 0;
  return priceCents / 100;
}

export function averageToFive(value?: number) {
  if (!Number.isFinite(value)) return 0;
  return Number(value);
}

