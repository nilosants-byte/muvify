import { Prisma, SupportTicketStatus, UserRole } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../config/prisma";
import { env } from "../../../config/env";
import { AppError } from "../../../shared/errors/app-error";
import { EmailService } from "../../../shared/services/email.service";
import { isAdminEmail } from "../../../shared/utils/admin-access";
import { NotificationService } from "../../notifications/services/notification.service";
import { DataRetentionService } from "../../privacy/services/data-retention.service";

type DashboardInput = {
  month?: number;
  year?: number;
};

type SupportQueueInput = {
  status?: "OPEN" | "ANSWERED";
  take?: number;
};

type SupportReplyInput = {
  responseMessage: string;
};

type DataRetentionRunsInput = {
  take?: number;
};

type RunDataRetentionInput = {
  dryRun?: boolean;
  triggeredBy?: string;
  legalHoldUserIds?: string[];
};

type ChatAuditSessionsInput = {
  clientEmail?: string;
  providerEmail?: string;
  startedFrom?: string;
  startedTo?: string;
  take?: number;
  cursor?: string;
};

type ChatAuditSessionMessagesInput = {
  bookingId: string;
  take?: number;
  cursor?: string;
};

type ChatAuditSessionSummary = {
  bookingId: string;
  chatStartedAt: string;
  chatLastMessageAt: string;
  messageCount: number;
  bookingScheduledAt: string;
  sessionLocation: string | null;
  priceCents: number;
  currency: string;
  serviceType: string;
  client: {
    id: string;
    name: string;
    email: string;
  };
  provider: {
    profileId: string;
    userId: string;
    name: string;
    email: string;
  };
};

type ChatAuditSessionsOutput = {
  items: ChatAuditSessionSummary[];
  nextCursor: string | null;
};

type ChatAuditSessionMessage = {
  id: string;
  senderId: string | null;
  senderName: string | null;
  senderEmail: string | null;
  isSystem: boolean;
  content: string;
  readAt: string | null;
  createdAt: string;
};

type ChatAuditSessionMessagesOutput = {
  session: ChatAuditSessionSummary;
  messages: ChatAuditSessionMessage[];
  nextCursor: string | null;
};

type OffsetCursorPayload = {
  offset: number;
};

type ChatMessageCursorPayload = {
  createdAt: string;
  id: string;
};

type LocationSnapshot = {
  neighborhood: string;
  city: string;
  region: string;
};

function sanitizeLabel(value?: string | null, fallback = "Nao informado") {
  const normalized = value?.trim();
  if (!normalized) {
    return fallback;
  }

  return normalized;
}

function monthBounds(month: number, year: number) {
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 1, 0, 0, 0, 0);
  return { start, end };
}

function normalizeLocation(provider: { fixedLocations: unknown }): LocationSnapshot {
  const fixedLocations = Array.isArray(provider.fixedLocations)
    ? (provider.fixedLocations as Array<{ name?: string | null; address?: string | null }>)
    : [];

  const firstWithAddress = fixedLocations.find((item) => item.address?.trim());
  const firstWithName = fixedLocations.find((item) => item.name?.trim());

  if (!firstWithAddress && !firstWithName) {
    return {
      neighborhood: "Nao informado",
      city: "Nao informado",
      region: "Nao informado"
    };
  }

  if (firstWithAddress?.address) {
    const address = firstWithAddress.address.trim();
    const parts = address
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length === 1) {
      const city = sanitizeLabel(parts[0]);
      return { neighborhood: city, city, region: city };
    }

    if (parts.length === 2) {
      const neighborhood = sanitizeLabel(parts[0]);
      const cityPart = sanitizeLabel(parts[1]);
      const city = sanitizeLabel(cityPart.split("-")[0]);
      const region = sanitizeLabel(cityPart.split("-")[1] ?? city);
      return { neighborhood, city, region };
    }

    const neighborhood = sanitizeLabel(parts[parts.length - 2]);
    const cityState = sanitizeLabel(parts[parts.length - 1]);
    const city = sanitizeLabel(cityState.split("-")[0]);
    const region = sanitizeLabel(cityState.split("-")[1] ?? city);
    return { neighborhood, city, region };
  }

  const fallback = sanitizeLabel(firstWithName?.name);
  return {
    neighborhood: fallback,
    city: fallback,
    region: fallback
  };
}

