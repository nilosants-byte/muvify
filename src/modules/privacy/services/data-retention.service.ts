import {
  AnamnesisStatus,
  BookingStatus,
  Prisma
} from "@prisma/client";
import { prisma } from "../../../config/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;

const RETENTION_WINDOWS_DAYS = {
  sessions: 45,
  passwordResetTokens: 30,
  emailVerificationTokens: 30,
  pushDevicesInactive: 180,
  userNotifications: 730,
  pushQueueFailures: 90,
  completionEvidence: 730,
  anamnesis: 730,
  bookingMessages: 730,
  supportTickets: 1825
} as const;

type RetentionRuleMode = "DELETE" | "UPDATE";

type RetentionRuleExecution = {
  ruleId: string;
  description: string;
  mode: RetentionRuleMode;
  retentionDays: number;
  cutoffIso: string;
  matchedCount: number;
  affectedCount: number;
};

type DataRetentionRunInput = {
  dryRun: boolean;
  triggeredBy: string;
  legalHoldUserIds?: string[];
  now?: Date;
};

type DataRetentionRunResult = {
  status: "SUCCESS";
  dryRun: boolean;
  triggeredBy: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totals: {
    matchedCount: number;
    affectedCount: number;
    rules: number;
  };
  rules: RetentionRuleExecution[];
};

export class DataRetentionService {
  private legalHoldUserIds: string[] = [];

  async run(input: DataRetentionRunInput): Promise<DataRetentionRunResult> {
    const now = input.now ?? new Date();
    const startedAt = new Date();
    this.legalHoldUserIds = (input.legalHoldUserIds ?? [])
      .map((value) => value.trim())
      .filter(Boolean);

    const rules: RetentionRuleExecution[] = [];
    try {
      rules.push(await this.cleanupSessions(now, input.dryRun));
      rules.push(await this.cleanupPasswordResetTokens(now, input.dryRun));
      rules.push(await this.cleanupEmailVerificationTokens(now, input.dryRun));
      rules.push(await this.cleanupPushDevices(now, input.dryRun));
      rules.push(await this.cleanupUserNotifications(now, input.dryRun));
      rules.push(await this.cleanupPushQueue(now, input.dryRun));
      rules.push(await this.cleanupCompletionEvidence(now, input.dryRun));
      rules.push(await this.cleanupAnamnesis(now, input.dryRun));
      rules.push(await this.cleanupBookingMessages(now, input.dryRun));
      rules.push(await this.cleanupSupportTickets(now, input.dryRun));

      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();
      const result: DataRetentionRunResult = {
        status: "SUCCESS",
        dryRun: input.dryRun,
        triggeredBy: input.triggeredBy,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs,
        totals: {
          matchedCount: rules.reduce((sum, rule) => sum + rule.matchedCount, 0),
          affectedCount: rules.reduce((sum, rule) => sum + rule.affectedCount, 0),
          rules: rules.length
        },
        rules
      };

      await prisma.dataRetentionExecutionLog.create({
        data: {
          dryRun: input.dryRun,
          status: result.status,
          triggeredBy: input.triggeredBy,
          startedAt,
          finishedAt,
          durationMs,
          summary: result as unknown as Prisma.InputJsonValue
        }
      });

      return result;
    } catch (error) {
      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();
      await prisma.dataRetentionExecutionLog.create({
        data: {
          dryRun: input.dryRun,
          status: "FAILED",
          triggeredBy: input.triggeredBy,
          startedAt,
          finishedAt,
          durationMs,
          summary: {
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            dryRun: input.dryRun,
            triggeredBy: input.triggeredBy,
            partialRules: rules
          } as unknown as Prisma.InputJsonValue,
          errorMessage:
            error instanceof Error ? error.message.slice(0, 1900) : "Unknown retention failure."
        }
      });
      throw error;
    }
  }

  private getUserFilter(fieldName: "userId" | "clientId" | "senderId") {
    if (this.legalHoldUserIds.length === 0) {
      return {};
    }
    return {
      [fieldName]: { notIn: this.legalHoldUserIds }
    } as Record<string, { notIn: string[] }>;
  }

  private buildRule(
    ruleId: string,
    description: string,
    mode: RetentionRuleMode,
    retentionDays: number,
    cutoff: Date,
    matchedCount: number,
    affectedCount: number
  ): RetentionRuleExecution {
    return {
      ruleId,
      description,
      mode,
      retentionDays,
      cutoffIso: cutoff.toISOString(),
      matchedCount,
      affectedCount
    };
  }

