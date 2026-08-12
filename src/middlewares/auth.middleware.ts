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
    next();
  } catch (error) {
    next(error);
  }
}
