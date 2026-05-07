import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { AuthService } from "../services/auth.service";
const authService = new AuthService();
export class AuthController {
  async register(request: Request, response: Response) {
    const result = await authService.register(request.body);
    return response.status(StatusCodes.CREATED).json(result);
  }
  async login(request: Request, response: Response) {
    const result = await authService.login(request.body.email, request.body.password);
    return response.json(result);
  }
  async refresh(request: Request, response: Response) {
    const result = await authService.refresh(request.body.refreshToken);
    return response.json(result);
  }
  async logout(request: Request, response: Response) {
    await authService.logout(request.body.refreshToken);
    return response.status(StatusCodes.NO_CONTENT).send();
  }

  async forgotPassword(request: Request, response: Response) {
    const result = await authService.forgotPassword({
      channel: request.body.channel,
      email: request.body.email
    });
    return response.status(StatusCodes.OK).json(result);
  }

  async resetPassword(request: Request, response: Response) {
    await authService.resetPassword({
      token: request.body.token,
      newPassword: request.body.newPassword
    });
    return response.status(StatusCodes.NO_CONTENT).send();
  }

  async verifyEmail(request: Request, response: Response) {
    const token = request.query.token as string | undefined;
    if (!token) {
      return response.status(StatusCodes.BAD_REQUEST).send(buildVerificationPage(false, "Link invalido."));
    }

    try {
      await authService.verifyEmail(token);
      return response.status(StatusCodes.OK).send(buildVerificationPage(true));
    } catch {
      return response.status(StatusCodes.BAD_REQUEST).send(buildVerificationPage(false));
    }
  }

  async resendVerificationEmail(request: Request, response: Response) {
    await authService.resendVerificationEmail(request.user!.id);
    return response.status(StatusCodes.OK).json({ message: "E-mail de verificacao reenviado." });
  }
}

function buildVerificationPage(success: boolean, errorMessage?: string): string {
  if (success) {
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>E-mail verificado — Muvify</title><style>body{margin:0;padding:0;background:#f0f0f0;font-family:'Helvetica Neue',Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;}.card{background:#fff;border-radius:14px;padding:48px 36px;max-width:420px;width:90%;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.10);}.icon{font-size:56px;margin-bottom:16px;}.title{font-size:22px;font-weight:700;color:#111827;margin-bottom:12px;}.msg{font-size:15px;color:#6b7280;line-height:1.6;}.logo{margin-top:32px;font-size:22px;font-weight:800;letter-spacing:3px;color:#4CAF50;text-transform:uppercase;}</style></head><body><div class="card"><div class="icon">&#10003;</div><div class="title">E-mail confirmado!</div><p class="msg">Sua conta no Muvify est&aacute; ativa. Voc&ecirc; j&aacute; pode usar o aplicativo normalmente.</p><div class="logo">muvify</div></div></body></html>`;
  }
  const msg = errorMessage ?? "Este link de verifica&ccedil;&atilde;o &eacute; inv&aacute;lido ou j&aacute; expirou. Abra o aplicativo e solicite um novo link.";
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Link invalido — Muvify</title><style>body{margin:0;padding:0;background:#f0f0f0;font-family:'Helvetica Neue',Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;}.card{background:#fff;border-radius:14px;padding:48px 36px;max-width:420px;width:90%;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.10);}.icon{font-size:56px;margin-bottom:16px;}.title{font-size:22px;font-weight:700;color:#111827;margin-bottom:12px;}.msg{font-size:15px;color:#6b7280;line-height:1.6;}.logo{margin-top:32px;font-size:22px;font-weight:800;letter-spacing:3px;color:#4CAF50;text-transform:uppercase;}</style></head><body><div class="card"><div class="icon">&#9888;</div><div class="title">Link inv&aacute;lido</div><p class="msg">${msg}</p><div class="logo">muvify</div></div></body></html>`;
}
