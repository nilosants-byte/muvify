import * as Sentry from "@sentry/node";
import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { env } from "../config/env";
import { connectRedis, redis } from "../config/redis";
import { AppError } from "../shared/errors/app-error";
import { getTokenBlacklistedSince } from "../shared/security/token-blacklist";
import { verifyToken } from "../shared/utils/jwt";

export async function ensureAuthenticated(request: Request, _response: Response, next: NextFunction) {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return next(new AppError("Token não informado.", StatusCodes.UNAUTHORIZED));
    }

    const [scheme, token] = authHeader.split(" ");
    if (!scheme || !/^Bearer$/i.test(scheme) || !token) {
      return next(new AppError("Token inválido.", StatusCodes.UNAUTHORIZED));
    }

    const payload = verifyToken(token);
    const strictRedisForBlacklist = env.AUTH_REQUIRE_REDIS_FOR_BLACKLIST;
    if (strictRedisForBlacklist && redis.status !== "ready") {
      void connectRedis();
      return next(
        new AppError(
          "Serviço temporariamente indisponível. Tente novamente em instantes.",
          StatusCodes.SERVICE_UNAVAILABLE
        )
      );
    }

    const blacklistedSince = await getTokenBlacklistedSince(payload.sub, {
      allowLocalFallback: !strictRedisForBlacklist
    });
    if (blacklistedSince !== null && payload.iat !== undefined && payload.iat <= blacklistedSince) {
      return next(new AppError("Sessão encerrada. Faça login novamente.", StatusCodes.UNAUTHORIZED));
    }

    request.user = { id: payload.sub, role: payload.role, sessionId: payload.sessionId };
    // Frente 13 (segunda camada), Lote 2: sem isso, todo evento capturado
    // pelo Sentry chegava sem a conta afetada — a infra de scrubbing
    // (sentryBeforeSend) já removia email/ip de event.user desde a Frente
    // 11, mas nunca havia ninguém preenchendo event.user.id pra começo de
    // conversa. Só id + role (sem email/PII) — role ajuda a filtrar erro
    // "só de admin" vs "de qualquer usuário" direto no painel do Sentry.
    Sentry.setUser({ id: payload.sub, role: payload.role });
    next();
  } catch (error) {
    next(error);
  }
}
