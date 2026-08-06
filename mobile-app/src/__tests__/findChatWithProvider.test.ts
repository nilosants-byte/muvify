import { findChatWithProvider } from "../utils/findChatWithProvider";
import { ChatSummary, ConsultancyChatSummary } from "../services/api/client";

function booking(overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    bookingId: "booking-1",
    bookingStatus: "CONFIRMED",
    isOpen: true,
    providerId: "provider-1",
    otherUser: { name: "Fulano" },
    clientId: "client-1",
    lastMessage: { content: "oi", createdAt: "2026-08-01T10:00:00.000Z", isMine: false, isSystem: false },
    unreadCount: 0,
    ...overrides
  };
}

function consultancy(overrides: Partial<ConsultancyChatSummary> = {}): ConsultancyChatSummary {
  return {
    contractId: "contract-1",
    contractStatus: "ACTIVE",
    isOpen: true,
    providerId: "provider-2",
    otherUser: { name: "Beltrana" },
    clientId: "client-1",
    lastMessage: { content: "oi", createdAt: "2026-08-01T10:00:00.000Z", isMine: false, isSystem: false },
    unreadCount: 0,
    ...overrides
  };
}

// Segunda camada, Frente 1, Lote 3 (fechamento): o botão de mensagem no
// perfil do profissional sempre abria a lista geral de conversas, sem
// relação com o profissional visto. Essa função decide se já existe uma
// conversa com ELE especificamente.
describe("findChatWithProvider", () => {
  it("acha uma conversa de agendamento com o profissional certo", () => {
    const result = findChatWithProvider([booking({ providerId: "provider-x" })], [], "provider-x");
    expect(result).toEqual({ kind: "booking", bookingId: "booking-1" });
  });

  it("acha uma conversa de consultoria com o profissional certo", () => {
    const result = findChatWithProvider([], [consultancy({ providerId: "provider-x" })], "provider-x");
    expect(result).toEqual({ kind: "consultancy", contractId: "contract-1" });
  });

  it("prioriza chat de agendamento se existirem os dois tipos com o mesmo profissional", () => {
    const result = findChatWithProvider(
      [booking({ providerId: "provider-x", bookingId: "booking-9" })],
      [consultancy({ providerId: "provider-x", contractId: "contract-9" })],
      "provider-x"
    );
    expect(result).toEqual({ kind: "booking", bookingId: "booking-9" });
  });

  it("não confunde conversa com outro profissional", () => {
    const result = findChatWithProvider(
      [booking({ providerId: "provider-outro" })],
      [consultancy({ providerId: "provider-outro-2" })],
      "provider-x"
    );
    expect(result).toBeNull();
  });

  it("retorna null quando não há nenhuma conversa", () => {
    expect(findChatWithProvider([], [], "provider-x")).toBeNull();
  });
});
