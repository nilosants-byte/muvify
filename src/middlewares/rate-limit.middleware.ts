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
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] }) as Record<string, unknown> | null;
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

// Frente 2 (Segurança do código), Lote 4: sem Redis (fora de ambiente de
// teste), o RedisStore fica sem instância compartilhada entre processos —
// cada instância da API passa a contar localmente. Isso não é uma falha
// permissiva: o pior caso é o limite ficar mais restritivo (dividido por
// instância), nunca mais permissivo. Não exige mudança de código.
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

// Frente 8 (segunda camada), Lote 4: /auth/refresh compartilhava o mesmo
// balde de 20/15min por IP usado por login/registro/reset de senha — mas
// refresh não é uma ação iniciada pelo usuário, é chamado automaticamente
// pelo app a cada ciclo de expiração do access token (15min por padrão,
// ACCESS_TOKEN_EXPIRES_IN). Em qualquer IP compartilhado por várias sessões
// (Wi-Fi de academia — o ambiente de uso mais típico deste app —, NAT
// corporativo, universidade), os refreshes automáticos concorrentes podem
// esgotar sozinhos o balde compartilhado e travar novos cadastros/logins
// legítimos vindos daquele IP. Balde próprio, bem mais generoso: reuso de
// refresh token revogado já é tratado como possível roubo de token
// (auth.service.ts::refresh), então esse limite aqui é só um teto contra
// abuso bruto, não a defesa principal.
export const refreshRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: makeStore("rl:refresh:"),
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

// Frente 5 (Descoberta, agendamento e agenda), Lote 11: disponibilidade e
// bloqueio manual reaproveitavam o uploadRateLimiter (mesmo limite de
// 20/hora), mas devolviam a mensagem "Limite de uploads atingido" pra uma
// ação que não é upload nenhum — confuso pro profissional.
export const writeRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  keyGenerator: userOrIpKey,
  store: makeStore("rl:write:"),
  message: {
    message: "Muitas alterações em pouco tempo. Tente novamente em 1 hora."
  }
});
