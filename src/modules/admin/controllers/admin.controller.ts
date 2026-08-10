import { DebtRecordStatus, DisputeCaseStatus } from "@prisma/client";
import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { AdminService } from "../services/admin.service";
import { ModerationService } from "../services/moderation.service";
import { DisputeCaseService } from "../services/dispute-case.service";
import { ProviderService } from "../../providers/services/provider.service";
import { ExerciseService } from "../../exercises/services/exercise.service";
import { DebtService } from "../../payments/services/debt.service";

const adminService = new AdminService();
const moderationService = new ModerationService();
const disputeCaseService = new DisputeCaseService();
const providerService = new ProviderService();
const exerciseService = new ExerciseService();
const debtService = new DebtService();

// Frente 7 (segunda camada), Lote 15: nenhuma fila administrativa (denúncia,
// ticket de suporte, dívida, disputa, CREF) tem ação em massa — só item a
// item, apesar de todas as ações já serem idempotentes/guardadas por
// updateMany com filtro de estado (dariam pra rodar em lote sem risco
// técnico adicional). Documentado como gap aceito por ora: é atrito
// operacional real pra uma fila que cresce, mas é uma feature nova de
// escopo próprio, não um bug — fora do escopo desta frente de auditoria.
export class AdminController {
  async dashboardOverview(request: Request, response: Response) {
    const payload = await adminService.getDashboardOverview(request.user!.id, {
      month: request.query.month ? Number(request.query.month) : undefined,
      year: request.query.year ? Number(request.query.year) : undefined
    });
    return response.json(payload);
  }

  async listCrefValidationQueue(request: Request, response: Response) {
    const payload = await providerService.listCrefValidationQueue(
      request.user!.id,
      (
        request.query.status as
          | "PENDING"
          | "IN_REVIEW"
          | "APPROVED"
          | "REJECTED"
          | undefined
      ) ?? "IN_REVIEW",
      request.query.take ? Number(request.query.take) : undefined,
      request.query.offset ? Number(request.query.offset) : undefined
    );
    return response.json(payload);
  }

  async reviewProviderCref(request: Request, response: Response) {
    const payload = await providerService.reviewProviderCref(
      request.user!.id,
      request.params.providerId,
      request.body
    );
    return response.json(payload);
  }

  async listSupportTickets(request: Request, response: Response) {
    const payload = await adminService.listSupportTickets(request.user!.id, {
      status: request.query.status as "OPEN" | "ANSWERED" | undefined,
      take: request.query.take ? Number(request.query.take) : undefined,
      skip: request.query.skip ? Number(request.query.skip) : undefined,
      q: request.query.q ? String(request.query.q) : undefined
    });
    return response.json(payload);
  }

  async getSupportTicketDetail(request: Request, response: Response) {
    const payload = await adminService.getSupportTicketDetail(request.user!.id, request.params.ticketId);
    return response.json(payload);
  }

  async replySupportTicket(request: Request, response: Response) {
    const payload = await adminService.replySupportTicket(
      request.user!.id,
      request.params.ticketId,
      request.body
    );
    return response.json(payload);
  }

  async listDataRetentionRuns(request: Request, response: Response) {
    const payload = await adminService.listDataRetentionRuns(request.user!.id, {
      take: request.query.take ? Number(request.query.take) : undefined
    });
    return response.json(payload);
  }

  async runDataRetention(request: Request, response: Response) {
    const payload = await adminService.runDataRetention(request.user!.id, {
      dryRun: request.body?.dryRun,
      triggeredBy: request.body?.triggeredBy
    });
    return response.json(payload);
  }

  async listChatAuditSessions(request: Request, response: Response) {
    const payload = await adminService.listChatAuditSessions(request.user!.id, {
      clientEmail: request.query.clientEmail ? String(request.query.clientEmail) : undefined,
      providerEmail: request.query.providerEmail ? String(request.query.providerEmail) : undefined,
      startedFrom: request.query.startedFrom ? String(request.query.startedFrom) : undefined,
      startedTo: request.query.startedTo ? String(request.query.startedTo) : undefined,
      take: request.query.take ? Number(request.query.take) : undefined,
      cursor: request.query.cursor ? String(request.query.cursor) : undefined
    });
    return response.json(payload);
  }