  private cutoffFromDays(now: Date, days: number) {
    return new Date(now.getTime() - days * DAY_MS);
  }

  private async cleanupSessions(now: Date, dryRun: boolean) {
    const retentionDays = RETENTION_WINDOWS_DAYS.sessions;
    const cutoff = this.cutoffFromDays(now, retentionDays);
    const where: Prisma.SessionWhereInput = {
      ...this.getUserFilter("userId"),
      OR: [{ revokedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }]
    };
    const matchedCount = await prisma.session.count({ where });
    const affectedCount = dryRun ? 0 : (await prisma.session.deleteMany({ where })).count;
    return this.buildRule(
      "sessions_expired_or_revoked",
      "Delete auth sessions expired or revoked after retention window.",
      "DELETE",
      retentionDays,
      cutoff,
      matchedCount,
      affectedCount
    );
  }

  private async cleanupPasswordResetTokens(now: Date, dryRun: boolean) {
    const retentionDays = RETENTION_WINDOWS_DAYS.passwordResetTokens;
    const cutoff = this.cutoffFromDays(now, retentionDays);
    const where: Prisma.PasswordResetTokenWhereInput = {
      ...this.getUserFilter("userId"),
      OR: [{ usedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }]
    };
    const matchedCount = await prisma.passwordResetToken.count({ where });
    const affectedCount = dryRun
      ? 0
      : (await prisma.passwordResetToken.deleteMany({ where })).count;
    return this.buildRule(
      "password_reset_tokens_obsolete",
      "Delete password reset tokens already used or expired.",
      "DELETE",
      retentionDays,
      cutoff,
      matchedCount,
      affectedCount
    );
  }

  private async cleanupEmailVerificationTokens(now: Date, dryRun: boolean) {
    const retentionDays = RETENTION_WINDOWS_DAYS.emailVerificationTokens;
    const cutoff = this.cutoffFromDays(now, retentionDays);
    const where: Prisma.EmailVerificationTokenWhereInput = {
      ...this.getUserFilter("userId"),
      OR: [{ usedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }]
    };
    const matchedCount = await prisma.emailVerificationToken.count({ where });
    const affectedCount = dryRun
      ? 0
      : (await prisma.emailVerificationToken.deleteMany({ where })).count;
    return this.buildRule(
      "email_verification_tokens_obsolete",
      "Delete e-mail verification tokens already used or expired.",
      "DELETE",
      retentionDays,
      cutoff,
      matchedCount,
      affectedCount
    );
  }

  private async cleanupPushDevices(now: Date, dryRun: boolean) {
    const retentionDays = RETENTION_WINDOWS_DAYS.pushDevicesInactive;
    const cutoff = this.cutoffFromDays(now, retentionDays);
    const where: Prisma.PushDeviceWhereInput = {
      ...this.getUserFilter("userId"),
      isActive: false,
      OR: [{ invalidAt: { lt: cutoff } }, { updatedAt: { lt: cutoff } }]
    };
    const matchedCount = await prisma.pushDevice.count({ where });
    const affectedCount = dryRun ? 0 : (await prisma.pushDevice.deleteMany({ where })).count;
    return this.buildRule(
      "push_devices_inactive",
      "Delete inactive push device registrations after retention window.",
      "DELETE",
      retentionDays,
      cutoff,
      matchedCount,
      affectedCount
    );
  }

  private async cleanupUserNotifications(now: Date, dryRun: boolean) {
    const retentionDays = RETENTION_WINDOWS_DAYS.userNotifications;
    const cutoff = this.cutoffFromDays(now, retentionDays);
    const where: Prisma.UserNotificationWhereInput = {
      ...this.getUserFilter("userId"),
      createdAt: { lt: cutoff }
    };
    const matchedCount = await prisma.userNotification.count({ where });
    const affectedCount = dryRun
      ? 0
      : (await prisma.userNotification.deleteMany({ where })).count;
    return this.buildRule(
      "user_notifications_old",
      "Delete old in-app notifications.",
      "DELETE",
      retentionDays,
      cutoff,
      matchedCount,
      affectedCount
    );
  }

  private async cleanupPushQueue(now: Date, dryRun: boolean) {
    const retentionDays = RETENTION_WINDOWS_DAYS.pushQueueFailures;
    const cutoff = this.cutoffFromDays(now, retentionDays);
    const where: Prisma.PushNotificationQueueWhereInput = {
      createdAt: { lt: cutoff },
      OR: [{ failedAt: { not: null } }, { attempts: { gte: 10 } }]
    };
    const matchedCount = await prisma.pushNotificationQueue.count({ where });
    const affectedCount = dryRun
      ? 0
      : (await prisma.pushNotificationQueue.deleteMany({ where })).count;
    return this.buildRule(
      "push_queue_failures_old",
      "Delete old failed push queue records.",
      "DELETE",
      retentionDays,
      cutoff,
      matchedCount,
      affectedCount
    );
  }

