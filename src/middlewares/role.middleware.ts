import { UserRole } from "@prisma/client";
import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../shared/errors/app-error";
export function ensureRole(...roles: UserRole[]) {
  return (request: Request, _response: Response, next: NextFunction) => {
    if (!request.user || !roles.includes(request.user.role)) {
      throw new AppError("Acesso negado.", StatusCodes.FORBIDDEN);
    }
    next();
  };
}
