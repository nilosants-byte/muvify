import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { AdminService } from "../services/admin.service";
import { ProviderService } from "../../providers/services/provider.service";
import { ExerciseService } from "../../exercises/services/exercise.service";

const adminService = new AdminService();
const providerService = new ProviderService();
const exerciseService = new ExerciseService();

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

  async listPrebuiltExercises(request: Request, response: Response) {
    const { category, q } = request.query as Record<string, string | undefined>;
    const exercises = await exerciseService.listPrebuilt(category, q);
    return response.json(exercises);
  }

  async createPrebuiltExercise(request: Request, response: Response) {
    const { name, category, description, defaultRepetitionsSets, defaultRestLabel, mediaUrl, mediaType } = request.body;
    const exercise = await exerciseService.createPrebuilt({
      name, category, description, defaultRepetitionsSets, defaultRestLabel, mediaUrl, mediaType,
    });
    return response.status(StatusCodes.CREATED).json(exercise);
  }

  async updatePrebuiltExercise(request: Request, response: Response) {
    const { exerciseId } = request.params;
    const { name, category, description, defaultRepetitionsSets, defaultRestLabel, mediaUrl, mediaType } = request.body;
    const exercise = await exerciseService.updatePrebuilt(exerciseId, {
      name, category, description, defaultRepetitionsSets, defaultRestLabel, mediaUrl, mediaType,
    });
    return response.json(exercise);
  }

  async deletePrebuiltExercise(request: Request, response: Response) {
    await exerciseService.deletePrebuilt(request.params.exerciseId);
    return response.status(StatusCodes.NO_CONTENT).send();
  }
}
