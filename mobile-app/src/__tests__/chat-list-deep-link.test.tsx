import React from "react";
import { render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientChatListScreen } from "../screens/client/ClientChatListScreen";
import { ProfessionalChatListScreen } from "../screens/professional/ProfessionalChatListScreen";
import { chatApi, consultancyChatApi, ChatSummary, ConsultancyChatSummary } from "../services/api/client";
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
    providerId: "provider-1",
    otherUser: { name: "Fulano", photoUrl: "https://example.com/photo.png" },
    clientId: "client-1",
    unreadCount: 0,
    lastMessage: { content: "Oi", createdAt: "2026-08-01T10:00:00.000Z", isMine: false, isSystem: false }
  };
}

function consultancyChatSummary(contractId: string): ConsultancyChatSummary {
  return {
    contractId,
    contractStatus: "ACTIVE",
    isOpen: true,
    providerId: "provider-2",
    otherUser: { name: "Beltrana", photoUrl: "https://example.com/photo2.png" },
    clientId: "client-2",
    unreadCount: 0,
    lastMessage: { content: "Oi consultoria", createdAt: "2026-08-01T11:00:00.000Z", isMine: false, isSystem: false }
  };
}

// Épico de Frentes, Frente 9, Lote 4/8: tocar numa notificação de mensagem
// nova (push do SO ou dentro do app) levava pro detalhe do agendamento em
// vez do chat, ou abria só a lista sem selecionar a conversa. As telas de
// lista de chat agora aceitam openBookingId/openContractId opcionais que
// auto-selecionam a conversa certa assim que a lista carrega, e mesclam
// conversas de agendamento e de consultoria numa lista só (Lote 8).
describe("deep link de chat — openBookingId/openContractId auto-seleciona a conversa", () => {
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
    jest.spyOn(consultancyChatApi, "myChats").mockResolvedValue([]);
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

  it("ClientChatListScreen abre a conversa de consultoria certa quando openContractId chega por parâmetro", async () => {
    jest.spyOn(chatApi, "myChats").mockResolvedValue([chatSummary("booking-other")]);
    jest.spyOn(consultancyChatApi, "myChats").mockResolvedValue([consultancyChatSummary("contract-target")]);
    const getMessagesSpy = jest.spyOn(consultancyChatApi, "getMessages").mockResolvedValue({
      messages: [],
      isOpen: true,
      otherUser: { name: "Beltrana", photoUrl: null }
    });

    renderWithQueryClient(
      <ClientChatListScreen
        navigation={{ navigate: jest.fn(), goBack: jest.fn() } as any}
        route={{ params: { openContractId: "contract-target" } } as any}
      />
    );

    await waitFor(() => expect(getMessagesSpy).toHaveBeenCalledWith("token-test", "contract-target"));
  });

  it("ClientChatListScreen mescla conversas de agendamento e de consultoria numa lista só", async () => {
    jest.spyOn(chatApi, "myChats").mockResolvedValue([chatSummary("booking-1")]);
    jest.spyOn(consultancyChatApi, "myChats").mockResolvedValue([consultancyChatSummary("contract-1")]);

    const { findByText } = renderWithQueryClient(
      <ClientChatListScreen
        navigation={{ navigate: jest.fn(), goBack: jest.fn() } as any}
        route={{ params: undefined } as any}
      />
    );

    expect(await findByText("Fulano")).toBeTruthy();
    expect(await findByText("Beltrana")).toBeTruthy();
  });

  it("ProfessionalChatListScreen abre a conversa certa quando openBookingId chega por parâmetro", async () => {
    jest.spyOn(chatApi, "myChats").mockResolvedValue([chatSummary("booking-pro-target")]);
    jest.spyOn(consultancyChatApi, "myChats").mockResolvedValue([]);
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

  it("ProfessionalChatListScreen abre a conversa de consultoria certa quando openContractId chega por parâmetro", async () => {
    jest.spyOn(chatApi, "myChats").mockResolvedValue([]);
    jest.spyOn(consultancyChatApi, "myChats").mockResolvedValue([consultancyChatSummary("contract-pro-target")]);
    const getMessagesSpy = jest.spyOn(consultancyChatApi, "getMessages").mockResolvedValue({
      messages: [],
      isOpen: true,
      otherUser: { name: "Aluno consultoria", photoUrl: null }
    });

    const { getByTestId } = renderWithQueryClient(
      <ProfessionalChatListScreen
        navigation={{ navigate: jest.fn(), goBack: jest.fn() } as any}
        route={{ params: { openContractId: "contract-pro-target" } } as any}
      />
    );

    await waitFor(() => expect(getMessagesSpy).toHaveBeenCalledWith("token-test", "contract-pro-target"));
    await waitFor(() => expect(getByTestId("screen.professional.chat.detail")).toBeTruthy());
  });
});
