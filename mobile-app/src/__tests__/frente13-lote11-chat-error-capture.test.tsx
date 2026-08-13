/**
 * Frente 13 (segunda camada), Lote 11: chat (envio, carregamento/polling e
 * conexão do socket em tempo real) nunca capturava falha no Sentry.
 */
import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientChatListScreen } from "../screens/client/ClientChatListScreen";
import { ProfessionalChatListScreen } from "../screens/professional/ProfessionalChatListScreen";
import { chatApi, consultancyChatApi, ChatSummary } from "../services/api/client";
import { useAppState } from "../state/AppState";
import { captureException } from "../observability/sentry";

jest.mock("../state/AppState", () => ({
  useAppState: jest.fn()
}));

jest.mock("../observability/sentry", () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  setSentryUser: jest.fn()
}));

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function chatSummary(bookingId: string): ChatSummary {
  return {
    bookingId,
    bookingStatus: "CONFIRMED",
    isOpen: true,
    providerId: "provider-1",
    otherUser: { name: "Fulano", photoUrl: null },
    clientId: "client-1",
    unreadCount: 0,
    lastMessage: { content: "Oi", createdAt: "2026-08-01T10:00:00.000Z", isMine: false, isSystem: false }
  };
}

describe("Frente 13, Lote 11 — captura de erro no chat", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const runWithAuth = jest.fn(async (operation: (token: string) => Promise<unknown>) => operation("token-test"));
    (useAppState as jest.Mock).mockReturnValue({
      runWithAuth,
      showToast: jest.fn(),
      user: { id: "me", role: "CLIENT" }
    });
  });

  it("ClientChatListScreen: falha ao carregar mensagens (initial) chama captureException", async () => {
    jest.spyOn(chatApi, "myChats").mockResolvedValue([chatSummary("booking-1")]);
    jest.spyOn(consultancyChatApi, "myChats").mockResolvedValue([]);
    jest.spyOn(chatApi, "getMessages").mockRejectedValue(new Error("falha ao buscar mensagens"));

    renderWithQueryClient(
      <ClientChatListScreen
        navigation={{ navigate: jest.fn(), goBack: jest.fn() } as any}
        route={{ params: { openBookingId: "booking-1" } } as any}
      />
    );

    await waitFor(() =>
      expect(captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ screen: "ClientChatListScreen" })
      )
    );
  });

  it("ClientChatListScreen: falha ao enviar mensagem chama captureException", async () => {
    jest.spyOn(chatApi, "myChats").mockResolvedValue([chatSummary("booking-2")]);
    jest.spyOn(consultancyChatApi, "myChats").mockResolvedValue([]);
    jest.spyOn(chatApi, "getMessages").mockResolvedValue({
      messages: [],
      isOpen: true,
      otherUser: { name: "Fulano", photoUrl: null }
    });
    jest.spyOn(chatApi, "sendMessage").mockRejectedValue(new Error("falha ao enviar"));

    const { getByPlaceholderText, getByLabelText } = renderWithQueryClient(
      <ClientChatListScreen
        navigation={{ navigate: jest.fn(), goBack: jest.fn() } as any}
        route={{ params: { openBookingId: "booking-2" } } as any}
      />
    );

    const input = await waitFor(() => getByPlaceholderText("Escreva para seu personal..."));
    fireEvent.changeText(input, "oi");
    fireEvent.press(getByLabelText("Enviar mensagem"));

    await waitFor(() =>
      expect(captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ screen: "ClientChatListScreen", action: "sendMessage" })
      )
    );
  });

  it("ProfessionalChatListScreen: falha ao carregar mensagens (initial) chama captureException", async () => {
    jest.spyOn(chatApi, "myChats").mockResolvedValue([chatSummary("booking-pro-1")]);
    jest.spyOn(consultancyChatApi, "myChats").mockResolvedValue([]);
    jest.spyOn(chatApi, "getMessages").mockRejectedValue(new Error("falha ao buscar mensagens"));

    renderWithQueryClient(
      <ProfessionalChatListScreen
        navigation={{ navigate: jest.fn(), goBack: jest.fn() } as any}
        route={{ params: { openBookingId: "booking-pro-1" } } as any}
      />
    );

    await waitFor(() =>
      expect(captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ screen: "ProfessionalChatListScreen" })
      )
    );
  });
});

describe("Frente 13, Lote 11 — captura de erro na conexão do socket", () => {
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

  it("reporta só o primeiro connect_error de uma sequência, e volta a reportar depois de um connect bem-sucedido", () => {
    const fakeSocket = new FakeSocket();
    jest.doMock("socket.io-client", () => ({ io: jest.fn(() => fakeSocket) }));
    const { captureException: captureExceptionMock } = require("../observability/sentry");
    const { connectSocket } = require("../services/realtime/socket");

    connectSocket("token-abc");

    fakeSocket.emit("connect_error", new Error("primeira falha"));
    fakeSocket.emit("connect_error", new Error("segunda falha, mesma sequência"));
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ area: "realtime-socket-connect-error" })
    );

    fakeSocket.emit("connect");
    fakeSocket.emit("connect_error", new Error("nova sequência de falha"));
    expect(captureExceptionMock).toHaveBeenCalledTimes(2);
  });
});
