/**
 * Frente 14 (segunda camada, carga real), Lote 13: onChatUnreadChanged é o
 * novo listener do lado mobile pro evento leve "chat:unread-changed" —
 * substitui o polling de 15s da Home do profissional contra a lista
 * completa de chats. Mesmo padrão de FakeSocket + jest.resetModules() +
 * doMock + require() já usado em frente13-lote11-chat-error-capture.test.ts
 * (não usa import estático de socket.io-client/observability/sentry no
 * topo do arquivo, então não sofre do bug de referência de mock obsoleta
 * documentado naquele mesmo lote).
 */

describe("Frente 14, Lote 13 — onChatUnreadChanged reage ao evento do servidor", () => {
  class FakeSocket {
    listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    connected = false;
    auth: unknown;
    on(event: string, handler: (...args: unknown[]) => void) {
      (this.listeners[event] ??= []).push(handler);
      return this;
    }
    off(event: string, handler: (...args: unknown[]) => void) {
      this.listeners[event] = (this.listeners[event] ?? []).filter((h) => h !== handler);
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      (this.listeners[event] ?? []).forEach((handler) => handler(...args));
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

  it("chama o handler quando o servidor emite chat:unread-changed", () => {
    const fakeSocket = new FakeSocket();
    jest.doMock("socket.io-client", () => ({ io: jest.fn(() => fakeSocket) }));
    const { connectSocket, onChatUnreadChanged } = require("../services/realtime/socket");

    connectSocket("token-abc");
    const handler = jest.fn();
    onChatUnreadChanged(handler);

    fakeSocket.emit("chat:unread-changed");

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("a função de unsubscribe retornada para de chamar o handler", () => {
    const fakeSocket = new FakeSocket();
    jest.doMock("socket.io-client", () => ({ io: jest.fn(() => fakeSocket) }));
    const { connectSocket, onChatUnreadChanged } = require("../services/realtime/socket");

    connectSocket("token-abc");
    const handler = jest.fn();
    const unsubscribe = onChatUnreadChanged(handler);
    unsubscribe();

    fakeSocket.emit("chat:unread-changed");

    expect(handler).not.toHaveBeenCalled();
  });
});
