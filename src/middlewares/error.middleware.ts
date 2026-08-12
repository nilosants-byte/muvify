import { Prisma } from "@prisma/client";
import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { ZodError } from "zod";
import { AppError } from "../shared/errors/app-error";
import { translateZodIssue } from "./zod-error-translation";

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
    // Frente 3 (Cadastro/onboarding), Lote 5: essas mensagens já são as que
    // nós mesmos escrevemos nos schemas Zod (português, voltadas pro
    // usuário) - não é detalhe interno de implementação nem stack trace, é
    // exatamente a informação que falta pro usuário corrigir o campo certo.
    // Esconder isso só em produção transformava toda validação em "Erro de
    // validação." genérico bem na hora que mais importa (cadastro/senha).
    //
    // Frente 10 (segunda camada), Lote 2: essa suposição só valia quando
    // TODO schema tinha mensagem customizada - na prática a maioria não
    // tem, e error.flatten().fieldErrors só enxerga a chave de TOPO do
    // objeto validado (validate.middleware.ts sempre valida
    // {body, params, query}), então o campo virava sempre "body" e a
    // mensagem era o texto padrão do Zod em inglês (ex: "Number must be
    // greater than or equal to 100"). Passa a usar error.issues (path
    // completo, ex: "priceCents") e traduz a mensagem só quando ela é
    // detectavelmente a mensagem padrão do Zod - mensagem customizada
    // (já em português) nunca é tocada.
    const translated = error.issues.map((issue) => translateZodIssue(issue));
    const detail = translated.map(({ field, message }) => `${field}: ${message}`).join(" | ");
    return response.status(StatusCodes.BAD_REQUEST).json({
      message: detail ? `Erro de validação — ${detail}` : "Erro de validação.",
      errors: error.flatten(),
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
