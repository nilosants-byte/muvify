import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { AvailabilityService } from "../services/availability.service";
const availabilityService = new AvailabilityService();
export class AvailabilityController {
  async create(request: Request, response: Response) {
    const availability = await availabilityService.create(
      request.user!.id,
      request.body.weekday,
      request.body.startTime,
      request.body.endTime,
      request.body.isActive
    );
    return response.status(StatusCodes.CREATED).json(availability);
  }
  async listMyAvailability(request: Request, response: Response) {
    const availabilities = await availabilityService.listMyAvailability(request.user!.id);
    return response.json(availabilities);
  }
  async deleteAvailability(request: Request, response: Response) {
    const force = request.query.force === "true";
    await availabilityService.deleteAvailability(request.user!.id, request.params.availabilityId, force);
    return response.status(StatusCodes.NO_CONTENT).send();
  }
}
