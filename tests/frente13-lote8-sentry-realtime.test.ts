import "dotenv/config";
import { createServer } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// @sentry/node é ESM com exports não-configuráveis - vi.mock + vi.hoisted,
// mesmo padrão de tests/frente9-lote12-email-failure-alerting.test.ts.
const { captureExceptionMock } = vi.hoisted(() => ({ captureExceptionMock: vi.fn() }));
vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
  captureMessage: vi.fn(),
  setUser: vi.fn(),
  setTag: vi.fn()
}));

import { connectRedis, redis } from "../src/config/redis";
import {
  emitNewBookingMessage,
  emitNewConsultancyMessage,
  initSocketServer,
  stopSocketServer
} from "../src/realtime/socket";

// Frente 13 (segunda camada), Lote 8: falha ao configurar o adaptador
// Redis do socket.io e falha ao emitir mensagem em tempo real só geravam
// console.error — best-effort de propósito (não deve derrubar o boot nem
// travar o envio de mensagem, que já está persistida no banco), mas sem
// nenhum sinal no Sentry se a falha for persistente.

let httpServer: ReturnType<typeof createServer> | null = null;

describe("Frente 13, Lote 8 — Sentry na infraestrutura de tempo real", () => {
  beforeAll(async () => {
    // redis.ts usa lazyConnect: true — sem isso, redis.status nunca chega
    // a "ready" neste arquivo de teste (módulo isolado por arquivo), e o
    // teste de falha do adaptador nem chega a tentar redis.duplicate().
    await connectRedis();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    captureExceptionMock.mockClear();
    await stopSocketServer();
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
      httpServer = null;
    }
  });

  it("falha ao configurar o adaptador Redis do socket.io chama Sentry.captureException, sem impedir o boot", async () => {
    vi.spyOn(redis, "duplicate").mockImplementation(() => {
      throw new Error("falha simulada ao duplicar conexão Redis");
    });

    httpServer = createServer();
    const io = await initSocketServer(httpServer);

    expect(io).toBeTruthy();
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: "falha simulada ao duplicar conexão Redis" }),
      expect.objectContaining({ tags: expect.objectContaining({ area: "realtime-redis-adapter" }) })
    );
  });

  it("falha ao emitir message:new (booking) chama Sentry.captureException, sem lançar erro pro chamador", async () => {
    httpServer = createServer();
    const io = await initSocketServer(httpServer);
    vi.spyOn(io, "to").mockImplementation(() => {
      throw new Error("falha simulada ao emitir mensagem");
    });

    expect(() =>
      emitNewBookingMessage("booking-id-teste", {
        id: "msg-1",
        senderId: "user-1",
        isSystem: false,
        content: "oi",
        readAt: null,
        createdAt: new Date()
      })
    ).not.toThrow();

    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: "falha simulada ao emitir mensagem" }),
      expect.objectContaining({
        tags: expect.objectContaining({ area: "realtime-emit" }),
        extra: expect.objectContaining({ bookingId: "booking-id-teste" })
      })
    );
  });

  it("falha ao emitir message:new (consultoria) chama Sentry.captureException, sem lançar erro pro chamador", async () => {
    httpServer = createServer();
    const io = await initSocketServer(httpServer);
    vi.spyOn(io, "to").mockImplementation(() => {
      throw new Error("falha simulada ao emitir mensagem de consultoria");
    });

    expect(() =>
      emitNewConsultancyMessage("contract-id-teste", {
        id: "msg-2",
        senderId: "user-2",
        isSystem: false,
        content: "oi",
        readAt: null,
        createdAt: new Date()
      })
    ).not.toThrow();

    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: "falha simulada ao emitir mensagem de consultoria" }),
      expect.objectContaining({
        tags: expect.objectContaining({ area: "realtime-emit" }),
        extra: expect.objectContaining({ contractId: "contract-id-teste" })
      })
    );
  });
});
