import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import * as Sentry from "@sentry/node";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { redis } from "../config/redis";
import { ENABLE_REALTIME_CHAT } from "../config/features";
import { getTokenBlacklistedSince } from "../shared/security/token-blacklist";
import { verifyToken } from "../shared/utils/jwt";

type SocketData = {
  userId: string;
};

type NewBookingMessagePayload = {
  id: string;
  senderId: string | null;
  isSystem: boolean;
  content: string;
  readAt: Date | string | null;
  createdAt: Date | string;
};

type NewConsultancyMessagePayload = NewBookingMessagePayload;

let io: SocketIOServer | null = null;

function parseCorsOrigins(): string[] {
  return env.CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function bookingRoom(bookingId: string) {
  return `booking:${bookingId}`;
}

function consultancyRoom(contractId: string) {
  return `consultancy:${contractId}`;
}

async function authenticateSocket(socket: Socket, next: (err?: Error) => void) {
  try {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      return next(new Error("Token nao informado."));
    }

    const payload = verifyToken(token);
    const blacklistedSince = await getTokenBlacklistedSince(payload.sub, {
      allowLocalFallback: true
    });
    if (blacklistedSince !== null && payload.iat !== undefined && payload.iat <= blacklistedSince) {
      return next(new Error("Sessao encerrada. Faca login novamente."));
    }

    (socket.data as SocketData).userId = payload.sub;
    next();
  } catch {
    next(new Error("Token invalido."));
  }
}

async function handleJoinBooking(socket: Socket, bookingId: unknown) {
  if (typeof bookingId !== "string" || !bookingId) {
    return;
  }

  const userId = (socket.data as SocketData).userId;
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { clientId: true, provider: { select: { userId: true } } }
  });

  const isClient = booking?.clientId === userId;
  const isProvider = booking?.provider.userId === userId;
  if (!booking || (!isClient && !isProvider)) {
    // Não revela se o agendamento existe — apenas ignora silenciosamente.
    return;
  }

  await socket.join(bookingRoom(bookingId));
}

function handleLeaveBooking(socket: Socket, bookingId: unknown) {
  if (typeof bookingId !== "string" || !bookingId) {
    return;
  }
  return socket.leave(bookingRoom(bookingId));
}

// Épico de Frentes, Frente 9, Lote 7: espelha handleJoinBooking/
// handleLeaveBooking pra ConsultancyContract, generalizando o mesmo padrão
// de sala em tempo real pro chat de consultoria.
async function handleJoinConsultancy(socket: Socket, contractId: unknown) {
  if (typeof contractId !== "string" || !contractId) {
    return;
  }

  const userId = (socket.data as SocketData).userId;
  const contract = await prisma.consultancyContract.findUnique({
    where: { id: contractId },
    select: { clientId: true, provider: { select: { userId: true } } }
  });

  const isClient = contract?.clientId === userId;
  const isProvider = contract?.provider.userId === userId;
  if (!contract || (!isClient && !isProvider)) {
    // Não revela se o contrato existe — apenas ignora silenciosamente.
    return;
  }

  await socket.join(consultancyRoom(contractId));
}

function handleLeaveConsultancy(socket: Socket, contractId: unknown) {
  if (typeof contractId !== "string" || !contractId) {
    return;
  }
  return socket.leave(consultancyRoom(contractId));
}

// Frente 2 (segunda camada), Lote 1: envelope de segurança — todo handler de
// evento de socket deve ser registrado através desta função, nunca direto em
// socket.on(...). Sem isso, uma falha nele (ex.: timeout do banco) vira uma
// rejeição não tratada, que derruba o processo inteiro pra todos os usuários
// conectados (política de unhandledRejection em server.ts). Cobre handlers
// atuais e qualquer handler novo que venha a ser registrado no futuro.
function safeSocketHandler<Args extends unknown[]>(
  event: string,
  socket: Socket,
  handler: (socket: Socket, ...args: Args) => void | Promise<void>
) {
  return (...args: Args) => {
    try {
      const result = handler(socket, ...args);
      if (result instanceof Promise) {
        result.catch((error: unknown) => {
          console.error(`[realtime] Falha no handler do evento "${event}":`, error);
          Sentry.captureException(error, { tags: { area: "realtime", event } });
        });
      }
    } catch (error) {
      console.error(`[realtime] Falha no handler do evento "${event}":`, error);
      Sentry.captureException(error, { tags: { area: "realtime", event } });
    }
  };
}

