import { DisputeCaseResolution, DisputeCaseStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { PaymentRefund } from "mercadopago";
import { mp } from "../../../config/mercadopago";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { isAdminEmail } from "../../../shared/utils/admin-access";
import { writeAdminAuditLog } from "../../../shared/utils/admin-audit";
import { NotificationService } from "../../notifications/services/notification.service";

const mpRefund = new PaymentRefund(mp);

type ResolveDisputeCaseInput = {
  resolution: "REFUNDED" | "DENIED";
  amountCents?: number;
  note: string;
};

function formatCents(amountCents: number) {
  return (amountCents / 100).toFixed(2).replace(".", ",");
}

// Fila unica de casos que precisam de julgamento humano (ver DisputeCase no
// schema). Um admin so consegue resolver um caso informando um motivo, que
// viaja verbatim na notificacao pras duas partes (cliente e profissional).
export class DisputeCaseService {
  private notificationService = new NotificationService();

  private async ensureAdminAccess(adminUserId: string) {
    const admin = await prisma.user.findUnique({
      where: { id: adminUserId },
      select: { id: true, name: true, email: true }
    });

    if (!admin || !isAdminEmail(admin.email)) {
      throw new AppError("Acesso negado.", StatusCodes.FORBIDDEN);
    }

    return admin;
  }

  async listCases(adminId: string, status?: DisputeCaseStatus) {
    await this.ensureAdminAccess(adminId);
    console.info(`[ADMIN_LOOKUP] adminId=${adminId} action=listDisputeCases status=${status ?? "all"}`);

    return prisma.disputeCase.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "asc" },
      take: 200,
      select: {
        id: true,
        type: true,
        status: true,
        amountCents: true,
        resolution: true,
        resolvedAmountCents: true,
        createdAt: true,
        resolvedAt: true,
        client: { select: { id: true, name: true, email: true } },
        provider: { select: { id: true, displayName: true, user: { select: { email: true } } } }
      }
    });
  }

  async getCaseDetail(adminId: string, caseId: string) {
    await this.ensureAdminAccess(adminId);
    console.info(`[ADMIN_LOOKUP] adminId=${adminId} action=getDisputeCaseDetail caseId=${caseId}`);

    const disputeCase = await prisma.disputeCase.findUnique({
      where: { id: caseId },
      include: {
        client: { select: { id: true, name: true, email: true } },
        provider: {
          select: { id: true, displayName: true, user: { select: { id: true, name: true, email: true } } }
        },
        resolvedByAdmin: { select: { id: true, name: true } },
        booking: {
          select: {
            id: true,
            scheduledAt: true,
            sessionLocation: true,
            status: true,
            priceCents: true,
            currency: true,
            attendanceCodeValidatedAt: true,
            category: { select: { name: true } },
            completionEvidences: {
              select: { id: true, userId: true, mimeType: true, storageKey: true, imageBase64: true, capturedAt: true }
            },
            chatMessages: {
              orderBy: { createdAt: "asc" },
              take: 500,
              select: { id: true, senderId: true, isSystem: true, content: true, createdAt: true }
            }
          }
        },
        consultancyContract: {
          select: {
            id: true,
            status: true,
            paymentAmountCents: true,
            paymentCapturedAt: true,
            offer: { select: { title: true } }
          }
        },
        presentialPackage: {
          select: { id: true, status: true, cycleAmountCents: true, mode: true, offer: { select: { title: true } } }
        },
        presentialPackageCycle: {
          select: { id: true, cycleIndex: true, amountCents: true, capturedAt: true, periodStart: true, periodEnd: true }
        },
        noShowReport: {
          select: {
            id: true,
            status: true,
            reportReason: true,
            contestReason: true,
            contestDeadlineAt: true,
            contestedAt: true,
            reportedUserId: true,
            reportedByUserId: true
          }
        }
      }
    });

    if (!disputeCase) {
      throw new AppError("Caso não encontrado.", StatusCodes.NOT_FOUND);
    }

    return disputeCase;
  }

  async resolveCase(adminId: string, caseId: string, input: ResolveDisputeCaseInput) {
    const admin = await this.ensureAdminAccess(adminId);

    const note = input.note.trim();
    if (!note) {
      throw new AppError("Informe o motivo da decisão.", StatusCodes.BAD_REQUEST);
    }

    const disputeCase = await prisma.disputeCase.findUnique({
      where: { id: caseId },
      include: { provider: { select: { userId: true } } }
    });
    if (!disputeCase) {
      throw new AppError("Caso não encontrado.", StatusCodes.NOT_FOUND);
    }
    if (disputeCase.status === DisputeCaseStatus.RESOLVED) {
      throw new AppError("Este caso já foi resolvido.", StatusCodes.BAD_REQUEST);
    }

    let resolvedAmountCents: number | null = null;

    if (input.resolution === "REFUNDED") {
      const amountCents = input.amountCents ?? disputeCase.amountCents;
      if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > disputeCase.amountCents) {
        throw new AppError("Valor de reembolso inválido.", StatusCodes.BAD_REQUEST);
      }
      if (!disputeCase.mpPaymentId) {
        throw new AppError("Este caso não tem um pagamento vinculado para reembolsar.", StatusCodes.BAD_REQUEST);
      }

      const isFullRefund = amountCents === disputeCase.amountCents;
      await mpRefund.create({
        payment_id: disputeCase.mpPaymentId,
        body: isFullRefund ? {} : { amount: amountCents / 100 }
      });
      resolvedAmountCents = amountCents;
    }

    const updated = await prisma.disputeCase.update({
      where: { id: caseId },
      data: {
        status: DisputeCaseStatus.RESOLVED,
        resolution: input.resolution as DisputeCaseResolution,
        resolvedAmountCents,
        resolutionNote: note,
        resolvedByAdminId: admin.id,
        resolvedAt: new Date()
      }
    });

    void writeAdminAuditLog({
      adminId: admin.id,
      action: "DISPUTE_CASE_RESOLVED",
      targetType: "DISPUTE_CASE",
      targetId: caseId,
      metadata: { resolution: input.resolution, resolvedAmountCents, type: disputeCase.type }
    });

    const clientMessage =
      input.resolution === "REFUNDED"
        ? `Seu caso foi resolvido: você foi reembolsado em R$ ${formatCents(resolvedAmountCents!)}. Motivo: ${note}`
        : `Seu caso foi resolvido: o reembolso não foi aprovado. Motivo: ${note}`;

    const providerMessage =
      input.resolution === "REFUNDED"
        ? `O caso foi resolvido: o cliente foi reembolsado em R$ ${formatCents(resolvedAmountCents!)}. Motivo: ${note}`
        : `O caso foi resolvido: o pedido de reembolso do cliente não foi aprovado. Motivo: ${note}`;

    void this.notificationService
      .sendToUsers([disputeCase.clientId], {
        preferenceType: "PAYMENTS",
        title: "Seu caso foi resolvido",
        body: clientMessage,
        data: { type: "DISPUTE_CASE_RESOLVED", caseId }
      })
      .catch((error) => console.error("Falha ao notificar cliente sobre resolução de disputa:", error));

    void this.notificationService
      .sendToUsers([disputeCase.provider.userId], {
        preferenceType: "PAYMENTS",
        title: "Um caso foi resolvido",
        body: providerMessage,
        data: { type: "DISPUTE_CASE_RESOLVED", caseId }
      })
      .catch((error) => console.error("Falha ao notificar profissional sobre resolução de disputa:", error));

    return updated;
  }
}