  private async cleanupCompletionEvidence(now: Date, dryRun: boolean) {
    const retentionDays = RETENTION_WINDOWS_DAYS.completionEvidence;
    const cutoff = this.cutoffFromDays(now, retentionDays);
    const where: Prisma.CompletionEvidenceWhereInput = {
      ...this.getUserFilter("userId"),
      createdAt: { lt: cutoff }
    };
    const matchedCount = await prisma.completionEvidence.count({ where });
    const affectedCount = dryRun
      ? 0
      : (await prisma.completionEvidence.deleteMany({ where })).count;
    return this.buildRule(
      "completion_evidence_old",
      "Delete old completion selfie evidences.",
      "DELETE",
      retentionDays,
      cutoff,
      matchedCount,
      affectedCount
    );
  }

  private async cleanupAnamnesis(now: Date, dryRun: boolean) {
    const retentionDays = RETENTION_WINDOWS_DAYS.anamnesis;
    const cutoff = this.cutoffFromDays(now, retentionDays);
    const where: Prisma.ClientAnamnesisWhereInput = {
      ...this.getUserFilter("clientId"),
      updatedAt: { lt: cutoff },
      answers: { not: Prisma.DbNull }
    };
    const matchedCount = await prisma.clientAnamnesis.count({ where });
    const affectedCount = dryRun
      ? 0
      : (
          await prisma.clientAnamnesis.updateMany({
            where,
            data: {
              answers: Prisma.DbNull,
              status: AnamnesisStatus.DRAFT,
              completedAt: null
            }
          })
        ).count;
    return this.buildRule(
      "anamnesis_redaction",
      "Redact sensitive anamnesis payload after retention window.",
      "UPDATE",
      retentionDays,
      cutoff,
      matchedCount,
      affectedCount
    );
  }

  private async cleanupBookingMessages(now: Date, dryRun: boolean) {
    const retentionDays = RETENTION_WINDOWS_DAYS.bookingMessages;
    const cutoff = this.cutoffFromDays(now, retentionDays);
    const hasLegalHold = this.legalHoldUserIds.length > 0;
    const where: Prisma.BookingMessageWhereInput = {
      createdAt: { lt: cutoff },
      isSystem: false,
      ...(hasLegalHold ? this.getUserFilter("senderId") : {}),
      booking: {
        status: { in: [BookingStatus.CANCELLED, BookingStatus.COMPLETED] },
        updatedAt: { lt: cutoff },
        ...(hasLegalHold
          ? {
              clientId: { notIn: this.legalHoldUserIds },
              provider: { userId: { notIn: this.legalHoldUserIds } }
            }
          : {})
      }
    };
    const matchedCount = await prisma.bookingMessage.count({ where });
    const affectedCount = dryRun
      ? 0
      : (
          await prisma.bookingMessage.updateMany({
            where,
            data: {
              content: "[CONTEUDO REMOVIDO POR RETENCAO]",
              senderId: null
            }
          })
        ).count;
    return this.buildRule(
      "booking_messages_redaction",
      "Redact booking chat messages after retention window.",
      "UPDATE",
      retentionDays,
      cutoff,
      matchedCount,
      affectedCount
    );
  }

  private async cleanupSupportTickets(now: Date, dryRun: boolean) {
    const retentionDays = RETENTION_WINDOWS_DAYS.supportTickets;
    const cutoff = this.cutoffFromDays(now, retentionDays);
    const where: Prisma.SupportTicketWhereInput = {
      ...this.getUserFilter("userId"),
      createdAt: { lt: cutoff },
      OR: [{ message: { not: "" } }, { adminResponse: { not: null } }]
    };
    const matchedCount = await prisma.supportTicket.count({ where });
    const affectedCount = dryRun
      ? 0
      : (
          await prisma.supportTicket.updateMany({
            where,
            data: {
              subject: "Ticket retido por politica de privacidade.",
              message: "Conteudo removido por politica de retencao.",
              adminResponse: "Resposta removida por politica de retencao."
            }
          })
        ).count;
    return this.buildRule(
      "support_tickets_redaction",
      "Redact support messages after retention window.",
      "UPDATE",
      retentionDays,
      cutoff,
      matchedCount,
      affectedCount
    );
  }
}
