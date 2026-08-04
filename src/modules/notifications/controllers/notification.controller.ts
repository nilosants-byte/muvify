import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { NotificationService } from "../services/notification.service";

const notificationService = new NotificationService();

export class NotificationController {
  async listInbox(request: Request, response: Response) {
    const rawTake = request.query.take ? Number(request.query.take) : undefined;
    const take = rawTake && Number.isFinite(rawTake) && rawTake > 0 ? rawTake : undefined;
    const rawSkip = request.query.skip ? Number(request.query.skip) : undefined;
    const skip = rawSkip && Number.isFinite(rawSkip) && rawSkip > 0 ? rawSkip : undefined;
    const items = await notificationService.listInbox(request.user!.id, take, skip);
    return response.json(items);
  }

  async markAllAsRead(request: Request, response: Response) {
    await notificationService.markAllAsRead(request.user!.id);
    return response.status(StatusCodes.NO_CONTENT).send();
  }

  async markAsRead(request: Request, response: Response) {
    await notificationService.markAsRead(request.user!.id, request.params.id);
    return response.status(StatusCodes.NO_CONTENT).send();
  }

  async unreadCount(request: Request, response: Response) {
    const unread = await notificationService.unreadCount(request.user!.id);
    return response.json({ unread });
  }

  async listDevices(request: Request, response: Response) {
    const devices = await notificationService.listDevices(request.user!.id);
    return response.json(devices);
  }

  async registerDevice(request: Request, response: Response) {
    const device = await notificationService.registerDevice(request.user!.id, request.body);
    return response.status(StatusCodes.CREATED).json(device);
  }

  async unregisterDevice(request: Request, response: Response) {
    await notificationService.unregisterDevice(request.user!.id, request.body.token);
    return response.status(StatusCodes.NO_CONTENT).send();
  }

  async sendTestNotification(request: Request, response: Response) {
    const result = await notificationService.sendToUsers([request.user!.id], request.body);
    return response.status(StatusCodes.ACCEPTED).json(result);
  }
}
