import { Prisma } from "@prisma/client";
import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { toProviderPhotoUrl, toUserPhotoUrl } from "../../../shared/utils/photo-url";
import { NotificationService } from "../../notifications/services/notification.service";

function isChatOpen(booking: { status: string }): boolean {
  return ["PENDING", "CONFIRMED"].includes(booking.status);
}

const notificationService = new NotificationService();

const MESSAGE_SELECT = {
  id: true,
  senderId: true,
  isSystem: true,
  content: true,
  readAt: true,
  createdAt: true,
} as const;

const CHAT_ALLOWED_PHOTO_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

function parseDataImage(value: string | null | undefined) {
  const raw = value ?? "";
  const match = raw.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/s);
  if (!match) return null;
  const mimeType = match[1]!;
  if (!CHAT_ALLOWED_PHOTO_MIMES.has(mimeType)) return null;
  const buffer = Buffer.from(match[2]!, "base64");
  if (!buffer.length) return null;
  return { mimeType, buffer };
}

function mapOtherUserPhotoUrl(input: {
  providerId: string;
  providerUpdatedAt?: Date | null;
  targetUserId?: string;
  targetUserUpdatedAt?: Date | null;
  isClientViewer: boolean;
  rawPhotoUrl?: string | null;
}) {
  const {
    providerId,
    providerUpdatedAt,
    targetUserId,
    targetUserUpdatedAt,
    isClientViewer,
    rawPhotoUrl
  } = input;

  if (!rawPhotoUrl) return null;
  if (isClientViewer) return toProviderPhotoUrl(providerId, rawPhotoUrl, providerUpdatedAt);

  if (!targetUserId) {
    return rawPhotoUrl;
  }

  return toUserPhotoUrl(targetUserId, rawPhotoUrl, targetUserUpdatedAt);
}

