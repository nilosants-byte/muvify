import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import * as Sentry from "@sentry/node";
import type { Envelope } from "@sentry/core";
import { AppError } from "../src/shared/errors/app-error";
import { attachSentryErrorHandler } from "../src/config/sentry";
import { errorMiddleware } from "../src/middlewares/error.middleware";

// Frente 13 (segunda camada), Lote 1: `Sentry.Handlers.requestHandler`/
// `.errorHandler` (API removida a partir do @sentry/node v8) caía num
// no-op silencioso na versão instalada (10.x) — nenhum teste jamais
// verificou que um erro de rota REAL chegava ao Sentry, só que a lógica de
// scrubbing (`sentryBeforeSend`) funcionava isolada (ver
// frente11-lote4-third-party-leakage.test.ts). Este teste monta um app
// Express mínimo com a mesma cadeia de middlewares de produção
// (rota → attachSentryErrorHandler → errorMiddleware) e um transporte
// customizado do Sentry (sem rede real) pra confirmar, de ponta a ponta,
// que um erro 500 chega ao Sentry e que um AppError 4xx (esperado,
// validação/negócio) não vira ruído.

describe("Frente 13, Lote 1 — handler HTTP do Sentry captura erro de rota de verdade", () => {
  const sentEnvelopes: Envelope[] = [];

  beforeAll(() => {
    Sentry.init({
      dsn: "https://test@o0.ingest.sentry.io/0",
      tracesSampleRate: 0,
      transport: () => ({
        send: async (envelope) => {
          sentEnvelopes.push(envelope);
          return {};
        },
        flush: async () => true
      })
    });
  });

  afterAll(async () => {
    await Sentry.close(0);
  });

  // O Sentry também manda envelopes de telemetria interna (ex:
  // "client_report", contando eventos descartados) que não são o erro em
  // si — só itens do tipo "event" (ou "transaction") representam algo
  // reportado de verdade.
  function countReportedEvents() {
    return sentEnvelopes.reduce((total, envelope) => {
      const items = envelope[1] as Array<[{ type?: string }, unknown]>;
      const eventItems = items.filter(([itemHeader]) => itemHeader.type === "event");
      return total + eventItems.length;
    }, 0);
  }

  function buildTestApp() {
    const app = express();
    app.get("/boom", () => {
      throw new Error("erro inesperado de verdade, nunca tratado por ninguém");
    });
    app.get("/business-error", () => {
      throw new AppError("Recurso inválido.", 400);
    });
    attachSentryErrorHandler(app);
    app.use(errorMiddleware);
    return app;
  }

  it("erro 500 não tratado (bug real) é capturado pelo Sentry", async () => {
    sentEnvelopes.length = 0;
    const response = await request(buildTestApp()).get("/boom");
    expect(response.status).toBe(500);

    await Sentry.flush(2000);
    expect(countReportedEvents()).toBeGreaterThan(0);
  });

  it("AppError 4xx (erro de negócio esperado) não polui o Sentry", async () => {
    sentEnvelopes.length = 0;
    const response = await request(buildTestApp()).get("/business-error");
    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Recurso inválido.");

    await Sentry.flush(2000);
    expect(countReportedEvents()).toBe(0);
  });
});