function toRanking(map: Map<string, number>, take = 10) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, take)
    .map(([label, bookingsCount]) => ({
      label,
      bookingsCount
    }));
}

function parseDateInput(raw?: string, mode: "start" | "end" = "start") {
  const normalized = raw?.trim();
  if (!normalized) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const suffix = mode === "end" ? "T23:59:59.999Z" : "T00:00:00.000Z";
    const parsed = new Date(`${normalized}${suffix}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function encodeOffsetCursor(offset: number) {
  const payload: OffsetCursorPayload = { offset };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeOffsetCursor(cursor?: string | null) {
  if (!cursor) {
    return 0;
  }

  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as OffsetCursorPayload;
    const offset = Number(decoded.offset);
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error("invalid offset");
    }
    return offset;
  } catch {
    throw new AppError("Cursor de paginação inválido.", StatusCodes.BAD_REQUEST);
  }
}

function encodeChatMessageCursor(input: { createdAt: Date; id: string }) {
  const payload: ChatMessageCursorPayload = {
    createdAt: input.createdAt.toISOString(),
    id: input.id
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeChatMessageCursor(cursor?: string | null) {
  if (!cursor) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as ChatMessageCursorPayload;
    const createdAt = new Date(decoded.createdAt);
    if (!decoded.id || Number.isNaN(createdAt.getTime())) {
      throw new Error("invalid cursor");
    }
    return {
      createdAt,
      id: decoded.id
    };
  } catch {
    throw new AppError("Cursor de mensagens inválido.", StatusCodes.BAD_REQUEST);
  }
}

export class AdminService {
  private emailService = new EmailService();
  private notificationService = new NotificationService();
  private dataRetentionService = new DataRetentionService();

  private async ensureAdminAccess(adminUserId: string) {
    const admin = await prisma.user.findUnique({
      where: { id: adminUserId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true
      }
    });

    if (!admin || !isAdminEmail(admin.email)) {
      throw new AppError("Acesso negado.", StatusCodes.FORBIDDEN);
    }

    return admin;
  }

  private parseLegalHoldUserIds() {
    return env.DATA_RETENTION_LEGAL_HOLD_USER_IDS.split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  private buildChatAuditSessionSummary(input: {
    booking: {
      id: string;
      scheduledAt: Date;
      sessionLocation: string | null;
      priceCents: number;
      currency: string;
      category: { name: string } | null;
      client: { id: string; name: string; email: string };
      provider: {
        id: string;
        displayName: string;
        user: { id: string; name: string; email: string };
      };
    };
    chatStartedAt: Date;
    chatLastMessageAt: Date;
    messageCount: number;
  }): ChatAuditSessionSummary {
    const providerName = input.booking.provider.displayName || input.booking.provider.user.name;
    return {
      bookingId: input.booking.id,
      chatStartedAt: input.chatStartedAt.toISOString(),
      chatLastMessageAt: input.chatLastMessageAt.toISOString(),
      messageCount: input.messageCount,
      bookingScheduledAt: input.booking.scheduledAt.toISOString(),
      sessionLocation: input.booking.sessionLocation ?? null,
      priceCents: input.booking.priceCents,
      currency: input.booking.currency,
      serviceType: input.booking.category?.name ?? "Servico presencial",
      client: {
        id: input.booking.client.id,
        name: input.booking.client.name,
        email: input.booking.client.email
      },
      provider: {
        profileId: input.booking.provider.id,
        userId: input.booking.provider.user.id,
        name: providerName,
        email: input.booking.provider.user.email
      }
    };
  }

  async getDashboardOverview(input: DashboardInput) {
    const now = new Date();
    const month = input.month ?? now.getMonth() + 1;
    const year = input.year ?? now.getFullYear();
    const { start, end } = monthBounds(month, year);
    const daysInMonth = new Date(year, month, 0).getDate();

    const [providerCount, clientCount, totalUsers, activeUsersRows, usersCreatedInMonth, bookingCounts] =
      await Promise.all([
        prisma.providerProfile.count(),
        prisma.user.count({
          where: { role: UserRole.CLIENT }
        }),
        prisma.user.count(),
        prisma.session.findMany({
          where: {
            revokedAt: null,
            expiresAt: { gt: now }
          },
          distinct: ["userId"],
          select: { userId: true },
          take: 100000,
        }),
        prisma.user.findMany({
          where: { createdAt: { gte: start, lt: end } },
          select: { createdAt: true },
          take: 10000,
        }),
        prisma.booking.groupBy({
          by: ["providerId"],
          where: { scheduledAt: { gte: start, lt: end } },
          _count: { _all: true },
          orderBy: { _count: { providerId: "desc" } },
          take: 5000,
        })
      ]);

    const providerIds = bookingCounts.map((entry) => entry.providerId);
    const providers = providerIds.length
      ? await prisma.providerProfile.findMany({
          where: { id: { in: providerIds } },
          select: {
            id: true,
            fixedLocations: true
          },
          take: 2000,
        })
      : [];
    const providersById = new Map(providers.map((provider) => [provider.id, provider]));

    const regionMap = new Map<string, number>();
    const cityMap = new Map<string, number>();
    const neighborhoodMap = new Map<string, number>();

    bookingCounts.forEach((entry) => {
      const provider = providersById.get(entry.providerId);
      if (!provider) {
        return;
      }

      const tags = normalizeLocation(provider);
      const increment = entry._count._all;

      regionMap.set(tags.region, (regionMap.get(tags.region) ?? 0) + increment);
      cityMap.set(tags.city, (cityMap.get(tags.city) ?? 0) + increment);
      neighborhoodMap.set(tags.neighborhood, (neighborhoodMap.get(tags.neighborhood) ?? 0) + increment);
    });

    const perDay = Array.from({ length: daysInMonth }, (_value, index) => ({
      day: index + 1,
      date: `${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`,
      usersCount: 0
    }));

    usersCreatedInMonth.forEach((item) => {
      const day = item.createdAt.getDate();
      if (day >= 1 && day <= daysInMonth) {
        perDay[day - 1]!.usersCount += 1;
      }
    });

    return {
      summary: {
        activeUsers: activeUsersRows.length,
        totalUsers,
        totalProviders: providerCount,
        totalClients: clientCount
      },
      rankings: {
        byRegion: toRanking(regionMap),
        byCity: toRanking(cityMap),
        byNeighborhood: toRanking(neighborhoodMap)
      },
      newUsersChart: {
        month,
        year,
        total: usersCreatedInMonth.length,
        data: perDay
      }
    };
  }

  async listSupportTickets(input: SupportQueueInput) {
    const status =
      input.status === "ANSWERED"
        ? SupportTicketStatus.ANSWERED
        : SupportTicketStatus.OPEN;

    const take = Math.min(Math.max(input.take ?? 100, 1), 200);
    return prisma.supportTicket.findMany({
      where: {
        status
      },
      orderBy: {
        createdAt: "desc"
      },
      take,
      select: {
        id: true,
        subject: true,
        message: true,
        status: true,
        adminResponse: true,
        respondedAt: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        },
        respondedBy: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });
  }

  async listDataRetentionRuns(adminUserId: string, input: DataRetentionRunsInput) {
    await this.ensureAdminAccess(adminUserId);

    const take = Math.min(Math.max(input.take ?? 30, 1), 100);

    const rows = await prisma.dataRetentionExecutionLog.findMany({
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        dryRun: true,
        status: true,
        triggeredBy: true,
        startedAt: true,
        finishedAt: true,
        durationMs: true,
        errorMessage: true,
        summary: true,
        createdAt: true
      }
    });

    return rows.map((row) => ({
      ...row,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString()
    }));
  }

  async runDataRetention(adminUserId: string, input: RunDataRetentionInput) {
    const admin = await this.ensureAdminAccess(adminUserId);

    const dryRun = input.dryRun ?? env.DATA_RETENTION_DRY_RUN;
    const triggeredBy =
      input.triggeredBy?.trim() ||
      `ADMIN_MANUAL:${admin.email.toLowerCase()}`;

    // input.legalHoldUserIds tem precedência sobre a env var
    const legalHoldUserIds = (input.legalHoldUserIds?.length ?? 0) > 0
      ? input.legalHoldUserIds!
      : this.parseLegalHoldUserIds();

    const result = await this.dataRetentionService.run({
      dryRun,
      triggeredBy,
      legalHoldUserIds,
    });

    return result;
  }

  async listChatAuditSessions(
    adminUserId: string,
    input: ChatAuditSessionsInput
  ): Promise<ChatAuditSessionsOutput> {
    const admin = await this.ensureAdminAccess(adminUserId);
    const clientEmail = input.clientEmail?.trim().toLowerCase() || undefined;
    const providerEmail = input.providerEmail?.trim().toLowerCase() || undefined;
    const startedFrom = parseDateInput(input.startedFrom, "start");
    const startedTo = parseDateInput(input.startedTo, "end");
    const take = Math.min(Math.max(input.take ?? 20, 1), 50);
    const offset = decodeOffsetCursor(input.cursor);

    if (input.startedFrom && !startedFrom) {
      throw new AppError("Data inicial inválida. Use AAAA-MM-DD ou data ISO.", StatusCodes.BAD_REQUEST);
    }
    if (input.startedTo && !startedTo) {
      throw new AppError("Data final inválida. Use AAAA-MM-DD ou data ISO.", StatusCodes.BAD_REQUEST);
    }
    if (startedFrom && startedTo && startedFrom > startedTo) {
      throw new AppError("A data inicial precisa ser menor ou igual à data final.", StatusCodes.BAD_REQUEST);
    }
    if (!clientEmail && !providerEmail && !startedFrom && !startedTo) {
      throw new AppError(
        "Informe ao menos um filtro para buscar conversas (e-mail de cliente, e-mail de prestador ou data).",
        StatusCodes.BAD_REQUEST
      );
    }

    const [client, providerUser] = await Promise.all([
      clientEmail
        ? prisma.user.findFirst({
            where: { email: { equals: clientEmail, mode: "insensitive" } },
            select: { id: true }
          })
        : Promise.resolve(null),
      providerEmail
        ? prisma.user.findFirst({
            where: { email: { equals: providerEmail, mode: "insensitive" } },
            select: { id: true }
          })
        : Promise.resolve(null)
    ]);

    if (clientEmail && !client) {
      return { items: [], nextCursor: null };
    }
    if (providerEmail && !providerUser) {
      return { items: [], nextCursor: null };
    }

    let providerProfileId: string | null = null;
    if (providerUser?.id) {
      const provider = await prisma.providerProfile.findFirst({
        where: { userId: providerUser.id },
        select: { id: true }
      });
      if (!provider) {
        return { items: [], nextCursor: null };
      }
      providerProfileId = provider.id;
    }

    const bookingFilter: Prisma.BookingWhereInput = {};
    if (client?.id) {
      bookingFilter.clientId = client.id;
    }
    if (providerProfileId) {
      bookingFilter.providerId = providerProfileId;
    }

    const messageWhere: Prisma.BookingMessageWhereInput = {};
    if (Object.keys(bookingFilter).length > 0) {
      messageWhere.booking = bookingFilter;
    }

    const hasDateRangeFilter = Boolean(startedFrom || startedTo);
    const dateHaving = hasDateRangeFilter
      ? {
          createdAt: {
            _min: {
              ...(startedFrom ? { gte: startedFrom } : {}),
              ...(startedTo ? { lte: startedTo } : {})
            }
          }
        }
      : undefined;

    const grouped = await prisma.bookingMessage.groupBy({
      by: ["bookingId"],
      where: messageWhere,
      ...(dateHaving ? { having: dateHaving } : {}),
      _min: { createdAt: true },
      _max: { createdAt: true },
      _count: { _all: true },
      orderBy: [{ _min: { createdAt: "desc" } }, { bookingId: "desc" }],
      skip: offset,
      take: take + 1
    });

    const hasMore = grouped.length > take;
    const pageRows = hasMore ? grouped.slice(0, take) : grouped;
    const bookingIds = pageRows.map((row) => row.bookingId);

    const bookings = bookingIds.length
      ? await prisma.booking.findMany({
          where: { id: { in: bookingIds } },
          select: {
            id: true,
            scheduledAt: true,
            sessionLocation: true,
            priceCents: true,
            currency: true,
            category: { select: { name: true } },
            client: {
              select: {
                id: true,
                name: true,
                email: true
              }
            },
            provider: {
              select: {
                id: true,
                displayName: true,
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true
                  }
                }
              }
            }
          }
        })
      : [];

    const bookingsById = new Map(bookings.map((booking) => [booking.id, booking]));
    const items: ChatAuditSessionSummary[] = [];

    for (const row of pageRows) {
      const booking = bookingsById.get(row.bookingId);
      const chatStartedAt = row._min.createdAt;
      const chatLastMessageAt = row._max.createdAt;
      if (!booking || !chatStartedAt || !chatLastMessageAt) {
        continue;
      }
      items.push(
        this.buildChatAuditSessionSummary({
          booking,
          chatStartedAt,
          chatLastMessageAt,
          messageCount: row._count._all
        })
      );
    }

    const nextCursor = hasMore ? encodeOffsetCursor(offset + take) : null;

    console.info(
      `[ADMIN_CHAT_AUDIT_LIST] adminId=${admin.id} clientEmail=${clientEmail ?? "-"} providerEmail=${
        providerEmail ?? "-"
      } startedFrom=${startedFrom?.toISOString() ?? "-"} startedTo=${startedTo?.toISOString() ?? "-"} offset=${offset} take=${take} returned=${items.length}`
    );

    return {
      items,
      nextCursor
    };
  }

  async getChatAuditSessionMessages(
    adminUserId: string,
    input: ChatAuditSessionMessagesInput
  ): Promise<ChatAuditSessionMessagesOutput> {
    const admin = await this.ensureAdminAccess(adminUserId);
    const take = Math.min(Math.max(input.take ?? 100, 1), 200);
    const messageCursor = decodeChatMessageCursor(input.cursor);

    const booking = await prisma.booking.findUnique({
      where: { id: input.bookingId },
      select: {
        id: true,
        scheduledAt: true,
        sessionLocation: true,
        priceCents: true,
        currency: true,
        category: { select: { name: true } },
        client: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        provider: {
          select: {
            id: true,
            displayName: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          }
        }
      }
    });

    if (!booking) {
      throw new AppError("Agendamento não encontrado para auditoria.", StatusCodes.NOT_FOUND);
    }

    const metrics = await prisma.bookingMessage.aggregate({
      where: { bookingId: input.bookingId },
      _min: { createdAt: true },
      _max: { createdAt: true },
      _count: { _all: true }
    });

    if (!metrics._min.createdAt || !metrics._max.createdAt || metrics._count._all === 0) {
      throw new AppError("Nenhuma conversa encontrada para este agendamento.", StatusCodes.NOT_FOUND);
    }

    const where: Prisma.BookingMessageWhereInput = {
      bookingId: input.bookingId
    };

    if (messageCursor) {
      where.OR = [
        { createdAt: { lt: messageCursor.createdAt } },
        { createdAt: messageCursor.createdAt, id: { lt: messageCursor.id } }
      ];
    }

    const rows = await prisma.bookingMessage.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      select: {
        id: true,
        senderId: true,
        isSystem: true,
        content: true,
        readAt: true,
        createdAt: true,
        sender: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    const hasMore = rows.length > take;
    const pageRows = hasMore ? rows.slice(0, take) : rows;
    const nextCursor = hasMore
      ? encodeChatMessageCursor({
          createdAt: pageRows[pageRows.length - 1]!.createdAt,
          id: pageRows[pageRows.length - 1]!.id
        })
      : null;

    const messages: ChatAuditSessionMessage[] = [...pageRows]
      .reverse()
      .map((message) => ({
        id: message.id,
        senderId: message.senderId ?? null,
        senderName: message.sender?.name ?? null,
        senderEmail: message.sender?.email ?? null,
        isSystem: message.isSystem,
        content: message.content,
        readAt: message.readAt?.toISOString() ?? null,
        createdAt: message.createdAt.toISOString()
      }));

    console.info(
      `[ADMIN_CHAT_AUDIT_VIEW] adminId=${admin.id} bookingId=${input.bookingId} take=${take} cursor=${
        input.cursor ? "present" : "none"
      } returned=${messages.length}`
    );

    return {
      session: this.buildChatAuditSessionSummary({
        booking,
        chatStartedAt: metrics._min.createdAt,
        chatLastMessageAt: metrics._max.createdAt,
        messageCount: metrics._count._all
      }),
      messages,
      nextCursor
    };
  }

  async replySupportTicket(adminUserId: string, ticketId: string, input: SupportReplyInput) {
    const admin = await this.ensureAdminAccess(adminUserId);

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        userId: true,
        subject: true,
        message: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (!ticket) {
      throw new AppError("Chamado de suporte nao encontrado.", StatusCodes.NOT_FOUND);
    }

    const responseMessage = input.responseMessage.trim();
    const respondedAt = new Date();
    const updated = await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: {
        status: SupportTicketStatus.ANSWERED,
        adminResponse: responseMessage,
        respondedAt,
        respondedByUserId: admin.id
      },
      select: {
        id: true,
        subject: true,
        message: true,
        status: true,
        adminResponse: true,
        respondedAt: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        },
        respondedBy: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    void this.notificationService
      .sendToUsers([ticket.userId], {
        preferenceType: "SYSTEM",
        title: "Resposta do suporte",
        body: responseMessage,
        data: {
          type: "SUPPORT_REPLY",
          ticketId: ticket.id
        }
      })
      .catch((error) => {
        console.error("Falha ao enviar notificacao de resposta de suporte:", error);
      });

    if (this.emailService.canSendEmail()) {
      void this.emailService
        .sendSupportReplyEmail({
          to: ticket.user.email,
          userName: ticket.user.name,
          subject: ticket.subject,
          responseMessage
        })
        .catch((error) => {
          console.error("Falha ao enviar e-mail de resposta de suporte:", error);
        });
    }

    console.info(
      `[SUPPORT_AUDIT] ticketResponded ticketId=${ticket.id} adminId=${admin.id} at=${respondedAt.toISOString()}`
    );

    return updated;
  }

  // ─── Lookup por CPF ───────────────────────────────────────────────────────

  private normalizeDocument(doc: string) {
    return doc.replace(/\D/g, "");
  }

  private maskDocument(doc: string | null | undefined): string {
    if (!doc) return "***";
    const d = doc.replace(/\D/g, "");
    return d.length >= 4 ? `***.***.***-${d.slice(-2)}` : "***";
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private userByDoc(doc: string, extraSelect: Record<string, unknown> = {}) {
    return (prisma.user.findFirst as any)({
      where: { document: doc },
      select: { id: true, name: true, email: true, document: true, ...extraSelect }
    }) as Promise<any>;
  }

  async lookupCrefByDocument(adminId: string, providerDocument: string) {
    const doc = this.normalizeDocument(providerDocument);
    console.info(`[ADMIN_LOOKUP] adminId=${adminId} action=lookupCref document=${doc}`);
    const user = await this.userByDoc(doc, {
      providerProfile: {
        select: {
          id: true,
          crefNumber: true,
          crefDocumentUrl: true,
          credentialDocuments: true,
          crefValidationStatus: true,
          crefValidatedAt: true,
          crefRejectionReason: true,
          crefReviewedAt: true
        }
      }
    });

    if (!user || !user.providerProfile) return null;
    return {
      user: { id: user.id, name: user.name, email: user.email, documentMasked: this.maskDocument(user.document) },
      cref: user.providerProfile
    };
  }

  async lookupChatsByDocuments(
    adminId: string,
    providerDocument: string,
    clientDocument: string
  ) {
    const provDoc = this.normalizeDocument(providerDocument);
    const cliDoc = this.normalizeDocument(clientDocument);
    console.info(`[ADMIN_LOOKUP] adminId=${adminId} action=lookupChats provDoc=${provDoc} cliDoc=${cliDoc}`);

    const [provider, client] = await Promise.all([
      this.userByDoc(provDoc, { providerProfile: { select: { id: true } } }),
      this.userByDoc(cliDoc)
    ]);

    if (!provider?.providerProfile || !client) return { provider: null, client: null, items: [] };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bookings = await (prisma.booking.findMany as any)({
      where: {
        clientId: client.id,
        providerId: provider.providerProfile.id,
        messages: { some: {} }
      },
      select: {
        id: true,
        scheduledAt: true,
        sessionLocation: true,
        messages: { orderBy: { createdAt: "asc" }, take: 1, select: { createdAt: true } },
        _count: { select: { messages: true } }
      },
      orderBy: { scheduledAt: "desc" },
      take: 100,
    }) as Array<any>;

    return {
      provider: { id: provider.id, name: provider.name, email: provider.email, documentMasked: this.maskDocument(provider.document) },
      client: { id: client.id, name: client.name, email: client.email, documentMasked: this.maskDocument(client.document) },
      items: bookings.map((b: any) => ({
        bookingId: b.id,
        scheduledAt: b.scheduledAt.toISOString(),
        sessionLocation: b.sessionLocation,
        chatStartedAt: b.messages[0]?.createdAt.toISOString() ?? b.scheduledAt.toISOString(),
        messageCount: b._count.messages
      }))
    };
  }

  async lookupBookingsByDocuments(
    adminId: string,
    providerDocument: string,
    clientDocument: string,
    date?: string
  ) {
    const provDoc = this.normalizeDocument(providerDocument);
    const cliDoc = this.normalizeDocument(clientDocument);
    console.info(`[ADMIN_LOOKUP] adminId=${adminId} action=lookupBookings provDoc=${provDoc} cliDoc=${cliDoc} date=${date ?? "all"}`);

    const [provider, client] = await Promise.all([
      this.userByDoc(provDoc, { providerProfile: { select: { id: true } } }),
      this.userByDoc(cliDoc)
    ]);

    if (!provider?.providerProfile || !client) {
      return { provider: null, client: null, items: [] };
    }

    const dateFilter: Prisma.BookingWhereInput = {};
    if (date) {
      const start = new Date(`${date}T00:00:00.000Z`);
      const end = new Date(`${date}T23:59:59.999Z`);
      dateFilter.scheduledAt = { gte: start, lte: end };
    }

    const bookings = await prisma.booking.findMany({
      where: { clientId: client.id, providerId: provider.providerProfile.id, ...dateFilter },
      select: {
        id: true,
        scheduledAt: true,
        sessionLocation: true,
        status: true,
        priceCents: true,
        currency: true,
        payment: { select: { method: true, status: true, amountCents: true } }
      },
      orderBy: { scheduledAt: "desc" },
      take: 500,
    });

    return {
      provider: { id: provider.id, name: provider.name, documentMasked: this.maskDocument(provider.document) },
      client: { id: client.id, name: client.name, documentMasked: this.maskDocument(client.document) },
      items: bookings.map((b) => ({
        bookingId: b.id,
        scheduledAt: b.scheduledAt.toISOString(),
        sessionLocation: b.sessionLocation,
        status: b.status,
        priceCents: b.priceCents,
        currency: b.currency,
        paymentMethod: b.payment?.method ?? null,
        paymentStatus: b.payment?.status ?? null
      }))
    };
  }

  async lookupBookingDetail(adminId: string, bookingId: string) {
    console.info(`[ADMIN_LOOKUP] adminId=${adminId} action=lookupBookingDetail bookingId=${bookingId}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const booking = await (prisma.booking.findUnique as any)({
      where: { id: bookingId },
      select: {
        id: true,
        scheduledAt: true,
        sessionLocation: true,
        notes: true,
        status: true,
        priceCents: true,
        currency: true,
        attendanceCodeValidatedAt: true,
        clientConfirmedAt: true,
        providerConfirmedAt: true,
        completedAt: true,
        createdAt: true,
        client: {
          select: { id: true, name: true, email: true, document: true }
        },
        provider: {
          select: {
            id: true,
            displayName: true,
            crefNumber: true,
            user: { select: { id: true, email: true, document: true } }
          }
        },
        category: { select: { name: true } },
        payment: {
          select: {
            method: true,
            status: true,
            amountCents: true,
            currency: true,
            authorizedAt: true,
            capturedAt: true,
            canceledAt: true,
            refundedAt: true,
            failureReason: true
          }
        }
      }
    });

    if (!booking) throw new AppError("Agendamento não encontrado.", StatusCodes.NOT_FOUND);
    return booking;
  }
}
