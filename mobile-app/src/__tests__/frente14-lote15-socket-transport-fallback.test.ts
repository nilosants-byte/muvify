/**
 * Frente 14 (segunda camada, carga real), Lote 15: connectSocket forçava
 * transports: ["websocket"], sem fallback — em rede de operadora com proxy
 * que bloqueia ou não faz upgrade de WebSocket corretamente, a conexão
 * falhava de vez (o app ficava só na reconexão automática tentando
 * websocket de novo, indefinidamente). "polling" entra como fallback real,
 * "websocket" continua primeiro na lista (latência menor no caso comum).
 * Mesmo padrão de FakeSocket + jest.resetModules() + doMock + require() já
 * usado em frente13-lote11-chat-error-capture.test.ts.
 */

describe("Frente 14, Lote 15 — connectSocket permite fallback de transporte", () => {
  class FakeSocket {
    listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    connected = false;
    auth: unknown;
    on(event: string, handler: (...args: unknown[]) => void) {
      (this.listeners[event] ??= []).push(handler);
      return this;
    }
    off() {
      return this;
    }
    emit() {
      return true;
    }
    disconnect() {
      return this;
    }
    removeAllListeners() {
      this.listeners = {};
      return this;
    }
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("passa transports com websocket E polling (fallback real, não só websocket)", () => {
    const fakeSocket = new FakeSocket();
    const ioMock = jest.fn(() => fakeSocket);
    jest.doMock("socket.io-client", () => ({ io: ioMock }));
    const { connectSocket } = require("../services/realtime/socket");

    connectSocket("token-abc");

    expect(ioMock).toHaveBeenCalledTimes(1);
    const options = ioMock.mock.calls[0]?.[1] as { transports?: string[] };
    expect(options.transports).toEqual(expect.arrayContaining(["websocket", "polling"]));
    // websocket continua primeiro — mantém a latência baixa do caso comum.
    expect(options.transports?.[0]).toBe("websocket");
  });
});
