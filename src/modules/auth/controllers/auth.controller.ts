import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { AuthService } from "../services/auth.service";
const authService = new AuthService();
// Tela "Meus aparelhos conectados": prefere um nome de aparelho legível
// (enviado pelo app via X-Device-Label, mesma fonte do registro de push)
// sobre o User-Agent técnico cru, que em apps nativos costuma ser curto e
// pouco informativo (ex: "okhttp/4.x").
export function resolveDeviceLabel(request: Request): string | undefined {
  const deviceLabel = request.headers["x-device-label"];
  if (typeof deviceLabel === "string" && deviceLabel.trim()) return deviceLabel.trim();
  return typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : undefined;
}

export class AuthController {
  async register(request: Request, response: Response) {
    const result = await authService.register({
      ...request.body,
      ip: request.ip,
      userAgent: resolveDeviceLabel(request)
    });
    return response.status(StatusCodes.CREATED).json(result);
  }
  async login(request: Request, response: Response) {
    const result = await authService.login(request.body.email, request.body.password, resolveDeviceLabel(request));
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

  // Frente 8 (segunda camada), Lote 5: este GET antes consumia o token na
  // primeira requisição — mas gateways corporativos de e-mail pré-buscam
  // automaticamente todo link recebido pra escaneá-lo (Microsoft Safe
  // Links, Google Workspace etc.), consumindo o token antes do clique real
  // do usuário. Agora só valida (sem marcar como usado) e renderiza uma
  // página de confirmação com um botão — o consumo de verdade só acontece
  // no POST abaixo, disparado por um clique real (scanners não submetem
  // formulários).
  async verifyEmail(request: Request, response: Response) {
    const token = request.query.token as string | undefined;
    if (!token) {
      return response.status(StatusCodes.BAD_REQUEST).send(buildVerificationPage(false, "Link invalido."));
    }

    const valid = await authService.checkVerificationTokenValid(token);
    if (!valid) {
      return response.status(StatusCodes.BAD_REQUEST).send(buildVerificationPage(false));
    }
    return response.status(StatusCodes.OK).send(buildConfirmPage(token));
  }

  async confirmVerifyEmail(request: Request, response: Response) {
    const token = request.body.token as string;
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

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Frente 8 (segunda camada), Lote 5: página intermediária — o token só é
// consumido quando o próprio usuário clica no botão (POST real), não na
// primeira requisição GET (vulnerável a pré-busca automática de scanner).
function buildConfirmPage(token: string): string {
  const safeToken = escapeHtmlAttribute(token);
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Confirmar e-mail — Muvify</title><style>body{margin:0;padding:0;background:#f0f0f0;font-family:'Helvetica Neue',Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;}.card{background:#fff;border-radius:14px;padding:48px 36px;max-width:420px;width:90%;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.10);}.icon{font-size:56px;margin-bottom:16px;}.title{font-size:22px;font-weight:700;color:#111827;margin-bottom:12px;}.msg{font-size:15px;color:#6b7280;line-height:1.6;margin-bottom:24px;}.btn{display:inline-block;width:100%;background:#4CAF50;color:#fff;border:none;border-radius:10px;padding:14px 20px;font-size:15px;font-weight:700;cursor:pointer;}.logo{margin-top:32px;font-size:22px;font-weight:800;letter-spacing:3px;color:#4CAF50;text-transform:uppercase;}</style></head><body><div class="card"><div class="icon">&#9993;</div><div class="title">Confirmar seu e-mail</div><p class="msg">Toque no bot&atilde;o abaixo pra confirmar que este e-mail &eacute; seu e ativar sua conta no Muvify.</p><form method="POST"><input type="hidden" name="token" value="${safeToken}"><button type="submit" class="btn">Confirmar meu e-mail</button></form><div class="logo">muvify</div></div></body></html>`;
}

function buildVerificationPage(success: boolean, errorMessage?: string): string {
  if (success) {
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>E-mail verificado — Muvify</title><style>body{margin:0;padding:0;background:#f0f0f0;font-family:'Helvetica Neue',Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;}.card{background:#fff;border-radius:14px;padding:48px 36px;max-width:420px;width:90%;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.10);}.icon{font-size:56px;margin-bottom:16px;}.title{font-size:22px;font-weight:700;color:#111827;margin-bottom:12px;}.msg{font-size:15px;color:#6b7280;line-height:1.6;}.logo{margin-top:32px;font-size:22px;font-weight:800;letter-spacing:3px;color:#4CAF50;text-transform:uppercase;}</style></head><body><div class="card"><div class="icon">&#10003;</div><div class="title">E-mail confirmado!</div><p class="msg">Sua conta no Muvify est&aacute; ativa. Voc&ecirc; j&aacute; pode usar o aplicativo normalmente.</p><div class="logo">muvify</div></div></body></html>`;
  }
  const msg = errorMessage ?? "Este link de verifica&ccedil;&atilde;o &eacute; inv&aacute;lido ou j&aacute; expirou. Abra o aplicativo e solicite um novo link.";
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Link invalido — Muvify</title><style>body{margin:0;padding:0;background:#f0f0f0;font-family:'Helvetica Neue',Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;}.card{background:#fff;border-radius:14px;padding:48px 36px;max-width:420px;width:90%;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.10);}.icon{font-size:56px;margin-bottom:16px;}.title{font-size:22px;font-weight:700;color:#111827;margin-bottom:12px;}.msg{font-size:15px;color:#6b7280;line-height:1.6;}.logo{margin-top:32px;font-size:22px;font-weight:800;letter-spacing:3px;color:#4CAF50;text-transform:uppercase;}</style></head><body><div class="card"><div class="icon">&#9888;</div><div class="title">Link inv&aacute;lido</div><p class="msg">${msg}</p><div class="logo">muvify</div></div></body></html>`;
}
