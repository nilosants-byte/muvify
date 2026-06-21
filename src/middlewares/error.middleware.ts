import { Prisma } from "@prisma/client";
import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { ZodError } from "zod";
import { AppError } from "../shared/errors/app-error";

export function errorMiddleware(
  error: Error,
  request: Request,
  response: Response,
  _next: NextFunction
) {
  const req = request as Request & { log?: { error: (err: unknown) => void }; id?: string };
  const requestId = req.id;
  const log = req.log;

  if (error instanceof ZodError) {
    const flat = error.flatten();
    const devDetail =
      process.env["NODE_ENV"] !== "production"
        ? Object.entries(flat.fieldErrors ?? {})
            .filter(([, msgs]) => Array.isArray(msgs) && msgs.length > 0)
            .map(([field, msgs]) => `${field}: ${(msgs as string[]).join(", ")}`)
            .join(" | ")
        : "";
    return response.status(StatusCodes.BAD_REQUEST).json({
      message: devDetail
        ? `Erro de validação — ${devDetail}`
        : "Erro de validação.",
      errors: process.env["NODE_ENV"] !== "production" ? flat : undefined,
      requestId
    });
  }

  if (error instanceof AppError) {
    return response.status(error.statusCode).json({
      message: error.message,
      details: error.details ?? null,
      requestId
    });
  }

  // Translate known Prisma errors to safe HTTP responses without exposing DB internals.
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return response.status(StatusCodes.CONFLICT).json({
        message: "Este recurso já existe.",
        requestId
      });
    }
    if (error.code === "P2025") {
      return response.status(StatusCodes.NOT_FOUND).json({
        message: "Recurso não encontrado.",
        requestId
      });
    }
    if (error.code === "P2003") {
      return response.status(StatusCodes.BAD_REQUEST).json({
        message: "Referência inválida nos dados enviados.",
        requestId
      });
    }
    // Any other known Prisma error: log but don't expose code or meta
    if (log) {
      log.error(error);
    } else {
      console.error("[prisma]", (error as Prisma.PrismaClientKnownRequestError).code, error.message);
    }
    return response.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: "Erro interno do servidor.",
      requestId
    });
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    return response.status(StatusCodes.BAD_REQUEST).json({
      message: "Dados inválidos enviados ao banco de dados.",
      requestId
    });
  }

  if (error instanceof Prisma.PrismaClientRustPanicError) {
    if (log) log.error(error);
    else console.error("[CRÍTICO] Prisma engine panic:", error.message);
    return response.status(StatusCodes.SERVICE_UNAVAILABLE).json({
      message: "Serviço temporariamente indisponível. Tente novamente em instantes.",
      requestId
    });
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    if (log) log.error(error);
    else console.error("[CRÍTICO] Prisma initialization error:", error.message);
    return response.status(StatusCodes.SERVICE_UNAVAILABLE).json({
      message: "Serviço temporariamente indisponível. Tente novamente em instantes.",
      requestId
    });
  }

  if (log) {
    log.error(error);
  } else {
    console.error("[unhandled]", error);
  }
  return response.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
    message: "Erro interno do servidor.",
    requestId
  });
}
