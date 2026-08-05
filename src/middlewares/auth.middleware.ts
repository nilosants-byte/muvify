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
      return next(new AppError("Token nao informado.", StatusCodes.UNAUTHORIZED));
    }

    const [scheme, token] = authHeader.split(" ");
    if (!scheme || !/^Bearer$/i.test(scheme) || !token) {
      return next(new AppError("Token invalido.", StatusCodes.UNAUTHORIZED));
    }

    const payload = verifyToken(token);
    const strictRedisForBlacklist = env.AUTH_REQUIRE_REDIS_FOR_BLACKLIST;
    if (strictRedisForBlacklist && redis.status !== "ready") {
      void connectRedis();
      return next(
        new AppError(
          "Servico temporariamente indisponivel. Tente novamente em instantes.",
          StatusCodes.SERVICE_UNAVAILABLE
        )
      );
    }

    const blacklistedSince = await getTokenBlacklistedSince(payload.sub, {
      allowLocalFallback: !strictRedisForBlacklist
    });
    if (blacklistedSince !== null && payload.iat !== undefined && payload.iat <= blacklistedSince) {
      return next(new AppError("Sessao encerrada. Faca login novamente.", StatusCodes.UNAUTHORIZED));
    }

    request.user = { id: payload.sub, role: payload.role, sessionId: payload.sessionId };
    next();
  } catch (error) {
    next(error);
  }
}