export class ChatController {
  listMyChats = async (req: Request, res: Response) => {
    const userId = req.user!.id;

    const bookings = await prisma.booking.findMany({
      where: {
        OR: [{ clientId: userId }, { provider: { userId } }],
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
      include: {
        client: { select: { id: true, name: true, photoUrl: true, updatedAt: true } },
        provider: {
          select: { userId: true, displayName: true, photoUrl: true, updatedAt: true }
        }
      },
    });

    const bookingIds = bookings.map((booking) => booking.id);
    if (bookingIds.length === 0) {
      return res.json([]);
    }

    const lastMessages = await prisma.$queryRaw<Array<{
      id: string;
      bookingId: string;
      content: string;
      senderId: string | null;
      isSystem: boolean;
      readAt: Date | null;
      createdAt: Date;
    }>>`
      SELECT DISTINCT ON ("bookingId")
        "id",
        "bookingId",
        "content",
        "senderId",
        "isSystem",
        "readAt",
        "createdAt"
      FROM "BookingMessage"
      WHERE "bookingId" IN (${Prisma.join(bookingIds)})
      ORDER BY "bookingId", "createdAt" DESC, "id" DESC
    `;

    const unreadRows = await prisma.bookingMessage.groupBy({
      by: ["bookingId"],
      where: {
        bookingId: { in: bookingIds },
        readAt: null,
        OR: [{ senderId: { not: userId } }, { isSystem: true }]
      },
      _count: { _all: true }
    });

    const lastMessageByBookingId = new Map(lastMessages.map((item) => [item.bookingId, item]));
    const unreadByBookingId = new Map(unreadRows.map((item) => [item.bookingId, item._count._all]));

    const result = bookings
      .filter((booking) => lastMessageByBookingId.has(booking.id))
      .map((booking) => {
        const lastMsg = lastMessageByBookingId.get(booking.id)!;
        const unreadCount = unreadByBookingId.get(booking.id) ?? 0;
        const isUserProvider = booking.provider.userId === userId;
        const rawPhotoUrl = isUserProvider ? booking.client.photoUrl : booking.provider.photoUrl;
        const photoUrl = mapOtherUserPhotoUrl({
          providerId: booking.providerId,
          providerUpdatedAt: booking.provider.updatedAt,
          targetUserId: booking.client.id,
          targetUserUpdatedAt: booking.client.updatedAt,
          isClientViewer: !isUserProvider,
          rawPhotoUrl,
        });
        return {
          bookingId: booking.id,
          bookingStatus: booking.status,
          isOpen: isChatOpen(booking),
          otherUser: {
            name: isUserProvider ? booking.client.name : booking.provider.displayName,
            photoUrl,
          },
          clientId: booking.clientId,
          lastMessage: {
            content: lastMsg.content,
            createdAt: lastMsg.createdAt.toISOString(),
            isMine: lastMsg.senderId === userId,
            isSystem: lastMsg.isSystem,
          },
          unreadCount,
        };
      })
      .sort(
        (a, b) =>
          new Date(b.lastMessage.createdAt).getTime() -
          new Date(a.lastMessage.createdAt).getTime()
      );

    return res.json(result);
  };

  getMessages = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { bookingId } = req.params;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        provider: { select: { userId: true, displayName: true, photoUrl: true, updatedAt: true } },
        client: { select: { id: true, name: true, photoUrl: true, updatedAt: true } },
      },
    });

    if (!booking) throw new AppError("Agendamento não encontrado.", StatusCodes.NOT_FOUND);

    const isClient = booking.clientId === userId;
    const isProvider = booking.provider.userId === userId;
    if (!isClient && !isProvider) throw new AppError("Acesso negado.", StatusCodes.FORBIDDEN);

    // Mark messages sent by the other user (or system) as read
    await prisma.bookingMessage.updateMany({
      where: {
        bookingId,
        readAt: null,
        OR: [
          { senderId: { not: userId } },
          { isSystem: true },
        ],
      },
      data: { readAt: new Date() },
    });

    const rawCursor = req.query.before as string | undefined;
    const take = 100;
    const messages = await prisma.bookingMessage.findMany({
      where: {
        bookingId,
        ...(rawCursor ? { createdAt: { lt: new Date(rawCursor) } } : {}),
      },
      orderBy: { createdAt: "asc" },
      take,
      select: MESSAGE_SELECT,
    });

    const rawPhotoUrl = isClient ? booking.provider.photoUrl : booking.client.photoUrl;
    const otherUser = {
      name: isClient ? booking.provider.displayName : booking.client.name,
      photoUrl: mapOtherUserPhotoUrl({
        providerId: booking.providerId,
        providerUpdatedAt: booking.provider.updatedAt,
        targetUserId: booking.client.id,
        targetUserUpdatedAt: booking.client.updatedAt,
        isClientViewer: isClient,
        rawPhotoUrl,
      }),
    };

    return res.json({
      messages,
      isOpen: isChatOpen(booking),
      otherUser,
    });
  };

  getOtherUser = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { bookingId } = req.params;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        provider: { select: { userId: true, displayName: true, photoUrl: true, updatedAt: true } },
        client: { select: { id: true, name: true, photoUrl: true, updatedAt: true } },
      },
    });

    if (!booking) throw new AppError("Agendamento não encontrado.", StatusCodes.NOT_FOUND);

    const isClient = booking.clientId === userId;
    const isProvider = booking.provider.userId === userId;
    if (!isClient && !isProvider) throw new AppError("Acesso negado.", StatusCodes.FORBIDDEN);

    const rawPhotoUrl = isClient ? booking.provider.photoUrl : booking.client.photoUrl;
    const otherUser = {
      name: isClient ? booking.provider.displayName : booking.client.name,
      photoUrl: mapOtherUserPhotoUrl({
        providerId: booking.providerId,
        providerUpdatedAt: booking.provider.updatedAt,
        targetUserId: booking.client.id,
        targetUserUpdatedAt: booking.client.updatedAt,
        isClientViewer: isClient,
        rawPhotoUrl,
      }),
    };

    return res.json(otherUser);
  };

  streamOtherUserPhoto = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { bookingId } = req.params;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        provider: { select: { userId: true, photoUrl: true } },
        client: { select: { id: true, photoUrl: true } },
      },
    });

    if (!booking) throw new AppError("Agendamento não encontrado.", StatusCodes.NOT_FOUND);

    const isClient = booking.clientId === userId;
    const isProvider = booking.provider.userId === userId;
    if (!isClient && !isProvider) throw new AppError("Acesso negado.", StatusCodes.FORBIDDEN);

    const rawPhotoUrl = isClient ? booking.provider.photoUrl : booking.client.photoUrl;
    const parsed = parseDataImage(rawPhotoUrl);
    if (!parsed) throw new AppError("Foto não disponível.", StatusCodes.NOT_FOUND);

    res.setHeader("Content-Type", parsed.mimeType);
    res.setHeader("Content-Length", String(parsed.buffer.length));
    res.setHeader("Cache-Control", "private, max-age=300");
    return res.status(StatusCodes.OK).send(parsed.buffer);
  };

  sendMessage = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { bookingId } = req.params;
    const { content } = req.body as { content: string };

    if (!content?.trim()) throw new AppError("Mensagem não pode ser vazia.", StatusCodes.BAD_REQUEST);
    if (content.trim().length > 1000) throw new AppError("Mensagem muito longa.", StatusCodes.BAD_REQUEST);

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        provider: { select: { userId: true, displayName: true } },
        client: { select: { id: true, name: true } },
      },
    });

    if (!booking) throw new AppError("Agendamento não encontrado.", StatusCodes.NOT_FOUND);

    const isClient = booking.clientId === userId;
    const isProvider = booking.provider.userId === userId;
    if (!isClient && !isProvider) throw new AppError("Acesso negado.", StatusCodes.FORBIDDEN);

    if (!isChatOpen(booking)) {
      throw new AppError("Este chat está arquivado e não aceita novas mensagens.", StatusCodes.FORBIDDEN);
    }

    const message = await prisma.bookingMessage.create({
      data: { bookingId, senderId: userId, content: content.trim() },
      select: MESSAGE_SELECT,
    });

    // Notify the other participant
    const recipientId = isClient ? booking.provider.userId : booking.client.id;
    const senderName = isClient ? booking.client.name : booking.provider.displayName;

    void notificationService
      .sendToUsers([recipientId], {
        preferenceType: "BOOKINGS",
        title: `💬 ${senderName}`,
        body: content.trim().length > 80 ? content.trim().slice(0, 80) + "…" : content.trim(),
        data: { type: "CHAT_MESSAGE", bookingId, messageId: message.id },
      })
      .catch(() => undefined);

    return res.status(StatusCodes.CREATED).json(message);
  };
}