  async getChatAuditSessionMessages(request: Request, response: Response) {
    const payload = await adminService.getChatAuditSessionMessages(request.user!.id, {
      bookingId: request.params.bookingId,
      take: request.query.take ? Number(request.query.take) : undefined,
      cursor: request.query.cursor ? String(request.query.cursor) : undefined
    });
    return response.json(payload);
  }

  async lookupCref(request: Request, response: Response) {
    const payload = await adminService.lookupCrefByDocument(
      request.user!.id,
      String(request.query.providerDocument)
    );
    return response.json(payload);
  }

  async lookupChats(request: Request, response: Response) {
    const payload = await adminService.lookupChatsByDocuments(
      request.user!.id,
      String(request.query.providerDocument),
      String(request.query.clientDocument)
    );
    return response.json(payload);
  }

  async lookupBookings(request: Request, response: Response) {
    const payload = await adminService.lookupBookingsByDocuments(
      request.user!.id,
      String(request.query.providerDocument),
      String(request.query.clientDocument),
      request.query.date ? String(request.query.date) : undefined
    );
    return response.json(payload);
  }

  async lookupBookingDetail(request: Request, response: Response) {
    const payload = await adminService.lookupBookingDetail(
      request.user!.id,
      request.params.bookingId
    );
    return response.json(payload);
  }

  async listNoShowReports(request: Request, response: Response) {
    const minStrikes = request.query.minStrikes ? Number(request.query.minStrikes) : undefined;
    const payload = await adminService.listNoShowReports(request.user!.id, minStrikes);
    return response.json(payload);
  }

  async suspendUser(request: Request, response: Response) {
    const payload = await adminService.suspendUser(request.user!.id, request.params.userId, request.body.reason);
    return response.json(payload);
  }

  async reactivateUser(request: Request, response: Response) {
    const payload = await adminService.reactivateUser(request.user!.id, request.params.userId, request.body?.reason);
    return response.json(payload);
  }

  async getAuditLogs(request: Request, response: Response) {
    const payload = await adminService.getAuditLogs(request.user!.id, {
      targetId: request.query.targetId ? String(request.query.targetId) : undefined,
      action: request.query.action ? String(request.query.action) : undefined,
      take: request.query.take ? Number(request.query.take) : undefined,
      skip: request.query.skip ? Number(request.query.skip) : undefined
    });
    return response.json(payload);
  }

  async changeUserRole(request: Request, response: Response) {
    const payload = await adminService.changeUserRole(
      request.user!.id,
      request.params.userId,
      request.body.role,
      request.body.reason
    );
    return response.json(payload);
  }

  async setLegalHold(request: Request, response: Response) {
    const payload = await adminService.setLegalHold(
      request.user!.id,
      request.params.userId,
      request.body.until,
      request.body.reason
    );
    return response.json(payload);
  }

  async clearLegalHold(request: Request, response: Response) {
    const payload = await adminService.clearLegalHold(request.user!.id, request.params.userId);
    return response.json(payload);
  }

  async exportUserData(request: Request, response: Response) {
    const payload = await adminService.exportUserData(request.user!.id, request.params.userId);
    return response.json(payload);
  }

  async searchUsers(request: Request, response: Response) {
    const payload = await adminService.searchUsers(request.user!.id, String(request.query.q ?? ""), {
      page: request.query.page ? Number(request.query.page) : undefined,
      limit: request.query.limit ? Number(request.query.limit) : undefined,
      role: request.query.role as "CLIENT" | "PROVIDER" | "ADMIN" | undefined,
      suspended: typeof request.query.suspended === "string" ? request.query.suspended === "true" : undefined
    });
    return response.json(payload);
  }

