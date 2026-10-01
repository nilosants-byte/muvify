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

  // Achado em teste manual (2026-10-01): o link de "esqueci minha senha"
  // no e-mail apontava pra uma URL sem nenhuma página por trás (API
  // sempre foi só JSON, via POST, pensada pro app - nunca existiu GET
  // nenhum aqui) - clicar no link sempre caía em "Rota nao encontrada.".
  // Página nova, mesmo padrão visual de verifyEmail/confirmVerifyEmail
  // acima, mas sem o split GET-mostra/POST-consome daquele fluxo: aqui
  // não faz sentido um scanner de e-mail "consumir" nada só com GET, já
  // que a ação sensível (trocar a senha) exige uma senha nova digitada
  // por um humano, que nenhum scanner automático vai preencher. O
  // formulário envia via fetch() pro MESMO endpoint JSON que o app usa
  // (POST /api/auth/reset-password, intocado) - zero risco pro fluxo do
  // app.
  async renderResetPasswordPage(request: Request, response: Response) {
    const token = request.query.token as string | undefined;
    if (!token) {
      return response
        .status(StatusCodes.BAD_REQUEST)
        .send(buildResetPasswordPage({ error: "Link invalido. Solicite uma nova redefinicao de senha pelo aplicativo." }));
    }
    return response.status(StatusCodes.OK).send(buildResetPasswordPage({ token }));
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

// Página do link "Esqueci minha senha" — formulário envia via fetch() pro
// mesmo POST /api/auth/reset-password que o app mobile já usa (JSON,
// intocado), então não existe risco de quebrar o fluxo do app.
function buildResetPasswordPage(input: { token?: string; error?: string }): string {
  const styles = `body{margin:0;padding:0;background:#f0f0f0;font-family:'Helvetica Neue',Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;}.card{background:#fff;border-radius:14px;padding:40px 36px;max-width:420px;width:90%;box-shadow:0 4px 16px rgba(0,0,0,0.10);}.icon{font-size:48px;margin-bottom:12px;text-align:center;}.title{font-size:22px;font-weight:700;color:#111827;margin-bottom:10px;text-align:center;}.msg{font-size:14px;color:#6b7280;line-height:1.6;margin-bottom:20px;text-align:center;}label{display:block;font-size:13px;font-weight:600;color:#374151;margin:16px 0 6px;}input[type=password]{width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #e5e7eb;border-radius:8px;font-size:15px;}input[type=password]:focus{outline:none;border-color:#4CAF50;}.criteria{list-style:none;padding:0;margin:14px 0 0;font-size:13px;}.criteria li{padding:3px 0;color:#9ca3af;}.btn{display:block;width:100%;background:#4CAF50;color:#fff;border:none;border-radius:10px;padding:14px 20px;font-size:15px;font-weight:700;cursor:pointer;margin-top:22px;}.btn:disabled{background:#d1d5db;cursor:not-allowed;}.error{display:none;background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:8px;padding:10px 14px;font-size:13px;margin-top:16px;}.logo{margin-top:28px;font-size:22px;font-weight:800;letter-spacing:3px;color:#4CAF50;text-transform:uppercase;text-align:center;}`;

  if (!input.token) {
    const msg = input.error ?? "Link invalido ou expirado. Abra o aplicativo e solicite um novo link.";
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Link invalido — Muvify</title><style>${styles}</style></head><body><div class="card"><div class="icon">&#9888;</div><div class="title">Link inv&aacute;lido</div><p class="msg">${msg}</p><div class="logo">muvify</div></div></body></html>`;
  }

  const safeToken = escapeHtmlAttribute(input.token);
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Redefinir senha — Muvify</title><style>${styles}</style></head><body>
<div class="card" id="form-card">
  <div class="icon">&#128274;</div>
  <div class="title">Redefinir senha</div>
  <p class="msg">Escolha uma nova senha para sua conta no Muvify.</p>
  <form id="f">
    <input type="hidden" name="token" value="${safeToken}">
    <label for="pwd">Nova senha</label>
    <input type="password" id="pwd" autocomplete="new-password" required>
    <label for="confirm">Confirmar nova senha</label>
    <input type="password" id="confirm" autocomplete="new-password" required>
    <ul class="criteria">
      <li id="c-len" data-label="Pelo menos 8 caracteres">&#9675; Pelo menos 8 caracteres</li>
      <li id="c-letter" data-label="Pelo menos uma letra">&#9675; Pelo menos uma letra</li>
      <li id="c-digit" data-label="Pelo menos um numero">&#9675; Pelo menos um n&uacute;mero</li>
      <li id="c-match" data-label="Senhas coincidem">&#9675; Senhas coincidem</li>
    </ul>
    <div class="error" id="error"></div>
    <button type="submit" class="btn" id="submit" disabled>Redefinir minha senha</button>
  </form>
  <div class="logo">muvify</div>
</div>
<div class="card" id="success-card" style="display:none;text-align:center;">
  <div class="icon">&#10003;</div>
  <div class="title">Senha redefinida!</div>
  <p class="msg">Sua senha foi alterada com sucesso. Volte ao aplicativo Muvify e fa&ccedil;a login com a nova senha.</p>
  <div class="logo">muvify</div>
</div>
<script>
(function () {
  var pwd = document.getElementById('pwd');
  var confirm = document.getElementById('confirm');
  var submitBtn = document.getElementById('submit');
  var errorBox = document.getElementById('error');
  var form = document.getElementById('f');

  function setCheck(id, ok) {
    var el = document.getElementById(id);
    el.innerHTML = (ok ? '&#10003; ' : '&#9675; ') + el.getAttribute('data-label');
    el.style.color = ok ? '#16a34a' : '#9ca3af';
    return ok;
  }

  function render() {
    var v = pwd.value;
    var c = confirm.value;
    var lenOk = setCheck('c-len', v.length >= 8);
    var letterOk = setCheck('c-letter', /[A-Za-z]/.test(v));
    var digitOk = setCheck('c-digit', /\\d/.test(v));
    var matchOk = setCheck('c-match', v.length > 0 && v === c);
    submitBtn.disabled = !(lenOk && letterOk && digitOk && matchOk);
  }

  pwd.addEventListener('input', render);
  confirm.addEventListener('input', render);
  render();

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorBox.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando...';
    fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: form.token.value, newPassword: pwd.value })
    }).then(function (res) {
      if (res.ok) {
        document.getElementById('form-card').style.display = 'none';
        document.getElementById('success-card').style.display = 'block';
        return;
      }
      return res.json().catch(function () { return {}; }).then(function (data) {
        errorBox.textContent = data.message || 'Nao foi possivel redefinir sua senha. O link pode ter expirado - solicite um novo pelo aplicativo.';
        errorBox.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Redefinir minha senha';
      });
    }).catch(function () {
      errorBox.textContent = 'Falha de conexao. Verifique sua internet e tente novamente.';
      errorBox.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Redefinir minha senha';
    });
  });
})();
</script>
</body></html>`;
}
