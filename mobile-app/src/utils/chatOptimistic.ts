import type { ChatMessage } from "../services/api/client";

// Sugestão do Danilo (teste manual C9.1, 21/10/2026): mensagem aparece na
// bolha NA HORA, igual WhatsApp — relógio enquanto envia, 1 check enviada,
// 2 checks lida. O campo nunca trava; dá pra mandar várias seguidas.
//
// Também corrige a mensagem duplicada: a mensagem enviada chega por dois
// caminhos (resposta do envio + aviso em tempo real do socket) e o da
// resposta não descartava repetidas — React reclamava de chave repetida.
export type LocalChatMessage = ChatMessage & { localStatus?: "sending" | "failed" };

export function makeSendingMessage(senderId: string, content: string): LocalChatMessage {
  return {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    senderId,
    content,
    readAt: null,
    createdAt: new Date().toISOString(),
    localStatus: "sending"
  };
}

function isLocal(m: LocalChatMessage) {
  return m.localStatus === "sending" || m.localStatus === "failed";
}

// Resposta do envio chegou: troca a bolha local pela mensagem do servidor —
// ou só remove a local, se o socket já tiver entregado a mesma mensagem.
export function confirmSent(prev: LocalChatMessage[], localId: string, server: ChatMessage): LocalChatMessage[] {
  const alreadyThere = prev.some((m) => m.id === server.id);
  if (alreadyThere) return prev.filter((m) => m.id !== localId);
  const idx = prev.findIndex((m) => m.id === localId);
  if (idx < 0) return [...prev, server];
  const next = prev.slice();
  next[idx] = server;
  return next;
}

export function markFailed(prev: LocalChatMessage[], localId: string): LocalChatMessage[] {
  return prev.map((m) => (m.id === localId ? { ...m, localStatus: "failed" } : m));
}

export function markSending(prev: LocalChatMessage[], localId: string): LocalChatMessage[] {
  return prev.map((m) => (m.id === localId ? { ...m, localStatus: "sending" } : m));
}

// Mensagem nova pelo socket: descarta repetida; se for minha e ainda houver
// uma bolha local "enviando" com o mesmo texto, ocupa o lugar dela.
export function applyRealtime(prev: LocalChatMessage[], incoming: ChatMessage, myUserId: string): LocalChatMessage[] {
  if (prev.some((m) => m.id === incoming.id)) return prev;
  if (incoming.senderId === myUserId) {
    const idx = prev.findIndex((m) => m.localStatus === "sending" && m.content === incoming.content);
    if (idx >= 0) {
      const next = prev.slice();
      next[idx] = incoming;
      return next;
    }
  }
  return [...prev, incoming];
}

// Recarga completa (abrir conversa / polling): usa a lista do servidor, mas
// mantém as bolhas locais que o servidor ainda não tem (enviando ou falhou).
export function mergeServerList(prev: LocalChatMessage[], server: ChatMessage[], myUserId: string): LocalChatMessage[] {
  const knownIds = new Set(prev.filter((m) => !isLocal(m)).map((m) => m.id));
  // Mensagens minhas que o servidor tem e a tela ainda não tinha: podem ser
  // a versão "oficial" de uma bolha local cuja resposta ainda está a caminho.
  const unmatched = server.filter((s) => s.senderId === myUserId && !knownIds.has(s.id));
  const locals = prev.filter(isLocal).filter((m) => {
    if (m.localStatus !== "sending") return true;
    const i = unmatched.findIndex((s) => s.content === m.content);
    if (i >= 0) {
      unmatched.splice(i, 1);
      return false;
    }
    return true;
  });
  return [...server, ...locals];
}
