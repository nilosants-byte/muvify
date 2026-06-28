import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
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

let io: SocketIOServer | null = null;

function parseCorsOrigins(): string[] {
  return env.CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function bookingRoom(bookingId: string) {
  return `booking:${bookingId}`;
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
  void socket.leave(bookingRoom(bookingId));
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
    }
  } else {
    console.warn("[realtime] Redis indisponivel no boot do socket. Seguindo sem adaptador (modo single-instance).");
  }

  io.use((socket, next) => void authenticateSocket(socket, next));

  io.on("connection", (socket) => {
    socket.on("join:booking", (bookingId: unknown) => void handleJoinBooking(socket, bookingId));
    socket.on("leave:booking", (bookingId: unknown) => handleLeaveBooking(socket, bookingId));
  });

  return io;
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
  }
}

export async function stopSocketServer() {
  if (!io) {
    return;
  }
  const current = io;
  io = null;
  await new Promise<void>((resolve) => {
    current.close(() => resolve());
  });
}
