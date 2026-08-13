import { io, Socket } from "socket.io-client";
import { API_BASE_URL } from "../api/client";
import { captureException } from "../../observability/sentry";

// O socket conecta direto na raiz do servidor (sem o prefixo /api das rotas REST).
const SOCKET_BASE_URL = API_BASE_URL.replace(/\/api\/?$/, "");

export type NewBookingMessageEvent = {
  id: string;
  senderId: string | null;
  isSystem: boolean;
  content: string;
  readAt: string | null;
  createdAt: string;
};

let socket: Socket | null = null;

// Frente 13 (segunda camada), Lote 11: o socket de chat em tempo real nunca
// tinha handler nenhum de erro/desconexão — falha de conexão (auth
// rejeitada, servidor fora) era um blind spot total (nem log, nem toast,
// nem Sentry). Reporta só o PRIMEIRO connect_error de cada sequência de
// reconexão (reconnection:true tenta pra sempre por padrão) — evita
// inundar o Sentry a cada blip normal de rede móvel (troca de wifi pra
// dados, elevador, etc.), mas ainda avisa quando a conexão realmente cai.
let hasReportedConnectError = false;

function attachConnectionErrorHandlers(target: Socket) {
  target.on("connect", () => {
    hasReportedConnectError = false;
  });
  target.on("connect_error", (error) => {
    if (hasReportedConnectError) return;
    hasReportedConnectError = true;
    captureException(error, { area: "realtime-socket-connect-error" });
  });
  target.on("error", (error) => {
    captureException(error, { area: "realtime-socket-error" });
  });
}

export function connectSocket(accessToken: string) {
  if (socket?.connected && socket.auth && (socket.auth as { token?: string }).token === accessToken) {
    return socket;
  }
  disconnectSocket();
  socket = io(SOCKET_BASE_URL, {
    auth: { token: accessToken },
    // Frente 14 (segunda camada, carga real), Lote 15: só "websocket" (sem
    // fallback) fazia a conexão falhar de vez em redes de operadora com
    // proxy que bloqueia ou não faz upgrade de WebSocket corretamente — o
    // app ficava preso em reconexão automática indefinida tentando só
    // websocket de novo. "websocket" continua primeiro na lista (latência
    // menor pro caso comum, que já funciona hoje), "polling" entra como
    // fallback real quando o primeiro não emplaca.
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });
  hasReportedConnectError = false;
  attachConnectionErrorHandlers(socket);
  return socket;
}

export function disconnectSocket() {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}

export function getSocket() {
  return socket;
}

export function isSocketConnected() {
  return socket?.connected ?? false;
}

export function joinBookingRoom(bookingId: string) {
  socket?.emit("join:booking", bookingId);
}

export function leaveBookingRoom(bookingId: string) {
  socket?.emit("leave:booking", bookingId);
}

// Épico de Frentes, Frente 9, Lote 8: chat de consultoria (mobile) - espelha
// join/leaveBookingRoom pra ConsultancyContract. onNewBookingMessage já
// escuta "message:new" de forma genérica (o servidor emite o mesmo evento
// pra ambas as salas), então não precisa de um listener separado.
export function joinConsultancyRoom(contractId: string) {
  socket?.emit("join:consultancy", contractId);
}

export function leaveConsultancyRoom(contractId: string) {
  socket?.emit("leave:consultancy", contractId);
}

export function onNewBookingMessage(handler: (message: NewBookingMessageEvent) => void) {
  socket?.on("message:new", handler);
  return () => socket?.off("message:new", handler);
}

// Frente 14 (segunda camada, carga real), Lote 13: evento leve (sem
// conteúdo de mensagem) emitido pra sala pessoal do usuário sempre que
// alguma conversa dele recebe mensagem nova — mesmo sem estar com aquela
// conversa específica aberta. Substitui o polling de 15s que a Home do
// profissional fazia contra a lista completa de chats só pra manter o
// badge de não lidos.
export function onChatUnreadChanged(handler: () => void) {
  socket?.on("chat:unread-changed", handler);
  return () => socket?.off("chat:unread-changed", handler);
}
