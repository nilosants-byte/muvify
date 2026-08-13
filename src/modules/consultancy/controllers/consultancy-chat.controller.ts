import { Prisma } from "@prisma/client";
import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../config/prisma";
import { emitNewConsultancyMessage, isUserInConsultancyRoom } from "../../../realtime/socket";
import { AppError } from "../../../shared/errors/app-error";
import { toProviderPhotoUrl, toUserPhotoUrl } from "../../../shared/utils/photo-url";
import { assertEmailVerified } from "../../../shared/utils/email-verification";
import { NotificationService } from "../../notifications/services/notification.service";

// Épico de Frentes, Frente 9, Lote 7: chat de consultoria - generaliza a
// mesma infraestrutura já usada pro chat de agendamento (chat.controller.ts)
// pra ConsultancyContract, com o mesmo desenho de autorização/desenho de
// dados, mas usando um model próprio (ConsultancyMessage) em vez de
// retrofitar BookingMessage.
function isConsultancyChatOpen(contract: { status: string }): boolean {
  return ["ACTIVE", "DELIVERED"].includes(contract.status);
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

export class ConsultancyChatController {
  listMyChats = async (req: Request, res: Response) => {
    const userId = req.user!.id;

    const contracts = await prisma.consultancyContract.findMany({
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

    const contractIds = contracts.map((contract) => contract.id);
    if (contractIds.length === 0) {
      return res.json([]);
    }

    const lastMessages = await prisma.$queryRaw<Array<{
      id: string;
      contractId: string;
      content: string;
      senderId: string | null;
      isSystem: boolean;
      readAt: Date | null;
      createdAt: Date;
    }>>`
      SELECT DISTINCT ON ("contractId")
        "id",
        "contractId",
        "content",
        "senderId",
        "isSystem",
        "readAt",
        "createdAt"
      FROM "ConsultancyMessage"
      WHERE "contractId" IN (${Prisma.join(contractIds)})
      ORDER BY "contractId", "createdAt" DESC, "id" DESC
    `;

    const unreadRows = await prisma.consultancyMessage.groupBy({
      by: ["contractId"],
      where: {
        contractId: { in: contractIds },
        readAt: null,
        OR: [{ senderId: { not: userId } }, { isSystem: true }]
      },
      _count: { _all: true }
    });

    const lastMessageByContractId = new Map(lastMessages.map((item) => [item.contractId, item]));
    const unreadByContractId = new Map(unreadRows.map((item) => [item.contractId, item._count._all]));

    const result = contracts
      .filter((contract) => lastMessageByContractId.has(contract.id))
      .map((contract) => {
        const lastMsg = lastMessageByContractId.get(contract.id)!;
        const unreadCount = unreadByContractId.get(contract.id) ?? 0;
        const isUserProvider = contract.provider.userId === userId;
        const rawPhotoUrl = isUserProvider ? contract.client.photoUrl : contract.provider.photoUrl;
        const photoUrl = mapOtherUserPhotoUrl({
          providerId: contract.providerId,
          providerUpdatedAt: contract.provider.updatedAt,
          targetUserId: contract.client.id,
          targetUserUpdatedAt: contract.client.updatedAt,
          isClientViewer: !isUserProvider,
          rawPhotoUrl,
        });
        return {
          contractId: contract.id,
          contractStatus: contract.status,
          isOpen: isConsultancyChatOpen(contract),
          // Segunda camada, Frente 1, Lote 3 (fechamento): sem isso, o app não
          // tinha como saber "já existe uma conversa com este profissional?"
          // ao abrir o perfil dele - o botão de mensagem sempre caía numa
          // lista genérica em vez da conversa certa.
          providerId: contract.providerId,
          otherUser: {
            name: isUserProvider ? contract.client.name : contract.provider.displayName,
            photoUrl,
          },
          clientId: contract.clientId,
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
    const { contractId } = req.params;

    const contract = await prisma.consultancyContract.findUnique({
      where: { id: contractId },
      include: {
        provider: { select: { userId: true, displayName: true, photoUrl: true, updatedAt: true } },
        client: { select: { id: true, name: true, photoUrl: true, updatedAt: true } },
      },
    });

    if (!contract) throw new AppError("Consultoria não encontrada.", StatusCodes.NOT_FOUND);

    const isClient = contract.clientId === userId;
    const isProvider = contract.provider.userId === userId;
    if (!isClient && !isProvider) throw new AppError("Acesso negado.", StatusCodes.FORBIDDEN);

    await prisma.consultancyMessage.updateMany({
      where: {
        contractId,
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
    const messages = await prisma.consultancyMessage.findMany({
      where: {
        contractId,
        // Épico de Frentes, Frente 10, Lote 1: mensagem ocultada por um
        // admin (denúncia procedente) some do chat pra todo mundo.
        hiddenByAdminAt: null,
        ...(rawCursor ? { createdAt: { lt: new Date(rawCursor) } } : {}),
      },
      orderBy: { createdAt: "asc" },
      take,
      select: MESSAGE_SELECT,
    });

    const rawPhotoUrl = isClient ? contract.provider.photoUrl : contract.client.photoUrl;
    const otherUser = {
      name: isClient ? contract.provider.displayName : contract.client.name,
      photoUrl: mapOtherUserPhotoUrl({
        providerId: contract.providerId,
        providerUpdatedAt: contract.provider.updatedAt,
        targetUserId: contract.client.id,
        targetUserUpdatedAt: contract.client.updatedAt,
        isClientViewer: isClient,
        rawPhotoUrl,
      }),
    };

    return res.json({
      messages,
      isOpen: isConsultancyChatOpen(contract),
      otherUser,
    });
  };

  getOtherUser = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { contractId } = req.params;

    const contract = await prisma.consultancyContract.findUnique({
      where: { id: contractId },
      include: {
        provider: { select: { userId: true, displayName: true, photoUrl: true, updatedAt: true } },
        client: { select: { id: true, name: true, photoUrl: true, updatedAt: true } },
      },
    });

    if (!contract) throw new AppError("Consultoria não encontrada.", StatusCodes.NOT_FOUND);

    const isClient = contract.clientId === userId;
    const isProvider = contract.provider.userId === userId;
    if (!isClient && !isProvider) throw new AppError("Acesso negado.", StatusCodes.FORBIDDEN);

    const rawPhotoUrl = isClient ? contract.provider.photoUrl : contract.client.photoUrl;
    const otherUser = {
      name: isClient ? contract.provider.displayName : contract.client.name,
      photoUrl: mapOtherUserPhotoUrl({
        providerId: contract.providerId,
        providerUpdatedAt: contract.provider.updatedAt,
        targetUserId: contract.client.id,
        targetUserUpdatedAt: contract.client.updatedAt,
        isClientViewer: isClient,
        rawPhotoUrl,
      }),
    };

    return res.json(otherUser);
  };

  sendMessage = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { contractId } = req.params;
    const { content } = req.body as { content: string };

    if (!content?.trim()) throw new AppError("Mensagem não pode ser vazia.", StatusCodes.BAD_REQUEST);
    if (content.trim().length > 1000) throw new AppError("Mensagem muito longa.", StatusCodes.BAD_REQUEST);

    await assertEmailVerified(userId);

    const contract = await prisma.consultancyContract.findUnique({
      where: { id: contractId },
      include: {
        provider: { select: { userId: true, displayName: true } },
        client: { select: { id: true, name: true } },
      },
    });

    if (!contract) throw new AppError("Consultoria não encontrada.", StatusCodes.NOT_FOUND);

    const isClient = contract.clientId === userId;
    const isProvider = contract.provider.userId === userId;
    if (!isClient && !isProvider) throw new AppError("Acesso negado.", StatusCodes.FORBIDDEN);

    if (!isConsultancyChatOpen(contract)) {
      throw new AppError("Esta consultoria está arquivada e não aceita novas mensagens.", StatusCodes.FORBIDDEN);
    }

    const message = await prisma.consultancyMessage.create({
      data: { contractId, senderId: userId, content: content.trim() },
      select: MESSAGE_SELECT,
    });

    // Avisa em tempo real quem estiver com a conversa aberta (best-effort, nunca bloqueia a resposta)
    emitNewConsultancyMessage(contractId, message, [contract.clientId, contract.provider.userId]);

    // Épico de Frentes, Frente 9, Lote 9: mesmo achado do chat de
    // agendamento - pula o push se o destinatário já estiver com a sala
    // aberta (vendo a mensagem chegar ao vivo pelo socket).
    const recipientId = isClient ? contract.provider.userId : contract.client.id;
    const senderName = isClient ? contract.client.name : contract.provider.displayName;

    if (!isUserInConsultancyRoom(contractId, recipientId)) {
      void notificationService
        .sendToUsers([recipientId], {
          // Épico de Frentes, Frente 9, Lote 19: mesmo achado do chat de
          // agendamento - CONSULTANCY não deveria controlar mensagem de
          // chat, categoria própria.
          preferenceType: "CHAT",
          title: `💬 ${senderName}`,
          body: content.trim().length > 80 ? content.trim().slice(0, 80) + "…" : content.trim(),
          data: { type: "CHAT_MESSAGE", contractId, messageId: message.id },
        })
        .catch(() => undefined);
    }

    return res.status(StatusCodes.CREATED).json(message);
  };

  // Épico de Frentes, Frente 9, Lote 10: denúncia de mensagem - espelha
  // ChatController::reportMessage.
  reportMessage = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { contractId, messageId } = req.params;
    const { reason } = req.body as { reason?: string };

    const contract = await prisma.consultancyContract.findUnique({
      where: { id: contractId },
      include: { provider: { select: { userId: true } } },
    });
    if (!contract) throw new AppError("Consultoria não encontrada.", StatusCodes.NOT_FOUND);

    const isClient = contract.clientId === userId;
    const isProvider = contract.provider.userId === userId;
    if (!isClient && !isProvider) throw new AppError("Acesso negado.", StatusCodes.FORBIDDEN);

    const message = await prisma.consultancyMessage.findUnique({
      where: { id: messageId },
      select: { id: true, contractId: true, senderId: true },
    });
    if (!message || message.contractId !== contractId) {
      throw new AppError("Mensagem não encontrada.", StatusCodes.NOT_FOUND);
    }
    if (message.senderId === userId) {
      throw new AppError("Você não pode denunciar a própria mensagem.", StatusCodes.BAD_REQUEST);
    }

    await prisma.consultancyMessageReport.upsert({
      where: { messageId_reporterId: { messageId, reporterId: userId } },
      create: { messageId, reporterId: userId, reason },
      update: {},
    });

    return res.status(StatusCodes.NO_CONTENT).send();
  };
}