/** Anexa o servidor de WebSocket ao servidor HTTP já existente (mesma porta, mesmo processo). */
export async function initSocketServer(httpServer: HttpServer) {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: parseCorsOrigins(),
      credentials: true
    }
  });

  // Adaptador Redis: permite que múltiplas instâncias do backend (futuro) troquem
  // eventos entre si. Com uma única instância (cenário atual), o socket.io já
  // funciona corretamente sem isso — por isso falhas aqui não impedem o boot.
  if (redis.status === "ready") {
    try {
      const pubClient = redis.duplicate();
      const subClient = redis.duplicate();
      await Promise.all([pubClient.connect(), subClient.connect()]);
      io.adapter(createAdapter(pubClient, subClient));
    } catch (error) {
      console.error("[realtime] Falha ao configurar adaptador Redis. Seguindo sem ele (modo single-instance):", error);
      // Frente 13 (segunda camada), Lote 8: hoje "modo single-instance" é
      // inofensivo (só uma instância roda mesmo), mas se o app algum dia
      // escalar horizontalmente, uma falha persistente aqui quebraria a
      // sincronização de chat em tempo real entre instâncias em silêncio.
      Sentry.captureException(error, { tags: { area: "realtime-redis-adapter" } });
    }
  } else {
    console.warn("[realtime] Redis indisponivel no boot do socket. Seguindo sem adaptador (modo single-instance).");
  }

  io.use((socket, next) => void authenticateSocket(socket, next));

  io.on("connection", (socket) => {
    socket.on("join:booking", safeSocketHandler("join:booking", socket, handleJoinBooking));
    socket.on("leave:booking", safeSocketHandler("leave:booking", socket, handleLeaveBooking));
    socket.on("join:consultancy", safeSocketHandler("join:consultancy", socket, handleJoinConsultancy));
    socket.on("leave:consultancy", safeSocketHandler("leave:consultancy", socket, handleLeaveConsultancy));
  });

  return io;
}

// Épico de Frentes, Frente 9, Lote 9: enviar mensagem sempre disparava push
// pro destinatário, mesmo que ele já estivesse com a sala aberta (vendo a
// mensagem chegar ao vivo pelo socket) - checa presença antes de notificar.
// Best-effort: com o adaptador Redis (múltiplas instâncias), um destinatário
// conectado em OUTRA instância não aparece aqui - o pior caso é so um push
// redundante, não uma notificação perdida.
function isUserInRoom(room: string, userId: string): boolean {
  if (!io) return false;
  const socketIds = io.sockets.adapter.rooms.get(room);
  if (!socketIds) return false;
  for (const socketId of socketIds) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket && (socket.data as SocketData).userId === userId) return true;
  }
  return false;
}

/** Indica se o usuário está com a sala do agendamento aberta (socket conectado e na sala). */
export function isUserInBookingRoom(bookingId: string, userId: string): boolean {
  return isUserInRoom(bookingRoom(bookingId), userId);
}

/** Indica se o usuário está com a sala do contrato de consultoria aberta (socket conectado e na sala). */
export function isUserInConsultancyRoom(contractId: string, userId: string): boolean {
  return isUserInRoom(consultancyRoom(contractId), userId);
}

/** Emite uma mensagem nova para quem estiver na sala do agendamento. Best-effort: nunca lança erro. */
export function emitNewBookingMessage(bookingId: string, message: NewBookingMessagePayload) {
  if (!io || !ENABLE_REALTIME_CHAT) {
    return;
  }
  try {
    io.to(bookingRoom(bookingId)).emit("message:new", message);
  } catch (error) {
    console.error("[realtime] Falha ao emitir message:new:", error);
    // Frente 13 (segunda camada), Lote 8: a mensagem já está persistida no
    // banco (o usuário a vê ao atualizar a tela), mas uma falha sistemática
    // de emissão (ex: erro de serialização introduzido por uma mudança de
    // schema) reduziria a experiência de chat "ao vivo" pra todo mundo sem
    // qualquer alerta.
    Sentry.captureException(error, { tags: { area: "realtime-emit" }, extra: { bookingId } });
  }
}

/** Emite uma mensagem nova para quem estiver na sala do contrato de consultoria. Best-effort: nunca lança erro. */
export function emitNewConsultancyMessage(contractId: string, message: NewConsultancyMessagePayload) {
  if (!io || !ENABLE_REALTIME_CHAT) {
    return;
  }
  try {
    io.to(consultancyRoom(contractId)).emit("message:new", message);
  } catch (error) {
    console.error("[realtime] Falha ao emitir message:new (consultoria):", error);
    Sentry.captureException(error, { tags: { area: "realtime-emit" }, extra: { contractId } });
  }
}

export async function stopSocketServer() {
  if (!io) {
    return;
  }
  const current = io;
  io = null;
  await current.close();
}
