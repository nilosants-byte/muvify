/**
 * Wrapper centralizado para feedback háptico.
 * Regra: háptico NUNCA em scroll, toggle passivo ou navegação de tabs.
 * Usar apenas nos 6 momentos definidos no prompt de polimento.
 */
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

function safe(fn: () => Promise<void>) {
  if (Platform.OS === "web") return;
  fn().catch(() => {});
}

/** Momento 1 — CTA verde genérico (botão primário com consequência real) */
export function hapticCta() {
  safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** Momento 2 — Pagamento confirmado */
export function hapticPaymentSuccess() {
  safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** Momento 3 — Código da aula validado */
export function hapticCodeValidated() {
  safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** Momento 4 — Treino iniciado */
export function hapticWorkoutStart() {
  safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));
}

/** Momento 5 — Treino finalizado */
export function hapticWorkoutFinish() {
  safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** Momento 6 — Conquista desbloqueada (Success + 300ms + Heavy) */
export async function hapticAchievement() {
  if (Platform.OS === "web") return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  } catch {
    // best effort
  }
}

/** Pull-to-refresh háptico leve */
export function hapticRefresh() {
  safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** Like dado numa postagem — leve */
export function hapticLike() {
  safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** Comentário enviado com sucesso — leve */
export function hapticComment() {
  safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}
