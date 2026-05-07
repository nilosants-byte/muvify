import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { redis } from "../config/redis";
import { AppError } from "../shared/errors/app-error";
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

    if (redis.status === "ready") {
      const blacklistedSince = await redis.get(`auth:blacklist:${payload.sub}`);
      if (blacklistedSince && payload.iat !== undefined && payload.iat <= parseInt(blacklistedSince)) {
        return next(new AppError("Sessão encerrada. Faça login novamente.", StatusCodes.UNAUTHORIZED));
      }
    }

    request.user = { id: payload.sub, role: payload.role };
    next();
  } catch (error) {
    next(error);
  }
}
