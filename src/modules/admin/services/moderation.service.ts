import { ContentReportStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { isAdminEmail } from "../../../shared/utils/admin-access";
import { writeAdminAuditLog } from "../../../shared/utils/admin-audit";

// Épico de Frentes, Frente 10, Lote 1: FeedPostReport (Frente 8/Lote 2) e
// BookingMessageReport/ConsultancyMessageReport (Frente 9/Lote 10) só
// persistiam o registro da denúncia — nenhum endpoint/tela lia essas
// tabelas para fins administrativos, e o único efeito prático era o
// conteúdo sumir só para quem denunciou (post) ou nada acontecer (chat).
// Este service unifica as 3 filas numa só, com ação real: descartar (sem
// efeito no conteúdo) ou ocultar o conteúdo denunciado (soft-hide
// reversível, some pra todo mundo, nunca é apagado de vez).

export type ReportType = "feed-post" | "booking-message" | "consultancy-message";

type UnifiedReport = {
  type: ReportType;
  reportId: string;
  reason: string | null;
  status: ContentReportStatus;
  createdAt: Date;
  reporter: { id: string; name: string; email: string };
  contentId: string;
  contentPreview: string;
  contentAuthor: { id: string; name: string; email: string } | null;
  contentHidden: boolean;
};

export class ModerationService {
  private async ensureAdminAccess(adminUserId: string) {
    const admin = await prisma.user.findUnique({
      where: { id: adminUserId },
      select: { id: true, email: true }
    });
    if (!admin || !isAdminEmail(admin.email)) {
      throw new AppError("Acesso negado.", StatusCodes.FORBIDDEN);
    }
    return admin;
  }

  async listReports(
    adminId: string,
    input: { status?: ContentReportStatus; take?: number; skip?: number }
  ): Promise<{ items: UnifiedReport[]; total: number }> {
    await this.ensureAdminAccess(adminId);
    const status = input.status ?? ContentReportStatus.PENDING;
    const take = Math.min(Math.max(input.take ?? 20, 1), 100);
    const skip = Math.max(input.skip ?? 0, 0);
    // Não dá pra paginar de forma nativa 3 tabelas diferentes numa lista
    // só sem uma view/UNION dedicada — busca até skip+take de cada fonte,
    // mescla e corta em memória. Uma fila administrativa não tem volume
    // que justifique mais que isso.
    const fetchLimit = skip + take;

    const [feedReports, bookingReports, consultancyReports, feedTotal, bookingTotal, consultancyTotal] =
      await Promise.all([
        prisma.feedPostReport.findMany({
          where: { status },
          orderBy: { createdAt: "desc" },
          take: fetchLimit,
          select: {
            id: true,
            reason: true,
            status: true,
            createdAt: true,
            reporter: { select: { id: true, name: true, email: true } },
            post: {
              select: {
                id: true,
                caption: true,
                imageUrl: true,
                hiddenByAdminAt: true,
                user: { select: { id: true, name: true, email: true } }
              }
            }
          }
        }),
        prisma.bookingMessageReport.findMany({
          where: { status },
          orderBy: { createdAt: "desc" },
          take: fetchLimit,
          select: {
            id: true,
            reason: true,
            status: true,
            createdAt: true,
            reporter: { select: { id: true, name: true, email: true } },
            message: {
              select: {
                id: true,
                content: true,
                hiddenByAdminAt: true,
                sender: { select: { id: true, name: true, email: true } }
              }
            }
          }
        }),
        prisma.consultancyMessageReport.findMany({
          where: { status },
          orderBy: { createdAt: "desc" },
          take: fetchLimit,
          select: {
            id: true,
            reason: true,
            status: true,
            createdAt: true,
            reporter: { select: { id: true, name: true, email: true } },
            message: {
              select: {
                id: true,
                content: true,
                hiddenByAdminAt: true,
                sender: { select: { id: true, name: true, email: true } }
              }
            }
          }
        }),
        prisma.feedPostReport.count({ where: { status } }),
        prisma.bookingMessageReport.count({ where: { status } }),
        prisma.consultancyMessageReport.count({ where: { status } })
      ]);

    const merged: UnifiedReport[] = [
      ...feedReports.map((r): UnifiedReport => ({
        type: "feed-post",
        reportId: r.id,
        reason: r.reason,
        status: r.status,
        createdAt: r.createdAt,
        reporter: r.reporter,
        contentId: r.post.id,
        contentPreview: r.post.caption ?? (r.post.imageUrl ? "[foto]" : ""),
        contentAuthor: r.post.user,
        contentHidden: Boolean(r.post.hiddenByAdminAt)
      })),
      ...bookingReports.map((r): UnifiedReport => ({
        type: "booking-message",
        reportId: r.id,
        reason: r.reason,
        status: r.status,
        createdAt: r.createdAt,
        reporter: r.reporter,
        contentId: r.message.id,
        contentPreview: r.message.content,
        contentAuthor: r.message.sender,
        contentHidden: Boolean(r.message.hiddenByAdminAt)
      })),
      ...consultancyReports.map((r): UnifiedReport => ({
        type: "consultancy-message",
        reportId: r.id,
        reason: r.reason,
        status: r.status,
        createdAt: r.createdAt,
        reporter: r.reporter,
        contentId: r.message.id,
        contentPreview: r.message.content,
        contentAuthor: r.message.sender,
        contentHidden: Boolean(r.message.hiddenByAdminAt)
      }))
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return {
      items: merged.slice(skip, skip + take),
      total: feedTotal + bookingTotal + consultancyTotal
    };
  }

  private reportDelegate(type: ReportType) {
    switch (type) {
      case "feed-post":
        return prisma.feedPostReport;
      case "booking-message":
        return prisma.bookingMessageReport;
      case "consultancy-message":
        return prisma.consultancyMessageReport;
    }
  }

  async dismissReport(adminId: string, type: ReportType, reportId: string): Promise<void> {
    const admin = await this.ensureAdminAccess(adminId);
    const delegate = this.reportDelegate(type) as { updateMany: (args: any) => Promise<{ count: number }> };
    const result = await delegate.updateMany({
      where: { id: reportId, status: ContentReportStatus.PENDING },
      data: { status: ContentReportStatus.DISMISSED, reviewedAt: new Date(), reviewedById: admin.id }
    });
    if (result.count === 0) {
      throw new AppError("Denúncia não encontrada ou já revisada.", StatusCodes.NOT_FOUND);
    }
    await writeAdminAuditLog({
      adminId: admin.id,
      action: "REPORT_DISMISSED",
      targetType: type,
      targetId: reportId
    });
  }

  async hideReportedContent(adminId: string, type: ReportType, reportId: string): Promise<void> {
    const admin = await this.ensureAdminAccess(adminId);
    const now = new Date();

    if (type === "feed-post") {
      const report = await prisma.feedPostReport.findUnique({ where: { id: reportId }, select: { postId: true } });
      if (!report) throw new AppError("Denúncia não encontrada.", StatusCodes.NOT_FOUND);
      await prisma.$transaction([
        prisma.feedPost.update({
          where: { id: report.postId },
          data: { hiddenByAdminAt: now, hiddenByAdminId: admin.id }
        }),
        prisma.feedPostReport.updateMany({
          where: { postId: report.postId, status: ContentReportStatus.PENDING },
          data: { status: ContentReportStatus.ACTIONED, reviewedAt: now, reviewedById: admin.id }
        })
      ]);
      await writeAdminAuditLog({
        adminId: admin.id,
        action: "REPORT_CONTENT_HIDDEN",
        targetType: type,
        targetId: report.postId
      });
      return;
    }

    if (type === "booking-message") {
      const report = await prisma.bookingMessageReport.findUnique({ where: { id: reportId }, select: { messageId: true } });
      if (!report) throw new AppError("Denúncia não encontrada.", StatusCodes.NOT_FOUND);
      await prisma.$transaction([
        prisma.bookingMessage.update({
          where: { id: report.messageId },
          data: { hiddenByAdminAt: now, hiddenByAdminId: admin.id }
        }),
        prisma.bookingMessageReport.updateMany({
          where: { messageId: report.messageId, status: ContentReportStatus.PENDING },
          data: { status: ContentReportStatus.ACTIONED, reviewedAt: now, reviewedById: admin.id }
        })
      ]);
      await writeAdminAuditLog({
        adminId: admin.id,
        action: "REPORT_CONTENT_HIDDEN",
        targetType: type,
        targetId: report.messageId
      });
      return;
    }

    const report = await prisma.consultancyMessageReport.findUnique({ where: { id: reportId }, select: { messageId: true } });
    if (!report) throw new AppError("Denúncia não encontrada.", StatusCodes.NOT_FOUND);
    await prisma.$transaction([
      prisma.consultancyMessage.update({
        where: { id: report.messageId },
        data: { hiddenByAdminAt: now, hiddenByAdminId: admin.id }
      }),
      prisma.consultancyMessageReport.updateMany({
        where: { messageId: report.messageId, status: ContentReportStatus.PENDING },
        data: { status: ContentReportStatus.ACTIONED, reviewedAt: now, reviewedById: admin.id }
      })
    ]);
    await writeAdminAuditLog({
      adminId: admin.id,
      action: "REPORT_CONTENT_HIDDEN",
      targetType: type,
      targetId: report.messageId
    });
  }

  async pendingReportsCount(): Promise<number> {
    const [feed, booking, consultancy] = await Promise.all([
      prisma.feedPostReport.count({ where: { status: ContentReportStatus.PENDING } }),
      prisma.bookingMessageReport.count({ where: { status: ContentReportStatus.PENDING } }),
      prisma.consultancyMessageReport.count({ where: { status: ContentReportStatus.PENDING } })
    ]);
    return feed + booking + consultancy;
  }
}
