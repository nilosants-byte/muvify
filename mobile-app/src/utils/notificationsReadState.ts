import AsyncStorage from "@react-native-async-storage/async-storage";
import { NotificationInboxItem } from "../services/api/client";

// v2 resets stale dismiss data created by old notification behaviors.
const DISMISSED_NOTIFICATIONS_KEY_PREFIX = "@muvify/notifications/dismissed/v2";

function buildKey(prefix: string, userId?: string | null) {
  const safe = (userId ?? "anonymous").replace(/:/g, "_").replace(/\//g, "_");
  return `${prefix}:${safe}`;
}

async function loadIdSet(key: string) {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.filter((value): value is string => typeof value === "string" && value.length > 0));
  } catch {
    return new Set<string>();
  }
}

async function persistIdSet(key: string, value: Set<string>) {
  const items = [...value.values()];
  await AsyncStorage.setItem(key, JSON.stringify(items));
}

export async function loadDismissedNotificationIds(userId?: string | null) {
  return loadIdSet(buildKey(DISMISSED_NOTIFICATIONS_KEY_PREFIX, userId));
}

export async function saveDismissedNotificationIds(userId: string | null | undefined, value: Set<string>) {
  return persistIdSet(buildKey(DISMISSED_NOTIFICATIONS_KEY_PREFIX, userId), value);
}

// Épico de Frentes, Frente 9, Lote 2: "lido" agora vem sempre do banco
// (readAt), nunca mais de um set local separado - "visto" e "lido" eram
// duas fontes de verdade divergentes.
export function countUnreadNotifications(
  inbox: NotificationInboxItem[] | undefined | null,
  dismissedIds: Set<string>
) {
  if (!Array.isArray(inbox)) return 0;
  return inbox.reduce((total, item) => {
    if (dismissedIds.has(item.id)) return total;
    if (item.readAt) return total;
    return total + 1;
  }, 0);
}
