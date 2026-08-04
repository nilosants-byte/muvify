import { DevicePlatform, NotificationPreferenceType } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";

const EXPO_PUSH_CHUNK_SIZE = 100;
const EXPO_PUSH_TOKEN_REGEX = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/;
const MAX_RETRY_ATTEMPTS = 5;
// Delay before each retry attempt (seconds): 30s → 5min → 30min → 2h → 12h
const RETRY_DELAY_SECONDS = [30, 300, 1800, 7200, 43200];

type ExpoMessage = {
  to: string;
  sound: string;
  priority: string;
  title: string;
  body: string;
  data?: Record<string, string>;
};

type PushDataValue = string | number | boolean;

export type RegisterPushDeviceInput = {
  token: string;
  platform?: string;
  appVersion?: string;
  deviceName?: string;
};

export type SendPushInput = {
  title: string;
  body: string;
  data?: Record<string, PushDataValue>;
  preferenceType?: NotificationPreferenceType;
};

export type SendPushSummary = {
  attempted: number;
  delivered: number;
  deactivated: number;
  disabled: boolean;
};

type ExpoPushTicket = {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
};

function normalizePushToken(token: string) {
  return token.trim();
}

function ensurePushToken(token: string) {
  const normalized = normalizePushToken(token);
  if (!EXPO_PUSH_TOKEN_REGEX.test(normalized)) {
    throw new AppError("Push token inválido.", StatusCodes.BAD_REQUEST);
  }
  return normalized;
}

function toPlatform(platform?: string): DevicePlatform {
  const normalized = platform?.trim().toLowerCase();
  if (normalized === "ios") {
    return DevicePlatform.IOS;
  }
  if (normalized === "android") {
    return DevicePlatform.ANDROID;
  }
  if (normalized === "web") {
    return DevicePlatform.WEB;
  }
  return DevicePlatform.UNKNOWN;
}

function asStringData(data?: Record<string, PushDataValue>) {
  if (!data) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, String(value)])
  );
}

