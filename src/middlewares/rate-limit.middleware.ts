import rateLimit from "express-rate-limit";
import RedisStore, { type RedisReply, type SendCommandFn } from "rate-limit-redis";
import { redis } from "../config/redis";
import { env } from "../config/env";
import { Request } from "express";
import jwt from "jsonwebtoken";

const sendRedisCommand: SendCommandFn = (...args) =>
  (redis.call as unknown as (...command: string[]) => Promise<RedisReply>)(...args);

const useRedisStore = env.NODE_ENV !== "test";

// Extract the authenticated user id from a verified JWT when available.
// We never trust unverified token payloads for rate-limit identity.
function extractUserId(req: Request): string | undefined {
  try {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return undefined;
    const token = auth.slice(7);
    const decoded = jwt.verify(token, env.JWT_SECRET) as Record<string, unknown> | null;
    if (decoded && typeof decoded["sub"] === "string") return decoded["sub"];
    if (decoded && typeof decoded["id"] === "string") return decoded["id"];
    return undefined;
  } catch {
    return undefined;
  }
}

// Rate-limit key: authenticated user id (verified token) or IP fallback.
function userOrIpKey(req: Request): string {
  const userId = extractUserId(req);
  if (userId) return `user:${userId}`;
  return req.ip ?? "unknown";
}

function makeStore(prefix: string) {
  if (!useRedisStore) return undefined;
  return new RedisStore({ prefix, sendCommand: sendRedisCommand });
}

// General API limit: 600 req / 15 min per authenticated user.
export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  keyGenerator: userOrIpKey,
  skip: (req) =>
    req.path.startsWith("/api/payments/webhook") || req.path.startsWith("/health"),
  store: makeStore("rl:api:"),
  message: {
    message: "Muitas requisicoes. Tente novamente em alguns minutos."
  }
});

// Auth limit: 20 attempts / 15 min per IP.
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: makeStore("rl:auth:"),
  message: {
    message: "Limite de autenticacao excedido."
  }
});

// Upload limit: 20 uploads per hour per user.
export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  keyGenerator: userOrIpKey,
  store: makeStore("rl:upload:"),
  message: {
    message: "Limite de uploads atingido. Tente novamente em 1 hora."
  }
});
