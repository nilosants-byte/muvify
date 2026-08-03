import React from "react";
import { render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientChatListScreen } from "../screens/client/ClientChatListScreen";
import { ProfessionalChatListScreen } from "../screens/professional/ProfessionalChatListScreen";
import { chatApi, ChatSummary } from "../services/api/client";
import { useAppState } from "../state/AppState";

jest.mock("../state/AppState", () => ({
  useAppState: jest.fn()
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
    otherUser: { name: "Fulano", photoUrl: "https://example.com/photo.png" },
    clientId: "client-1",
    lastMessage: null
  } as ChatSummary;
}

// Épico de Frentes, Frente 9, Lote 4: tocar numa notificação de mensagem
// nova (push do SO ou dentro do app) levava pro detalhe do agendamento em
// vez do chat, ou abria só a lista sem selecionar a conversa. As telas de
// lista de chat agora aceitam um openBookingId opcional que auto-seleciona
// a conversa certa assim que a lista carrega.
describe("deep link de chat — openBookingId auto-seleciona a conversa", () => {
  beforeEach(() => {
    const runWithAuth = jest.fn(async (operation: (token: string) => Promise<unknown>) =>
      operation("token-test")
    );
    (useAppState as jest.Mock).mockReturnValue({
      runWithAuth,
      showToast: jest.fn(),
      user: { id: "me", role: "CLIENT" }
    });
  });

  it("ClientChatListScreen abre a conversa certa quando openBookingId chega por parâmetro", async () => {
    jest.spyOn(chatApi, "myChats").mockResolvedValue([chatSummary("booking-target"), chatSummary("booking-other")]);
    const getMessagesSpy = jest.spyOn(chatApi, "getMessages").mockResolvedValue({
      messages: [],
      isOpen: true,
      otherUser: { name: "Fulano", photoUrl: null }
    });

    renderWithQueryClient(
      <ClientChatListScreen
        navigation={{ navigate: jest.fn(), goBack: jest.fn() } as any}
        route={{ params: { openBookingId: "booking-target" } } as any}
      />
    );

    await waitFor(() => expect(getMessagesSpy).toHaveBeenCalledWith("token-test", "booking-target"));
  });

  it("ProfessionalChatListScreen abre a conversa certa quando openBookingId chega por parâmetro", async () => {
    jest.spyOn(chatApi, "myChats").mockResolvedValue([chatSummary("booking-pro-target")]);
    const getMessagesSpy = jest.spyOn(chatApi, "getMessages").mockResolvedValue({
      messages: [],
      isOpen: true,
      otherUser: { name: "Aluno", photoUrl: null }
    });

    const { getByTestId } = renderWithQueryClient(
      <ProfessionalChatListScreen
        navigation={{ navigate: jest.fn(), goBack: jest.fn() } as any}
        route={{ params: { openBookingId: "booking-pro-target" } } as any}
      />
    );

    await waitFor(() => expect(getMessagesSpy).toHaveBeenCalledWith("token-test", "booking-pro-target"));
    await waitFor(() => expect(getByTestId("screen.professional.chat.detail")).toBeTruthy());
  });
});
