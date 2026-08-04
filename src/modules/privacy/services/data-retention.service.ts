import {
  AnamnesisStatus,
  BookingStatus,
  Prisma,
  SupportTicketStatus
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
  supportTickets: 1825,
  bookingNotes: 730,
  consultancyHealthData: 730,
  biometricAssessments: 730,
  emailDeliveryQueue: 90,
  reviewComments: 730,
  disputeNarratives: 730,
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

  // Raio-X de pagamentos, Rodada 4, Lote 9: legal hold persistido por usuário
  // (User.legalHoldUntil) some ao que já vinha da env var — antes só a env
  // var existia, então mudar exigia editar variável de ambiente e
  // redeployar; agora um admin consegue segurar a retenção de um usuário
  // específico direto pelo app, sem depender de deploy.
  async resolveLegalHoldUserIds(extraIds: string[] = [], now = new Date()): Promise<string[]> {
    const held = await prisma.user.findMany({
      where: { legalHoldUntil: { gt: now } },
      select: { id: true }
    });
    return Array.from(new Set([...extraIds, ...held.map((u) => u.id)]));
  }

  async run(input: DataRetentionRunInput): Promise<DataRetentionRunResult> {
    const now = input.now ?? new Date();
    const startedAt = new Date();
    this.legalHoldUserIds = (input.legalHoldUserIds ?? [])
      .map((value) => value.trim())
      .filter(Boolean);

    // Cada rule é isolada — falha de uma não impede as demais
    const safeRun = async (fn: () => Promise<RetentionRuleExecution>): Promise<RetentionRuleExecution | null> => {
      try { return await fn(); }
      catch (err) { console.error("[data-retention] Rule failed:", err); return null; }
    };

    const rules: RetentionRuleExecution[] = [];
    try {
      const results = await Promise.all([
        safeRun(() => this.cleanupSessions(now, input.dryRun)),
        safeRun(() => this.cleanupPasswordResetTokens(now, input.dryRun)),
        safeRun(() => this.cleanupEmailVerificationTokens(now, input.dryRun)),
        safeRun(() => this.cleanupPushDevices(now, input.dryRun)),
        safeRun(() => this.cleanupUserNotifications(now, input.dryRun)),
        safeRun(() => this.cleanupPushQueue(now, input.dryRun)),
        safeRun(() => this.cleanupCompletionEvidence(now, input.dryRun)),
        safeRun(() => this.cleanupAnamnesis(now, input.dryRun)),
        safeRun(() => this.cleanupBookingMessages(now, input.dryRun)),
        safeRun(() => this.cleanupSupportTickets(now, input.dryRun)),
        safeRun(() => this.cleanupBookingNotes(now, input.dryRun)),
        safeRun(() => this.cleanupConsultancyHealthData(now, input.dryRun)),
        safeRun(() => this.cleanupBiometricAssessments(now, input.dryRun)),
        safeRun(() => this.cleanupEmailDeliveryQueue(now, input.dryRun)),
        safeRun(() => this.cleanupReviewComments(now, input.dryRun)),
        safeRun(() => this.cleanupDisputeCaseNarratives(now, input.dryRun)),
        safeRun(() => this.cleanupNoShowReportNarratives(now, input.dryRun)),
      ]);
      rules.push(...(results.filter(Boolean) as RetentionRuleExecution[]));

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

  private async cleanupEmailDeliveryQueue(now: Date, dryRun: boolean) {
    const retentionDays = RETENTION_WINDOWS_DAYS.emailDeliveryQueue;
    const cutoff = this.cutoffFromDays(now, retentionDays);
    const where: Prisma.EmailDeliveryQueueWhereInput = {
      createdAt: { lt: cutoff },
      OR: [{ failedAt: { not: null } }, { attempts: { gte: 10 } }]
    };
    const matchedCount = await prisma.emailDeliveryQueue.count({ where });
    const affectedCount = dryRun
      ? 0
      : (await prisma.emailDeliveryQueue.deleteMany({ where })).count;
    return this.buildRule(
      "email_delivery_queue_cleanup",
      "Delete old failed email delivery queue records.",
      "DELETE",
      retentionDays,
      cutoff,
      matchedCount,
      affectedCount
    );
  }

  private async cleanupReviewComments(now: Date, dryRun: boolean) {
    const retentionDays = RETENTION_WINDOWS_DAYS.reviewComments;
    const cutoff = this.cutoffFromDays(now, retentionDays);
    const where: Prisma.ReviewWhereInput = {
      ...this.getUserFilter("userId"),
      updatedAt: { lt: cutoff },
      comment: { not: null }
    };
    const matchedCount = await prisma.review.count({ where });
    const affectedCount = dryRun
      ? 0
      : (await prisma.review.updateMany({ where, data: { comment: null } })).count;
    return this.buildRule(
      "review_comments_redaction",
      "Redact review comment text after retention window.",
      "UPDATE",
      retentionDays,
      cutoff,
      matchedCount,
      affectedCount
    );
  }

  private async cleanupBookingNotes(now: Date, dryRun: boolean) {
    const retentionDays = RETENTION_WINDOWS_DAYS.bookingNotes;
    const cutoff = this.cutoffFromDays(now, retentionDays);
    const legalHold = this.legalHoldUserIds;
    const where: Prisma.BookingWhereInput = {
      status: { in: [BookingStatus.COMPLETED, BookingStatus.CANCELLED] },
      updatedAt: { lt: cutoff },
      OR: [{ notes: { not: null } }, { sessionLocation: { not: null } }],
      ...(legalHold.length > 0 ? {
        clientId: { notIn: legalHold },
        provider: { userId: { notIn: legalHold } }
      } : {})
    };
    const matchedCount = await prisma.booking.count({ where });
    const affectedCount = dryRun
      ? 0
      : (await prisma.booking.updateMany({ where, data: { notes: null, sessionLocation: null } })).count;
    return this.buildRule(
      "booking_notes_redaction",
      "Redact booking notes and session location after retention window.",
      "UPDATE",
      retentionDays,
      cutoff,
      matchedCount,
      affectedCount
    );
  }

  private async cleanupConsultancyHealthData(now: Date, dryRun: boolean) {
    const retentionDays = RETENTION_WINDOWS_DAYS.consultancyHealthData;
    const cutoff = this.cutoffFromDays(now, retentionDays);
    const where: Prisma.ConsultancyRequestWhereInput = {
      ...this.getUserFilter("clientId"),
      updatedAt: { lt: cutoff },
      OR: [
        { trainingNeedText: { not: null } },
        { limitationText: { not: null } },
        { extraInfoText: { not: null } }
      ]
    };
    const matchedCount = await prisma.consultancyRequest.count({ where });
    const affectedCount = dryRun
      ? 0
      : (await prisma.consultancyRequest.updateMany({
          where,
          data: { trainingNeedText: null, limitationText: null, extraInfoText: null, providerResponseText: null }
        })).count;
    return this.buildRule(
      "consultancy_health_data_redaction",
      "Redact sensitive health data from consultancy requests after retention window.",
      "UPDATE",
      retentionDays,
      cutoff,
      matchedCount,
      affectedCount
    );
  }

  private async cleanupBiometricAssessments(now: Date, dryRun: boolean) {
    const retentionDays = RETENTION_WINDOWS_DAYS.biometricAssessments;
    const cutoff = this.cutoffFromDays(now, retentionDays);
    const where: Prisma.ProviderStudentAssessmentWhereInput = {
      ...this.getUserFilter("clientId"),
      updatedAt: { lt: cutoff }
    };
    const matchedCount = await prisma.providerStudentAssessment.count({ where });
    const affectedCount = dryRun
      ? 0
      : (await prisma.providerStudentAssessment.deleteMany({ where })).count;
    return this.buildRule(
      "biometric_assessments_deletion",
      "Delete biometric physical assessment records after retention window.",
      "DELETE",
      retentionDays,
      cutoff,
      matchedCount,
      affectedCount
    );
  }

  // Épico de Frentes, Frente 10, Lote 5: filtro não checava status - um
  // ticket que ficou OPEN por 5 anos (cenário real dado o backlog sem
  // paginação corrigido no Lote 4) tinha o conteúdo apagado por retenção e
  // ficava irrespondível pra sempre. Mesmo raciocínio já usado em
  // cleanupDisputeCaseNarratives (abaixo): só redige o que já está
  // encerrado, nunca o que ainda está em aberto pro admin decidir.
  private async cleanupSupportTickets(now: Date, dryRun: boolean) {
    const retentionDays = RETENTION_WINDOWS_DAYS.supportTickets;
    const cutoff = this.cutoffFromDays(now, retentionDays);
    const where: Prisma.SupportTicketWhereInput = {
      ...this.getUserFilter("userId"),
      status: SupportTicketStatus.ANSWERED,
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

  // So redige casos JA RESOLVIDOS (nunca um caso OPEN — o admin ainda precisa
  // do texto pra decidir). O registro em si (status, resolucao, valores)
  // continua existindo pra fins de auditoria financeira; so o texto livre
  // (motivo do admin, nota de contexto) e removido.
  private async cleanupDisputeCaseNarratives(now: Date, dryRun: boolean) {
    const retentionDays = RETENTION_WINDOWS_DAYS.disputeNarratives;
    const cutoff = this.cutoffFromDays(now, retentionDays);
    const where: Prisma.DisputeCaseWhereInput = {
      ...this.getUserFilter("clientId"),
      status: "RESOLVED",
      resolvedAt: { lt: cutoff },
      OR: [{ contextNote: { not: null } }, { resolutionNote: { not: null } }]
    };
    const matchedCount = await prisma.disputeCase.count({ where });
    const affectedCount = dryRun
      ? 0
      : (
          await prisma.disputeCase.updateMany({
            where,
            data: { contextNote: null, resolutionNote: "[CONTEUDO REMOVIDO POR RETENCAO]" }
          })
        ).count;
    return this.buildRule(
      "dispute_case_narratives_redaction",
      "Redact dispute case free-text (context note, resolution note) after retention window for resolved cases.",
      "UPDATE",
      retentionDays,
      cutoff,
      matchedCount,
      affectedCount
    );
  }

  // Mesma logica do relato de falta: so redige quando ja foi resolvido (pela
  // resolucao automatica por prazo, OU pelo caso de disputa vinculado —
  // contestar so muda o NoShowReport pra CONTESTED, quem fecha o ciclo e o
  // DisputeCase).
  private async cleanupNoShowReportNarratives(now: Date, dryRun: boolean) {
    const retentionDays = RETENTION_WINDOWS_DAYS.disputeNarratives;
    const cutoff = this.cutoffFromDays(now, retentionDays);
    const legalHold = this.legalHoldUserIds;
    const where: Prisma.NoShowReportWhereInput = {
      AND: [
        {
          OR: [
            { status: "RESOLVED", resolvedAt: { lt: cutoff } },
            { disputeCase: { status: "RESOLVED", resolvedAt: { lt: cutoff } } }
          ]
        },
        { OR: [{ reportReason: { not: null } }, { contestReason: { not: null } }] },
        ...(legalHold.length > 0
          ? [{ reportedUserId: { notIn: legalHold } }, { reportedByUserId: { notIn: legalHold } }]
          : [])
      ]
    };
    const matchedCount = await prisma.noShowReport.count({ where });
    const affectedCount = dryRun
      ? 0
      : (
          await prisma.noShowReport.updateMany({
            where,
            data: { reportReason: null, contestReason: null }
          })
        ).count;
    return this.buildRule(
      "no_show_report_narratives_redaction",
      "Redact no-show report free-text (report/contest reason) after retention window for resolved reports.",
      "UPDATE",
      retentionDays,
      cutoff,
      matchedCount,
      affectedCount
    );
  }
}
