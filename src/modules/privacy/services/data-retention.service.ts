import {
  AnamnesisStatus,
  BookingStatus,
  ConsultancyContractStatus,
  PresentialPackageStatus,
  Prisma,
  SupportTicketStatus
} from "@prisma/client";
import * as Sentry from "@sentry/node";
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
  // Épico de Frentes, Frente 11, Lote 7: anamnese e avaliação biométrica são
  // dado de saúde - mais sensível que o genérico (mensagem de chat,
  // comentário de review), então merecem uma janela mais curta em vez de
  // compartilhar os mesmos 730 dias de tudo mais.
  anamnesis: 365,
  bookingMessages: 730,
  consultancyMessages: 730,
  supportTickets: 1825,
  bookingNotes: 730,
  manualBlocks: 730,
  financialStudentNotes: 730,
  contentReportReasons: 730,
  consultancyHealthData: 730,
  biometricAssessments: 365,
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
  // Frente 13 (segunda camada), Lote 5: "SUCCESS" era hardcoded mesmo
  // quando uma ou mais regras falhavam (ver safeRun abaixo) — o log de
  // execução (DataRetentionExecutionLog) nunca refletia isso, e não havia
  // contagem esperada de regras pra alguém perceber que uma sumiu do
  // array `rules`. Risco de compliance real: se cleanupAnamnesis (dado de
  // saúde, retenção de 365 dias) falhasse toda vez, ninguém saberia.
  status: "SUCCESS" | "PARTIAL_FAILURE";
  dryRun: boolean;
  triggeredBy: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totals: {
    matchedCount: number;
    affectedCount: number;
    rules: number;
    failedRules: number;
  };
  rules: RetentionRuleExecution[];
  failedRuleIds: string[];
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

    const failedRuleIds: string[] = [];
    // Cada rule é isolada — falha de uma não impede as demais
    const safeRun = async (
      ruleId: string,
      fn: () => Promise<RetentionRuleExecution>
    ): Promise<RetentionRuleExecution | null> => {
      try {
        return await fn();
      } catch (err) {
        console.error(`[data-retention] Rule failed: ${ruleId}`, err);
        failedRuleIds.push(ruleId);
        Sentry.captureException(err, {
          tags: { area: "data-retention", ruleId },
          extra: { ruleId, triggeredBy: input.triggeredBy, dryRun: input.dryRun }
        });
        return null;
      }
    };

    const rules: RetentionRuleExecution[] = [];
    try {
      const results = await Promise.all([
        safeRun("sessions_expired_or_revoked", () => this.cleanupSessions(now, input.dryRun)),
        safeRun("password_reset_tokens_obsolete", () => this.cleanupPasswordResetTokens(now, input.dryRun)),
        safeRun("email_verification_tokens_obsolete", () => this.cleanupEmailVerificationTokens(now, input.dryRun)),
        safeRun("push_devices_inactive", () => this.cleanupPushDevices(now, input.dryRun)),
        safeRun("user_notifications_old", () => this.cleanupUserNotifications(now, input.dryRun)),
        safeRun("push_queue_failures_old", () => this.cleanupPushQueue(now, input.dryRun)),
        safeRun("completion_evidence_old", () => this.cleanupCompletionEvidence(now, input.dryRun)),
        safeRun("anamnesis_redaction", () => this.cleanupAnamnesis(now, input.dryRun)),
        safeRun("booking_messages_redaction", () => this.cleanupBookingMessages(now, input.dryRun)),
        safeRun("consultancy_messages_redaction", () => this.cleanupConsultancyMessages(now, input.dryRun)),
        safeRun("support_tickets_redaction", () => this.cleanupSupportTickets(now, input.dryRun)),
        safeRun("booking_notes_redaction", () => this.cleanupBookingNotes(now, input.dryRun)),
        safeRun("manual_blocks_redaction", () => this.cleanupManualBlocks(now, input.dryRun)),
        safeRun("financial_student_notes_redaction", () => this.cleanupFinancialStudentNotes(now, input.dryRun)),
        safeRun("content_report_reasons_redaction", () => this.cleanupContentReportReasons(now, input.dryRun)),
        safeRun("consultancy_health_data_redaction", () => this.cleanupConsultancyHealthData(now, input.dryRun)),
        safeRun("biometric_assessments_deletion", () => this.cleanupBiometricAssessments(now, input.dryRun)),
        safeRun("email_delivery_queue_cleanup", () => this.cleanupEmailDeliveryQueue(now, input.dryRun)),
        safeRun("review_comments_redaction", () => this.cleanupReviewComments(now, input.dryRun)),
        safeRun("dispute_case_narratives_redaction", () => this.cleanupDisputeCaseNarratives(now, input.dryRun)),
        safeRun("no_show_report_narratives_redaction", () => this.cleanupNoShowReportNarratives(now, input.dryRun)),
      ]);
      rules.push(...(results.filter(Boolean) as RetentionRuleExecution[]));

      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();
      const result: DataRetentionRunResult = {
        status: failedRuleIds.length > 0 ? "PARTIAL_FAILURE" : "SUCCESS",
        dryRun: input.dryRun,
        triggeredBy: input.triggeredBy,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs,
        totals: {
          matchedCount: rules.reduce((sum, rule) => sum + rule.matchedCount, 0),
          affectedCount: rules.reduce((sum, rule) => sum + rule.affectedCount, 0),
          rules: rules.length,
          failedRules: failedRuleIds.length
        },
        rules,
        failedRuleIds
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

  // Épico de Frentes, Frente 11, Lote 7: legal hold só era checado do lado
  // cliente em várias regras - profissional sob a mesma retenção legal
  // (processo judicial em curso, por exemplo) tinha o próprio conteúdo
  // (nota de dispuita, resposta de review...) redigido normalmente.
  private getProviderUserFilter() {
    if (this.legalHoldUserIds.length === 0) {
      return {};
    }
    return {
      provider: { userId: { notIn: this.legalHoldUserIds } }
    } as Record<string, { userId: { notIn: string[] } }>;
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
    // Épico de Frentes, Frente 11, Lote 7: mesma classe de bug já corrigida
    // em SupportTicket (Frente 10, Lote 5) - redigia a anamnese de um
    // cliente ATIVO (ainda com booking/contrato/pacote em andamento com
    // algum profissional), quebrando a checagem REQUIRE_ANAMNESIS_FOR_
    // CONTRACTS sem explicação nenhuma pro usuário.
    const where: Prisma.ClientAnamnesisWhereInput = {
      ...this.getUserFilter("clientId"),
      updatedAt: { lt: cutoff },
      answers: { not: null },
      client: {
        bookings: { none: { status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] } } },
        consultancyContracts: {
          none: { status: { in: [ConsultancyContractStatus.PENDING_PAYMENT, ConsultancyContractStatus.ACTIVE, ConsultancyContractStatus.DELIVERED] } }
        },
        presentialPackages: {
          none: { status: { in: [PresentialPackageStatus.PENDING_PAYMENT, PresentialPackageStatus.ACTIVE, PresentialPackageStatus.PAST_DUE] } }
        }
      }
    };
    const matchedCount = await prisma.clientAnamnesis.count({ where });
    const affectedCount = dryRun
      ? 0
      : (
          await prisma.clientAnamnesis.updateMany({
            where,
            data: {
              answers: null,
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

  // Épico de Frentes, Frente 11, Lote 7: espelha cleanupBookingMessages -
  // ConsultancyMessage (chat de consultoria) não tinha regra de retenção
  // nenhuma, apesar de ser a mesma infraestrutura de chat (só generalizada
  // pra ConsultancyContract em vez de Booking).
  private async cleanupConsultancyMessages(now: Date, dryRun: boolean) {
    const retentionDays = RETENTION_WINDOWS_DAYS.consultancyMessages;
    const cutoff = this.cutoffFromDays(now, retentionDays);
    const hasLegalHold = this.legalHoldUserIds.length > 0;
    const where: Prisma.ConsultancyMessageWhereInput = {
      createdAt: { lt: cutoff },
      isSystem: false,
      ...(hasLegalHold ? this.getUserFilter("senderId") : {}),
      contract: {
        status: { in: ["CANCELLED", "DELIVERED", "REFUNDED_EXPIRED", "ARCHIVED"] },
        updatedAt: { lt: cutoff },
        ...(hasLegalHold
          ? {
              clientId: { notIn: this.legalHoldUserIds },
              provider: { userId: { notIn: this.legalHoldUserIds } }
            }
          : {})
      }
    };
    const matchedCount = await prisma.consultancyMessage.count({ where });
    const affectedCount = dryRun
      ? 0
      : (
          await prisma.consultancyMessage.updateMany({
            where,
            data: { content: "[CONTEUDO REMOVIDO POR RETENCAO]", senderId: null }
          })
        ).count;
    return this.buildRule(
      "consultancy_messages_redaction",
      "Redact consultancy chat messages after retention window.",
      "UPDATE",
      retentionDays,
      cutoff,
      matchedCount,
      affectedCount
    );
  }

  // Épico de Frentes, Frente 11, Lote 7: categoria órfã - nota de bloco
  // manual de agenda (ex.: "Consulta médica") é texto livre que pode
  // revelar informação pessoal do profissional, sem regra de retenção
  // nenhuma até aqui.
  private async cleanupManualBlocks(now: Date, dryRun: boolean) {
    const retentionDays = RETENTION_WINDOWS_DAYS.manualBlocks;
    const cutoff = this.cutoffFromDays(now, retentionDays);
    const where: Prisma.ProviderManualBlockWhereInput = {
      ...this.getProviderUserFilter(),
      updatedAt: { lt: cutoff },
      OR: [{ label: { not: "" } }, { location: { not: null } }]
    };
    const matchedCount = await prisma.providerManualBlock.count({ where });
    const affectedCount = dryRun
      ? 0
      : (await prisma.providerManualBlock.updateMany({ where, data: { label: "[REMOVIDO]", location: null } })).count;
    return this.buildRule(
      "manual_blocks_redaction",
      "Redact provider manual schedule block free-text after retention window.",
      "UPDATE",
      retentionDays,
      cutoff,
      matchedCount,
      affectedCount
    );
  }

  // Épico de Frentes, Frente 11, Lote 7: categoria órfã - aluno financeiro
  // cadastrado manualmente pelo profissional (fora do fluxo de contratação
  // via app) guarda nota/local livres, sem retenção nenhuma. Só redige
  // registros já INATIVOS (isActive: false) - um aluno financeiro ativo
  // ainda está em uso operacional pelo profissional.
  private async cleanupFinancialStudentNotes(now: Date, dryRun: boolean) {
    const retentionDays = RETENTION_WINDOWS_DAYS.financialStudentNotes;
    const cutoff = this.cutoffFromDays(now, retentionDays);
    const where: Prisma.FinancialStudentWhereInput = {
      ...this.getProviderUserFilter(),
      isActive: false,
      updatedAt: { lt: cutoff },
      OR: [{ notes: { not: null } }, { location: { not: null } }]
    };
    const matchedCount = await prisma.financialStudent.count({ where });
    const affectedCount = dryRun
      ? 0
      : (await prisma.financialStudent.updateMany({ where, data: { notes: null, location: null } })).count;
    return this.buildRule(
      "financial_student_notes_redaction",
      "Redact inactive manual financial student notes/location after retention window.",
      "UPDATE",
      retentionDays,
      cutoff,
      matchedCount,
      affectedCount
    );
  }

  // Épico de Frentes, Frente 11, Lote 7: categoria órfã - motivo de
  // denúncia de conteúdo (feed, mensagem de agendamento, mensagem de
  // consultoria) nunca tinha retenção. Só redige denúncias já decididas
  // (DISMISSED/ACTIONED) - uma denúncia PENDING ainda precisa do texto pro
  // admin avaliar.
  private async cleanupContentReportReasons(now: Date, dryRun: boolean) {
    const retentionDays = RETENTION_WINDOWS_DAYS.contentReportReasons;
    const cutoff = this.cutoffFromDays(now, retentionDays);
    const decidedStatuses = ["DISMISSED", "ACTIONED"] as const;

    const feedWhere: Prisma.FeedPostReportWhereInput = {
      reporterId: this.legalHoldUserIds.length > 0 ? { notIn: this.legalHoldUserIds } : undefined,
      status: { in: [...decidedStatuses] },
      reviewedAt: { lt: cutoff },
      reason: { not: null }
    };
    const bookingReportWhere: Prisma.BookingMessageReportWhereInput = {
      reporterId: this.legalHoldUserIds.length > 0 ? { notIn: this.legalHoldUserIds } : undefined,
      status: { in: [...decidedStatuses] },
      reviewedAt: { lt: cutoff },
      reason: { not: null }
    };
    const consultancyReportWhere: Prisma.ConsultancyMessageReportWhereInput = {
      reporterId: this.legalHoldUserIds.length > 0 ? { notIn: this.legalHoldUserIds } : undefined,
      status: { in: [...decidedStatuses] },
      reviewedAt: { lt: cutoff },
      reason: { not: null }
    };

    const [feedMatched, bookingMatched, consultancyMatched] = await Promise.all([
      prisma.feedPostReport.count({ where: feedWhere }),
      prisma.bookingMessageReport.count({ where: bookingReportWhere }),
      prisma.consultancyMessageReport.count({ where: consultancyReportWhere })
    ]);
    const matchedCount = feedMatched + bookingMatched + consultancyMatched;

    let affectedCount = 0;
    if (!dryRun) {
      const [feedResult, bookingResult, consultancyResult] = await Promise.all([
        prisma.feedPostReport.updateMany({ where: feedWhere, data: { reason: null } }),
        prisma.bookingMessageReport.updateMany({ where: bookingReportWhere, data: { reason: null } }),
        prisma.consultancyMessageReport.updateMany({ where: consultancyReportWhere, data: { reason: null } })
      ]);
      affectedCount = feedResult.count + bookingResult.count + consultancyResult.count;
    }

    return this.buildRule(
      "content_report_reasons_redaction",
      "Redact content report free-text reason after retention window for already-decided reports.",
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
      ...this.getProviderUserFilter(),
      updatedAt: { lt: cutoff },
      // Épico de Frentes, Frente 11, Lote 7: só o comentário do cliente era
      // redigido - a resposta do PROFISSIONAL à review (providerResponse)
      // ficava intacta pra sempre, mesmo sendo o mesmo tipo de texto livre.
      OR: [{ comment: { not: null } }, { providerResponse: { not: null } }]
    };
    const matchedCount = await prisma.review.count({ where });
    const affectedCount = dryRun
      ? 0
      : (await prisma.review.updateMany({ where, data: { comment: null, providerResponse: null } })).count;
    return this.buildRule(
      "review_comments_redaction",
      "Redact review comment and provider response text after retention window.",
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
      ...this.getProviderUserFilter(),
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

  // Épico de Frentes, Frente 11, Lote 7: redigia a avaliação de um par
  // profissional-aluno ATIVO (relação em andamento entre os dois) - mesma
  // classe de bug já corrigida em cleanupAnamnesis acima. Como a checagem é
  // por PAR (providerId, clientId), não dá pra expressar via nested filter
  // do Prisma (correlação entre dois campos da própria linha) - busca os
  // candidatos, calcula os pares com vínculo ativo à parte, e filtra em
  // memória antes de redigir.
  private async cleanupBiometricAssessments(now: Date, dryRun: boolean) {
    const retentionDays = RETENTION_WINDOWS_DAYS.biometricAssessments;
    const cutoff = this.cutoffFromDays(now, retentionDays);
    const where: Prisma.ProviderStudentAssessmentWhereInput = {
      ...this.getUserFilter("clientId"),
      ...this.getProviderUserFilter(),
      updatedAt: { lt: cutoff }
    };
    const candidates = await prisma.providerStudentAssessment.findMany({
      where,
      select: { id: true, providerId: true, clientId: true }
    });

    const pairKey = (providerId: string, clientId: string) => `${providerId}:${clientId}`;
    const activePairs = new Set<string>();
    if (candidates.length > 0) {
      const providerIds = Array.from(new Set(candidates.map((c) => c.providerId)));
      const clientIds = Array.from(new Set(candidates.map((c) => c.clientId)));
      const [activeBookings, activeContracts, activePackages] = await Promise.all([
        prisma.booking.findMany({
          where: { providerId: { in: providerIds }, clientId: { in: clientIds }, status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] } },
          select: { providerId: true, clientId: true }
        }),
        prisma.consultancyContract.findMany({
          where: {
            providerId: { in: providerIds }, clientId: { in: clientIds },
            status: { in: [ConsultancyContractStatus.PENDING_PAYMENT, ConsultancyContractStatus.ACTIVE, ConsultancyContractStatus.DELIVERED] }
          },
          select: { providerId: true, clientId: true }
        }),
        prisma.presentialPackage.findMany({
          where: {
            providerId: { in: providerIds }, clientId: { in: clientIds },
            status: { in: [PresentialPackageStatus.PENDING_PAYMENT, PresentialPackageStatus.ACTIVE, PresentialPackageStatus.PAST_DUE] }
          },
          select: { providerId: true, clientId: true }
        })
      ]);
      for (const row of [...activeBookings, ...activeContracts, ...activePackages]) {
        activePairs.add(pairKey(row.providerId, row.clientId));
      }
    }

    const toRedact = candidates.filter((c) => !activePairs.has(pairKey(c.providerId, c.clientId)));
    const matchedCount = toRedact.length;
    const affectedCount = dryRun
      ? 0
      : (
          await prisma.providerStudentAssessment.deleteMany({
            where: { id: { in: toRedact.map((c) => c.id) } }
          })
        ).count;
    return this.buildRule(
      "biometric_assessments_deletion",
      "Delete biometric physical assessment records after retention window, skipping pairs with an active relationship.",
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
      ...this.getProviderUserFilter(),
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
