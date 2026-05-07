import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../shared/errors/app-error";
import { verifyUserPhotoSignature } from "../../../shared/utils/user-photo-signature";
import { UserService } from "../services/user.service";

const userService = new UserService();

export class UserController {
  async streamPhoto(request: Request, response: Response) {
    if (
      !verifyUserPhotoSignature({
        userId: request.params.userId,
        exp: request.query.exp as string | undefined,
        sig: request.query.sig as string | undefined
      })
    ) {
      throw new AppError("Assinatura de acesso a foto invalida.", StatusCodes.FORBIDDEN);
    }

    const { buffer, mimeType } = await userService.getPhotoById(request.params.userId);
    response.setHeader("Content-Type", mimeType);
    response.setHeader("Content-Length", String(buffer.length));
    response.setHeader("Cache-Control", "private, max-age=300");
    return response.status(StatusCodes.OK).send(buffer);
  }

  async me(request: Request, response: Response) {
    const user = await userService.getMe(request.user!.id);
    return response.json(user);
  }

  async updateMe(request: Request, response: Response) {
    const user = await userService.updateMe(request.user!.id, request.body);
    return response.json(user);
  }

  async getProviderBankAccount(request: Request, response: Response) {
    const bankAccount = await userService.getProviderBankAccount(request.user!.id);
    return response.json(bankAccount);
  }

  async upsertProviderBankAccount(request: Request, response: Response) {
    const bankAccount = await userService.upsertProviderBankAccount(request.user!.id, request.body);
    return response.json(bankAccount);
  }

  async getMyAnamnesis(request: Request, response: Response) {
    const anamnesis = await userService.getMyAnamnesis(request.user!.id);
    return response.json(anamnesis);
  }

  async upsertMyAnamnesis(request: Request, response: Response) {
    const anamnesis = await userService.upsertMyAnamnesis(request.user!.id, request.body);
    return response.json(anamnesis);
  }

  async changeMyPassword(request: Request, response: Response) {
    const result = await userService.changeMyPassword(request.user!.id, request.body);
    return response.json(result);
  }

  async getRecoveryEmail(request: Request, response: Response) {
    const result = await userService.getRecoveryEmail(request.user!.id);
    return response.json(result);
  }

  async upsertRecoveryEmail(request: Request, response: Response) {
    const result = await userService.upsertRecoveryEmail(request.user!.id, request.body);
    return response.json(result);
  }

  async sendSupportMessage(request: Request, response: Response) {
    const result = await userService.sendSupportMessage(request.user!.id, request.body);
    return response.json(result);
  }

  async deleteMe(request: Request, response: Response) {
    await userService.deleteMe(request.user!.id);
    return response.status(204).send();
  }

  async exportMyData(request: Request, response: Response) {
    const data = await userService.exportMyData(request.user!.id);
    return response.json(data);
  }

  async recordConsent(request: Request, response: Response) {
    const result = await userService.recordConsent(request.user!.id, request.body);
    return response.json(result);
  }

  async getNotificationPreferences(request: Request, response: Response) {
    const result = await userService.getNotificationPreferences(request.user!.id);
    return response.json(result);
  }

  async upsertNotificationPreferences(request: Request, response: Response) {
    const result = await userService.upsertNotificationPreferences(request.user!.id, request.body.preferences);
    return response.json(result);
  }
}
