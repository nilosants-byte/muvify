import { ChatSummary, ConsultancyChatSummary } from "../services/api/client";

// Segunda camada, Frente 1, Lote 3 (fechamento): decide se já existe uma
// conversa com um profissional específico, e qual - usado pelo botão de
// mensagem no perfil do profissional, que antes sempre abria a lista geral
// de conversas sem nenhuma relação com quem o usuário estava vendo. Extraído
// como função pura pra ser testável sem precisar renderizar a tela inteira.
export type ChatWithProvider =
  | { kind: "booking"; bookingId: string }
  | { kind: "consultancy"; contractId: string }
  | null;

export function findChatWithProvider(
  bookingChats: ChatSummary[],
  consultancyChats: ConsultancyChatSummary[],
  providerId: string
): ChatWithProvider {
  const bookingChat = bookingChats.find((c) => c.providerId === providerId);
  if (bookingChat) return { kind: "booking", bookingId: bookingChat.bookingId };

  const consultancyChat = consultancyChats.find((c) => c.providerId === providerId);
  if (consultancyChat) return { kind: "consultancy", contractId: consultancyChat.contractId };

  return null;
}
