type LocalLoginAttemptsEntry = {
  attempts: number;
  expiresAt: number;
};

const localLoginAttempts = new Map<string, LocalLoginAttemptsEntry>();
const MAX_LOCAL_LOGIN_ATTEMPTS_ENTRIES = 10_000;

function normalizeEmailKey(email: string) {
  return email.trim().toLowerCase();
}

function cleanupExpired(email: string) {
  const key = normalizeEmailKey(email);
  const entry = localLoginAttempts.get(key);
  if (!entry) return;
  if (Date.now() > entry.expiresAt) {
    localLoginAttempts.delete(key);
  }
}

function evictOldestIfNeeded() {
  if (localLoginAttempts.size < MAX_LOCAL_LOGIN_ATTEMPTS_ENTRIES) return;
  const now = Date.now();
  // Remove primeiro as entradas expiradas (cleanup proativo)
  for (const [key, entry] of localLoginAttempts.entries()) {
    if (now > entry.expiresAt) localLoginAttempts.delete(key);
  }
  // Se ainda cheio, remove 10% das mais antigas (batch)
  if (localLoginAttempts.size >= MAX_LOCAL_LOGIN_ATTEMPTS_ENTRIES) {
    const toRemove = Math.ceil(MAX_LOCAL_LOGIN_ATTEMPTS_ENTRIES * 0.1);
    let removed = 0;
    for (const key of localLoginAttempts.keys()) {
      if (removed >= toRemove) break;
      localLoginAttempts.delete(key);
      removed++;
    }
  }
}

export function getLocalLoginAttempts(email: string) {
  cleanupExpired(email);
  const key = normalizeEmailKey(email);
  return localLoginAttempts.get(key)?.attempts ?? 0;
}

export function incrementLocalLoginAttempts(email: string, lockWindowSeconds: number) {
  cleanupExpired(email);
  evictOldestIfNeeded();
  const key = normalizeEmailKey(email);
  const now = Date.now();
  const existing = localLoginAttempts.get(key);
  const attempts = (existing?.attempts ?? 0) + 1;
  localLoginAttempts.set(key, {
    attempts,
    expiresAt: now + lockWindowSeconds * 1000
  });
  return attempts;
}

export function clearLocalLoginAttempts(email: string) {
  const key = normalizeEmailKey(email);
  localLoginAttempts.delete(key);
}
