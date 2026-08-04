import { io, Socket } from "socket.io-client";
import { API_BASE_URL } from "../api/client";

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

export function connectSocket(accessToken: string) {
  if (socket?.connected && socket.auth && (socket.auth as { token?: string }).token === accessToken) {
    return socket;
  }
  disconnectSocket();
  socket = io(SOCKET_BASE_URL, {
    auth: { token: accessToken },
    transports: ["websocket"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });
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
