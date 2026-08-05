import PostHog from "posthog-react-native";

const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY ?? "";

// Disabled when: no key configured, running in development, or running tests.
const disabled = !POSTHOG_KEY || __DEV__ || process.env.NODE_ENV === "test";

// Não instancia o SDK quando desabilitado: o construtor do PostHog tenta
// inicializar storage (AsyncStorage/expo-file-system) de forma síncrona e
// quebra em ambientes sem esses módulos disponíveis (ex.: Jest).
//
// Épico de Frentes, Frente 11, Lote 4: o SDK come­çava capturando eventos
// (incl. captureAppLifecycleEvents automático) antes de qualquer
// consentimento do usuário - defaultOptIn: false garante que NADA é
// capturado até optIn() ser chamado explicitamente (ver
// applyAnalyticsPreference/AppState.tsx, que só chama optIn quando o
// usuário liga o toggle "Compartilhar dados de uso", desligado por padrão).
export const posthog: PostHog | undefined = disabled
  ? undefined
  : new PostHog(POSTHOG_KEY, {
      host: "https://eu.posthog.com",
      flushAt: 20,
      flushInterval: 30_000,
      captureAppLifecycleEvents: true,
      defaultOptIn: false,
    });

// ── Event helpers ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function trackEvent(event: AnalyticsEvent, props?: Record<string, any>) {
  if (!posthog) return;
  posthog.capture(event, props);
}

// Épico de Frentes, Frente 11, Lote 4: identifyUser mandava o nome real do
// usuário pro PostHog (servidor na Europa) - sem necessidade, já que id+role
// bastam pra qualquer segmentação/funil que o produto precisa hoje.
export function identifyUser(id: string, traits?: { role?: string }) {
  if (!posthog) return;
  posthog.identify(id, traits);
}

export function resetAnalyticsUser() {
  if (!posthog) return;
  posthog.reset();
}

// Aplica a preferência de rastreamento do usuário (configurações > privacidade).
// O PostHog persiste esse estado internamente, mas mantemos a fonte da verdade
// no AppState para poder exibir o estado do toggle sem depender de API interna do SDK.
export function applyAnalyticsPreference(enabled: boolean) {
  if (!posthog) return;
  if (enabled) {
    void posthog.optIn();
  } else {
    void posthog.optOut();
  }
}

// ── Event name catalogue ──────────────────────────────────────────────────────
// Centralizing names prevents typos across the codebase.

export type AnalyticsEvent =
  // Auth
  | "user_registered"
  | "user_logged_in"
  | "user_logged_out"
  // Client — discovery
  | "professional_searched"
  | "professional_profile_viewed"
  // Client — booking
  | "booking_created"
  | "booking_cancelled_by_client"
  // Client — payment
  | "payment_card_added"
  | "payment_pix_initiated"
  | "payment_completed"
  // Professional — availability
  | "availability_slot_added"
  | "availability_slot_removed"
  | "time_block_added"
  // Professional — consultancy
  | "offer_created"
  | "offer_updated"
  | "consultancy_request_responded"
  // General
  | "support_message_sent";