  async getUserDetail(request: Request, response: Response) {
    const payload = await adminService.getUserDetail(request.user!.id, request.params.userId);
    return response.json(payload);
  }

  async listDebts(request: Request, response: Response) {
    const payload = await debtService.listAllDebts(
      request.user!.id,
      request.query.status as DebtRecordStatus | undefined,
      request.query.skip ? Number(request.query.skip) : undefined,
      request.query.take ? Number(request.query.take) : undefined
    );
    return response.json(payload);
  }

  async writeOffDebt(request: Request, response: Response) {
    const payload = await debtService.writeOffDebt(request.user!.id, request.params.debtId, request.body.reason);
    return response.json(payload);
  }

  async listDisputeCases(request: Request, response: Response) {
    const payload = await disputeCaseService.listCases(
      request.user!.id,
      request.query.status as DisputeCaseStatus | undefined,
      request.query.skip ? Number(request.query.skip) : undefined,
      request.query.take ? Number(request.query.take) : undefined
    );
    return response.json(payload);
  }

  async getDisputeCaseDetail(request: Request, response: Response) {
    const payload = await disputeCaseService.getCaseDetail(request.user!.id, request.params.caseId);
    return response.json(payload);
  }

  async resolveDisputeCase(request: Request, response: Response) {
    const payload = await disputeCaseService.resolveCase(request.user!.id, request.params.caseId, request.body);
    return response.json(payload);
  }

  async listReports(request: Request, response: Response) {
    const payload = await moderationService.listReports(request.user!.id, {
      status: request.query.status as "PENDING" | "DISMISSED" | "ACTIONED" | undefined,
      take: request.query.take ? Number(request.query.take) : undefined,
      skip: request.query.skip ? Number(request.query.skip) : undefined
    });
    return response.json(payload);
  }

  async dismissReport(request: Request, response: Response) {
    await moderationService.dismissReport(
      request.user!.id,
      request.params.type as "feed-post" | "booking-message" | "consultancy-message",
      request.params.id
    );
    return response.status(StatusCodes.NO_CONTENT).send();
  }

  async hideReportedContent(request: Request, response: Response) {
    await moderationService.hideReportedContent(
      request.user!.id,
      request.params.type as "feed-post" | "booking-message" | "consultancy-message",
      request.params.id
    );
    return response.status(StatusCodes.NO_CONTENT).send();
  }

  async unhideReportedContent(request: Request, response: Response) {
    await moderationService.unhideContent(
      request.user!.id,
      request.params.type as "feed-post" | "booking-message" | "consultancy-message",
      request.params.id
    );
    return response.status(StatusCodes.NO_CONTENT).send();
  }

  async listPrebuiltExercises(request: Request, response: Response) {
    const { category, q } = request.query as Record<string, string | undefined>;
    const exercises = await exerciseService.listPrebuilt(category, q);
    return response.json(exercises);
  }

  async createPrebuiltExercise(request: Request, response: Response) {
    const { name, category, description, defaultRepetitionsSets, defaultRestLabel, mediaUrl, mediaType } = request.body;
    const exercise = await exerciseService.createPrebuilt(request.user!.id, {
      name, category, description, defaultRepetitionsSets, defaultRestLabel, mediaUrl, mediaType,
    });
    return response.status(StatusCodes.CREATED).json(exercise);
  }

  async updatePrebuiltExercise(request: Request, response: Response) {
    const { exerciseId } = request.params;
    const { name, category, description, defaultRepetitionsSets, defaultRestLabel, mediaUrl, mediaType } = request.body;
    const exercise = await exerciseService.updatePrebuilt(request.user!.id, exerciseId, {
      name, category, description, defaultRepetitionsSets, defaultRestLabel, mediaUrl, mediaType,
    });
    return response.json(exercise);
  }

  async deletePrebuiltExercise(request: Request, response: Response) {
    await exerciseService.deletePrebuilt(request.user!.id, request.params.exerciseId);
    return response.status(StatusCodes.NO_CONTENT).send();
  }
}
