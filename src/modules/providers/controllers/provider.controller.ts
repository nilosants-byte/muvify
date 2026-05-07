import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { ProviderService } from "../services/provider.service";
const providerService = new ProviderService();
export class ProviderController {
  async getOwnCredentials(request: Request, response: Response) {
    const payload = await providerService.getOwnCredentials(request.user!.id);
    return response.json(payload);
  }

  async upsertOwnCredentials(request: Request, response: Response) {
    const payload = await providerService.upsertOwnCredentials(request.user!.id, request.body);
    return response.json(payload);
  }

  async validateProviderCredentials(request: Request, response: Response) {
    const payload = await providerService.validateProviderCref(
      request.user!.id,
      request.params.providerId
    );
    return response.json(payload);
  }

  async createProfile(request: Request, response: Response) {
    const profile = await providerService.createProfile({
      userId: request.user!.id,
      ...request.body
    });
    return response.status(StatusCodes.CREATED).json(profile);
  }

  async updateProfile(request: Request, response: Response) {
    const profile = await providerService.updateProfile(request.user!.id, request.body);
    return response.json(profile);
  }
  async search(request: Request, response: Response) {
    const providers = await providerService.search({
      categoryId: request.query.categoryId as string | undefined,
      q: request.query.q as string | undefined,
      minRating: request.query.minRating ? Number(request.query.minRating) : undefined,
      lat: request.query.lat ? Number(request.query.lat) : undefined,
      lng: request.query.lng ? Number(request.query.lng) : undefined,
      maxDistanceKm: request.query.maxDistanceKm ? Number(request.query.maxDistanceKm) : undefined,
      serviceMode: request.query.serviceMode as import("@prisma/client").ProviderServiceMode | undefined,
      take: request.query.take ? Number(request.query.take) : undefined,
      offset: request.query.offset ? Number(request.query.offset) : undefined
    });
    return response.json(providers);
  }
  async show(request: Request, response: Response) {
    const provider = await providerService.getById(request.params.providerId);
    return response.json(provider);
  }

  async streamPhoto(request: Request, response: Response) {
    const { buffer, mimeType } = await providerService.getPhotoById(request.params.providerId);
    response.setHeader("Content-Type", mimeType);
    response.setHeader("Content-Length", String(buffer.length));
    response.setHeader("Cache-Control", "public, max-age=86400");
    return response.send(buffer);
  }

  async streamVideo(request: Request, response: Response) {
    const { buffer, mimeType } = await providerService.getVideoById(request.params.providerId);
    response.setHeader("Content-Type", mimeType);
    response.setHeader("Content-Length", String(buffer.length));
    response.setHeader("Cache-Control", "public, max-age=86400");
    response.setHeader("Accept-Ranges", "bytes");
    return response.send(buffer);
  }

  async schedulePreview(request: Request, response: Response) {
    const payload = await providerService.getPublicSchedulePreview(request.params.providerId, {
      startDate: request.query.startDate as string | undefined,
      days: request.query.days ? Number(request.query.days) : undefined
    });
    return response.json(payload);
  }

  async dashboardCalendar(request: Request, response: Response) {
    const calendar = await providerService.listDashboardCalendar(request.user!.id, {
      from: request.query.from as string | undefined,
      to: request.query.to as string | undefined
    });
    return response.json(calendar);
  }

  async createManualCalendarEvent(request: Request, response: Response) {
    const event = await providerService.createManualCalendarEvent(request.user!.id, request.body);
    return response.status(StatusCodes.CREATED).json(event);
  }

  async updateManualCalendarEvent(request: Request, response: Response) {
    const event = await providerService.updateManualCalendarEvent(
      request.user!.id,
      request.params.eventId,
      request.body
    );
    return response.json(event);
  }

  async deleteManualCalendarEvent(request: Request, response: Response) {
    await providerService.deleteManualCalendarEvent(request.user!.id, request.params.eventId);
    return response.status(StatusCodes.NO_CONTENT).send();
  }

  async dashboardStudents(request: Request, response: Response) {
    const payload = await providerService.listStudentsByService(request.user!.id);
    return response.json(payload);
  }

  async dashboardStudentDetail(request: Request, response: Response) {
    const payload = await providerService.getStudentManagementDetail(
      request.user!.id,
      request.params.clientId
    );
    return response.json(payload);
  }

  async getStudentPhysicalAssessment(request: Request, response: Response) {
    const payload = await providerService.getStudentPhysicalAssessment(
      request.user!.id,
      request.params.clientId
    );
    return response.json(payload);
  }

  async upsertStudentPhysicalAssessment(request: Request, response: Response) {
    const payload = await providerService.upsertStudentPhysicalAssessment(
      request.user!.id,
      request.params.clientId,
      request.body
    );
    return response.json(payload);
  }

  async getStudentAnamnesis(request: Request, response: Response) {
    const payload = await providerService.getStudentAnamnesis(
      request.user!.id,
      request.params.clientId
    );
    return response.json(payload);
  }

  async getTimeline(request: Request, response: Response) {
    const payload = await providerService.getTimeline(request.user!.id);
    return response.json(payload);
  }
}
