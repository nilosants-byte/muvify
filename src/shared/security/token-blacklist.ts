import { redis } from "../../config/redis";
import { env } from "../../config/env";

type LocalBlacklistEntry = {
  blacklistedSince: number;
  timeout: NodeJS.Timeout;
};

const localBlacklist = new Map<string, LocalBlacklistEntry>();

function keyFor(userId: string) {
  return `auth:blacklist:${userId}`;
}

function setLocalBlacklist(userId: string, blacklistedSince: number, ttlSeconds: number) {
  const existing = localBlacklist.get(userId);
  if (existing) {
    clearTimeout(existing.timeout);
  }

  const timeout = setTimeout(() => {
    localBlacklist.delete(userId);
  }, ttlSeconds * 1000);
  timeout.unref?.();

  localBlacklist.set(userId, { blacklistedSince, timeout });
}

export async function setTokenBlacklist(userId: string, blacklistedSince: number, ttlSeconds: number) {
  if (redis.status === "ready") {
    try {
      await redis.set(keyFor(userId), String(blacklistedSince), "EX", ttlSeconds);
      setLocalBlacklist(userId, blacklistedSince, ttlSeconds); // mantém local sync
      return;
    } catch (err) {
      console.error(`[token-blacklist] Redis write failed for user ${userId}:`, err);
      // Fallback para local — em prod multi-instância, o token pode não ser invalidado em outros pods
      // Monitorar se isso ocorre com frequência
    }
  }

  setLocalBlacklist(userId, blacklistedSince, ttlSeconds);
}

export async function getTokenBlacklistedSince(
  userId: string,
  options?: { allowLocalFallback?: boolean }
): Promise<number | null> {
  const allowLocalFallback = options?.allowLocalFallback ?? true;

  if (redis.status === "ready") {
    try {
      const raw = await redis.get(keyFor(userId));
      if (!raw) return null;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    } catch {
      if (!allowLocalFallback) {
        throw new Error("Failed to read token blacklist from Redis.");
      }
    }
  }

  if (!allowLocalFallback) {
    return null;
  }

  return localBlacklist.get(userId)?.blacklistedSince ?? null;
}

// Usado sempre que uma acao precisa invalidar imediatamente os access
// tokens ja emitidos de um usuario (troca de senha, suspensao de conta):
// o blacklist so precisa durar ate o token expirar por conta propria.
export function resolveAccessTokenTtlSeconds() {
  const raw = env.ACCESS_TOKEN_EXPIRES_IN?.trim() ?? "900";
  const match = /^(\d+)([smhd]?)$/.exec(raw);
  if (!match) return 900;
  const amount = parseInt(match[1]!, 10);
  const unit = match[2] ?? "s";
  return unit === "m" ? amount * 60 : unit === "h" ? amount * 3600 : unit === "d" ? amount * 86400 : amount;
}

export async function clearTokenBlacklist(userId: string) {
  if (redis.status === "ready") {
    try {
      await redis.del(keyFor(userId));
    } catch {
      // local cleanup still runs
    }
  }

  const localEntry = localBlacklist.get(userId);
  if (localEntry) {
    clearTimeout(localEntry.timeout);
    localBlacklist.delete(userId);
  }
}
