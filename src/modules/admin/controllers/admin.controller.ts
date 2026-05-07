import { Request, Response } from "express";
import { AdminService } from "../services/admin.service";
import { ProviderService } from "../../providers/services/provider.service";

const adminService = new AdminService();
const providerService = new ProviderService();

export class AdminController {
  async dashboardOverview(request: Request, response: Response) {
    const payload = await adminService.getDashboardOverview({
      month: request.query.month ? Number(request.query.month) : undefined,
      year: request.query.year ? Number(request.query.year) : undefined
    });
    return response.json(payload);
  }

  async listCrefValidationQueue(request: Request, response: Response) {
    const payload = await providerService.listCrefValidationQueue(
      (
        request.query.status as
          | "PENDING"
          | "IN_REVIEW"
          | "APPROVED"
          | "REJECTED"
          | undefined
      ) ?? "IN_REVIEW",
      request.query.take ? Number(request.query.take) : undefined
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
    const payload = await adminService.listSupportTickets({
      status: request.query.status as "OPEN" | "ANSWERED" | undefined,
      take: request.query.take ? Number(request.query.take) : undefined
    });
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
}
