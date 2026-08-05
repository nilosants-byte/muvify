import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { AuthService } from "../services/auth.service";
import { TwoFactorService } from "../services/two-factor.service";
import { resolveDeviceLabel } from "./auth.controller";

const authService = new AuthService();
const twoFactorService = new TwoFactorService();

export class TwoFactorController {
  async setup(request: Request, response: Response) {
    const result = await twoFactorService.setup(request.user!.id);
    return response.status(StatusCodes.OK).json(result);
  }

  async confirm(request: Request, response: Response) {
    const result = await twoFactorService.confirm(request.user!.id, request.body.code);
    return response.status(StatusCodes.OK).json({
      message: "Autenticação em dois fatores ativada com sucesso.",
      backupCodes: result.backupCodes
    });
  }

  async disable(request: Request, response: Response) {
    await twoFactorService.disable(request.user!.id, request.body.password, request.body.code);
    return response.status(StatusCodes.OK).json({
      message: "Autenticação em dois fatores desativada."
    });
  }

  async loginWithTwoFactor(request: Request, response: Response) {
    const result = await authService.loginWithTwoFactor(
      request.body.challengeToken,
      request.body.code,
      request.body.backupCode,
      resolveDeviceLabel(request)
    );
    return response.status(StatusCodes.OK).json(result);
  }
}
