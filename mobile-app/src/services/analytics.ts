import PostHog from "posthog-react-native";

const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY ?? "";

// Disabled when: no key configured, running in development, or running tests.
const disabled = !POSTHOG_KEY || __DEV__ || process.env.NODE_ENV === "test";

export const posthog = new PostHog(POSTHOG_KEY || "placeholder", {
  host: "https://eu.posthog.com",
  disabled,
  flushAt: 20,
  flushInterval: 30_000,
  captureAppLifecycleEvents: true,
});

// ── Event helpers ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function trackEvent(event: AnalyticsEvent, props?: Record<string, any>) {
  if (disabled) return;
  posthog.capture(event, props);
}

export function identifyUser(id: string, traits?: { name?: string; email?: string; role?: string }) {
  if (disabled) return;
  posthog.identify(id, traits);
}

export function resetAnalyticsUser() {
  if (disabled) return;
  posthog.reset();
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