function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export class NotificationService {
  // Épico de Frentes, Frente 9, Lote 19: lista sem paginação real (take
  // fixo, sem skip) - usuário com histórico extenso nunca via nada além
  // dos itens mais recentes até o limite. skip habilita "carregar mais".
  async listInbox(userId: string, take = 100, skip = 0) {
    return prisma.userNotification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(take, 1), 200),
      skip: Math.max(skip, 0),
      select: {
        id: true,
        title: true,
        body: true,
        data: true,
        readAt: true,
        createdAt: true
      }
    });
  }

  async markAllAsRead(userId: string) {
    await prisma.userNotification.updateMany({
      where: {
        userId,
        readAt: null
      },
      data: {
        readAt: new Date()
      }
    });
  }

  // Épico de Frentes, Frente 9, Lote 2: a tela de notificações calculava o
  // contador via readAt do banco, mas marcar UMA como lida nunca chamava
  // nenhuma API (só cache local) - não existia esse endpoint até agora. O
  // drawer do sino, por sua vez, nem olhava o banco (AsyncStorage local).
  // As duas UIs precisam da mesma operação real pra convergir numa única
  // fonte de verdade.
  async markAsRead(userId: string, notificationId: string) {
    await prisma.userNotification.updateMany({
      where: {
        id: notificationId,
        userId,
        readAt: null
      },
      data: {
        readAt: new Date()
      }
    });
  }

  async unreadCount(userId: string) {
    return prisma.userNotification.count({
      where: {
        userId,
        readAt: null
      }
    });
  }

  async registerDevice(userId: string, input: RegisterPushDeviceInput) {
    const token = ensurePushToken(input.token);
    return prisma.pushDevice.upsert({
      where: { token },
      update: {
        userId,
        platform: toPlatform(input.platform),
        appVersion: input.appVersion?.trim() || null,
        deviceName: input.deviceName?.trim() || null,
        isActive: true,
        invalidAt: null,
        lastSeenAt: new Date()
      },
      create: {
        userId,
        token,
        platform: toPlatform(input.platform),
        appVersion: input.appVersion?.trim() || null,
        deviceName: input.deviceName?.trim() || null,
        isActive: true
      }
    });
  }

  async unregisterDevice(userId: string, token: string) {
    const normalized = ensurePushToken(token);
    await prisma.pushDevice.updateMany({
      where: {
        userId,
        token: normalized
      },
      data: {
        isActive: false,
        invalidAt: new Date()
      }
    });
  }

  async listDevices(userId: string) {
    return prisma.pushDevice.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        token: true,
        platform: true,
        appVersion: true,
        deviceName: true,
        isActive: true,
        invalidAt: true,
        lastSeenAt: true,
        createdAt: true,
        updatedAt: true
      }
    });
  }

  async sendToUsers(userIds: string[], input: SendPushInput): Promise<SendPushSummary> {
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
    if (uniqueUserIds.length === 0) {
      return { attempted: 0, delivered: 0, deactivated: 0, disabled: false };
    }
    const MAX_BROADCAST = 10_000;
    if (uniqueUserIds.length > MAX_BROADCAST) {
      throw new AppError(
        `Broadcast para ${uniqueUserIds.length} usuários excede o limite de ${MAX_BROADCAST}.`,
        StatusCodes.UNPROCESSABLE_ENTITY
      );
    }

    let targetUserIds = uniqueUserIds;
    if (input.preferenceType) {
      const savedPreferences = await prisma.notificationPreference.findMany({
        where: {
          userId: { in: uniqueUserIds },
          type: input.preferenceType
        },
        select: {
          userId: true,
          enabled: true
        }
      });
      const disabledUserIds = new Set(
        savedPreferences.filter((item) => !item.enabled).map((item) => item.userId)
      );
      targetUserIds = uniqueUserIds.filter((userId) => !disabledUserIds.has(userId));
      if (targetUserIds.length === 0) {
        return { attempted: 0, delivered: 0, deactivated: 0, disabled: false };
      }
    }

    const DB_CHUNK_SIZE = 500;
    for (let i = 0; i < targetUserIds.length; i += DB_CHUNK_SIZE) {
      const chunk = targetUserIds.slice(i, i + DB_CHUNK_SIZE);
      await prisma.userNotification.createMany({
        data: chunk.map((userId) => ({
          userId,
          title: input.title,
          body: input.body,
          data: input.data ?? undefined
        }))
      });
    }

    if (!env.PUSH_NOTIFICATIONS_ENABLED || env.NODE_ENV === "test") {
      return { attempted: 0, delivered: 0, deactivated: 0, disabled: true };
    }

    const devices = await prisma.pushDevice.findMany({
      where: {
        userId: { in: targetUserIds },
        isActive: true
      },
      select: {
        token: true
      }
    });

    if (!devices.length) {
      return { attempted: 0, delivered: 0, deactivated: 0, disabled: false };
    }

    const messages = devices.map((device) => ({
      to: device.token,
      sound: "default",
      priority: "high",
      title: input.title,
      body: input.body,
      data: asStringData(input.data)
    }));

    let delivered = 0;
    const invalidTokens = new Set<string>();
    const messageChunks = chunk(messages, EXPO_PUSH_CHUNK_SIZE);

    for (const currentChunk of messageChunks) {
      const result = await this.deliverChunk(currentChunk);
      if (result.failed) {
        // Enqueue for retry — will be processed by the notification retry job
        await prisma.pushNotificationQueue.create({
          data: {
            messages: currentChunk,
            lastError: result.lastError
          }
        }).catch((enqueueError) => {
          console.error("Failed to enqueue notification for retry:", enqueueError);
        });
      } else {
        delivered += result.delivered;
        for (const token of result.invalidTokens) {
          invalidTokens.add(token);
        }
        // Épico de Frentes, Frente 9, Lote 18: mensagens com erro individual
        // de rate-limit do Expo (MessageRateExceeded) eram só logadas e
        // descartadas - iam pra fila de retry só quando o chunk inteiro
        // falhava (erro de rede/HTTP), nunca quando o Expo aceitava a
        // requisição mas rejeitava mensagens específicas por excesso de taxa.
        if (result.rateLimitedMessages.length > 0) {
          await prisma.pushNotificationQueue.create({
            data: {
              messages: result.rateLimitedMessages,
              lastError: "MessageRateExceeded"
            }
          }).catch((enqueueError) => {
            console.error("Failed to enqueue rate-limited notifications for retry:", enqueueError);
          });
        }
      }
    }

    if (invalidTokens.size > 0) {
      await prisma.pushDevice.updateMany({
        where: {
          token: { in: [...invalidTokens] }
        },
        data: {
          isActive: false,
          invalidAt: new Date()
        }
      });
    }

    return {
      attempted: messages.length,
      delivered,
      deactivated: invalidTokens.size,
      disabled: false
    };
  }

  private async deliverChunk(messages: ExpoMessage[]): Promise<{
    delivered: number;
    invalidTokens: string[];
    rateLimitedMessages: ExpoMessage[];
    failed: boolean;
    lastError?: string;
  }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    let response: Response;
    try {
      response = await fetch(env.EXPO_PUSH_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(env.EXPO_PUSH_ACCESS_TOKEN
            ? { Authorization: `Bearer ${env.EXPO_PUSH_ACCESS_TOKEN}` }
            : {})
        },
        body: JSON.stringify(messages),
        signal: controller.signal
      });
    } catch (error) {
      const lastError = error instanceof Error ? error.message : String(error);
      console.error("Expo push delivery failed:", lastError);
      return { delivered: 0, invalidTokens: [], rateLimitedMessages: [], failed: true, lastError };
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const body = await response.text();
      const lastError = `HTTP ${response.status}: ${body.slice(0, 200)}`;
      console.error("Expo push request failed:", lastError);
      return { delivered: 0, invalidTokens: [], rateLimitedMessages: [], failed: true, lastError };
    }

    const payload = (await response.json()) as { data?: ExpoPushTicket[] };
    const tickets = Array.isArray(payload.data) ? payload.data : [];
    let delivered = 0;
    const invalidTokens: string[] = [];
    const rateLimitedMessages: ExpoMessage[] = [];

    for (let index = 0; index < tickets.length; index += 1) {
      const ticket = tickets[index];
      if (ticket.status === "ok") {
        delivered += 1;
        continue;
      }
      const token = messages[index]?.to;
      if (ticket.details?.error === "DeviceNotRegistered" && token) {
        invalidTokens.push(token);
      } else if (ticket.details?.error === "MessageRateExceeded") {
        const message = messages[index];
        if (message) {
          rateLimitedMessages.push(message);
        }
      }
      console.error("Expo push ticket error:", {
        message: ticket.message,
        error: ticket.details?.error,
        token
      });
    }

    return { delivered, invalidTokens, rateLimitedMessages, failed: false };
  }

  // Épico de Frentes, Frente 9, Lote 18: PushDevice desativado (token
  // inválido, ex: DeviceNotRegistered) nunca era removido - ficava pra
  // sempre na tabela, só sem receber push. Expurga o que está inativo há
  // muito tempo, mesmo espírito do purgeOldFailures da fila de e-mail.
  async purgeStaleDevices(referenceDate = new Date(), olderThanDays = 90): Promise<number> {
    const cutoff = new Date(referenceDate.getTime() - olderThanDays * 24 * 60 * 60 * 1000);
    const { count } = await prisma.pushDevice.deleteMany({
      where: {
        isActive: false,
        invalidAt: { lt: cutoff }
      }
    });
    return count;
  }

  async processRetryQueue(): Promise<void> {
    const now = new Date();
    const pending = await prisma.pushNotificationQueue.findMany({
      where: {
        failedAt: null,
        attempts: { lt: MAX_RETRY_ATTEMPTS },
        nextRetryAt: { lte: now }
      },
      take: 50,
      orderBy: { nextRetryAt: "asc" }
    });

    if (pending.length === 0) return;

    const CONCURRENCY = 5;
    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      await Promise.allSettled(
        pending.slice(i, i + CONCURRENCY).map(async (entry) => {
          const messages = entry.messages as ExpoMessage[];
          const result = await this.deliverChunk(messages);

          if (result.failed) {
            const newAttempts = entry.attempts + 1;
            const delaySeconds = RETRY_DELAY_SECONDS[newAttempts] ?? RETRY_DELAY_SECONDS[RETRY_DELAY_SECONDS.length - 1]!;
            const nextRetryAt = new Date(now.getTime() + delaySeconds * 1000);
            await prisma.pushNotificationQueue.update({
              where: { id: entry.id },
              data: { attempts: newAttempts, nextRetryAt, lastError: result.lastError, failedAt: newAttempts >= MAX_RETRY_ATTEMPTS ? now : null }
            });
          } else {
            if (result.invalidTokens.length > 0) {
              await prisma.pushDevice.updateMany({
                where: { token: { in: result.invalidTokens } },
                data: { isActive: false, invalidAt: now }
              }).catch((error) => console.error("Failed to deactivate invalid tokens during retry:", error));
            }
            if (result.rateLimitedMessages.length > 0) {
              // Ainda tem mensagens rejeitadas por rate-limit — mantém só
              // essas na fila (não a entrada inteira) e agenda novo retry.
              const newAttempts = entry.attempts + 1;
              const delaySeconds = RETRY_DELAY_SECONDS[newAttempts] ?? RETRY_DELAY_SECONDS[RETRY_DELAY_SECONDS.length - 1]!;
              const nextRetryAt = new Date(now.getTime() + delaySeconds * 1000);
              await prisma.pushNotificationQueue.update({
                where: { id: entry.id },
                data: {
                  messages: result.rateLimitedMessages,
                  attempts: newAttempts,
                  nextRetryAt,
                  lastError: "MessageRateExceeded",
                  failedAt: newAttempts >= MAX_RETRY_ATTEMPTS ? now : null
                }
              });
            } else {
              await prisma.pushNotificationQueue.delete({ where: { id: entry.id } });
            }
          }
        })
      );
    }
  }
}
