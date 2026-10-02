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

  // Arquivo JS próprio da página acima, servido de mesma origem pra
  // respeitar o CSP global (script-src 'self', sem 'unsafe-inline').
  renderResetPasswordPageScript(_request: Request, response: Response) {
    response.setHeader("Cache-Control", "public, max-age=3600");
    return response.status(StatusCodes.OK).type("application/javascript").send(RESET_PASSWORD_PAGE_SCRIPT);
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
//
// Achado em teste manual (2026-10-01): a validação em tempo real e o
// botão de enviar nunca "acendiam" - o CSP global (scriptSrc: ["'self'"],
// ver app.ts) bloqueia QUALQUER <script> inline, e esta foi a primeira
// página deste backend a tentar usar JS embutido na própria página (as
// páginas de verificação de e-mail, mais antigas, nunca precisaram de JS -
// são só HTML com um <form> nativo). O script precisa vir de um arquivo
// próprio, de mesma origem (GET /auth/reset-password.js abaixo), que o
// CSP já permite sem precisar afrouxar a política em nada.
// Mesmos ícones Ionicons (eye-outline / eye-off-outline) usados no app
// (ver mobile-app/src/components/mv/MvInput.tsx) - achado em teste manual
// (2026-10-02): a versão anterior usava emoji (👁/🙈), inconsistente com o
// resto do produto. SVG embutido porque esta página não tem acesso à
// fonte de ícones do app (é HTML puro, fora do React Native); path
// copiado direto da fonte oficial do ícone (ionicons, MIT) pra garantir
// que é visualmente idêntico, não uma aproximação.
const EYE_ICON_SVG =
  '<svg viewBox="0 0 512 512" width="20" height="20" fill="none" stroke="currentColor" stroke-width="32" stroke-linecap="round" stroke-linejoin="round"><path d="M255.66,112c-77.94,0-157.89,45.11-220.83,135.33a16,16,0,0,0-.27,17.77C82.92,340.8,161.8,400,255.66,400,348.5,400,429,340.62,477.45,264.75a16.14,16.14,0,0,0,0-17.47C428.89,172.28,347.8,112,255.66,112Z"/><circle cx="256" cy="256" r="80" stroke-miterlimit="10"/></svg>';
const EYE_OFF_ICON_SVG =
  '<svg viewBox="0 0 512 512" width="20" height="20" fill="currentColor"><path d="M432,448a15.92,15.92,0,0,1-11.31-4.69l-352-352A16,16,0,0,1,91.31,68.69l352,352A16,16,0,0,1,432,448Z"/><path d="M255.66,384c-41.49,0-81.5-12.28-118.92-36.5-34.07-22-64.74-53.51-88.7-91l0-.08c19.94-28.57,41.78-52.73,65.24-72.21a2,2,0,0,0,.14-2.94L93.5,161.38a2,2,0,0,0-2.71-.12c-24.92,21-48.05,46.76-69.08,76.92a31.92,31.92,0,0,0-.64,35.54c26.41,41.33,60.4,76.14,98.28,100.65C162,402,207.9,416,255.66,416a239.13,239.13,0,0,0,75.8-12.58,2,2,0,0,0,.77-3.31l-21.58-21.58a4,4,0,0,0-3.83-1A204.8,204.8,0,0,1,255.66,384Z"/><path d="M490.84,238.6c-26.46-40.92-60.79-75.68-99.27-100.53C349,110.55,302,96,255.66,96a227.34,227.34,0,0,0-74.89,12.83,2,2,0,0,0-.75,3.31l21.55,21.55a4,4,0,0,0,3.88,1A192.82,192.82,0,0,1,255.66,128c40.69,0,80.58,12.43,118.55,37,34.71,22.4,65.74,53.88,89.76,91a.13.13,0,0,1,0,.16,310.72,310.72,0,0,1-64.12,72.73,2,2,0,0,0-.15,2.95l19.9,19.89a2,2,0,0,0,2.7.13,343.49,343.49,0,0,0,68.64-78.48A32.2,32.2,0,0,0,490.84,238.6Z"/><path d="M256,160a95.88,95.88,0,0,0-21.37,2.4,2,2,0,0,0-1,3.38L346.22,278.34a2,2,0,0,0,3.38-1A96,96,0,0,0,256,160Z"/><path d="M165.78,233.66a2,2,0,0,0-3.38,1,96,96,0,0,0,115,115,2,2,0,0,0,1-3.38Z"/></svg>';

function buildResetPasswordPage(input: { token?: string; error?: string }): string {
  const styles = `body{margin:0;padding:0;background:#f0f0f0;font-family:'Helvetica Neue',Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;}.card{background:#fff;border-radius:14px;padding:40px 36px;max-width:420px;width:90%;box-shadow:0 4px 16px rgba(0,0,0,0.10);}.icon{font-size:48px;margin-bottom:12px;text-align:center;}.title{font-size:22px;font-weight:700;color:#111827;margin-bottom:10px;text-align:center;}.msg{font-size:14px;color:#6b7280;line-height:1.6;margin-bottom:20px;text-align:center;}label{display:block;font-size:13px;font-weight:600;color:#374151;margin:16px 0 6px;}.pwd-wrap{position:relative;}.pwd-wrap input[type=password],.pwd-wrap input[type=text]{width:100%;box-sizing:border-box;padding:12px 44px 12px 14px;border:1px solid #e5e7eb;border-radius:8px;font-size:15px;}.pwd-wrap input:focus{outline:none;border-color:#4CAF50;}.pwd-toggle{position:absolute;right:4px;top:4px;bottom:4px;width:40px;background:none;border:none;cursor:pointer;color:#9ca3af;font-size:18px;display:flex;align-items:center;justify-content:center;}.criteria{list-style:none;padding:0;margin:14px 0 0;font-size:13px;}.criteria li{padding:3px 0;color:#9ca3af;}.btn{display:block;width:100%;background:#4CAF50;color:#fff;border:none;border-radius:10px;padding:14px 20px;font-size:15px;font-weight:700;cursor:pointer;margin-top:22px;}.btn:disabled{background:#d1d5db;cursor:not-allowed;}.error{display:none;background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:8px;padding:10px 14px;font-size:13px;margin-top:16px;}.logo{margin-top:28px;font-size:22px;font-weight:800;letter-spacing:3px;color:#4CAF50;text-transform:uppercase;text-align:center;}`;

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
    <div class="pwd-wrap">
      <input type="password" id="pwd" autocomplete="new-password" required>
      <button type="button" class="pwd-toggle" id="pwd-toggle" aria-label="Mostrar senha">${EYE_ICON_SVG}</button>
    </div>
    <label for="confirm">Confirmar nova senha</label>
    <div class="pwd-wrap">
      <input type="password" id="confirm" autocomplete="new-password" required>
      <button type="button" class="pwd-toggle" id="confirm-toggle" aria-label="Mostrar senha">${EYE_ICON_SVG}</button>
    </div>
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
<script src="/api/auth/reset-password.js"></script>
</body></html>`;
}

// Arquivo JS próprio (mesma origem), em vez de <script> inline - o CSP
// global (script-src 'self', sem 'unsafe-inline') bloquearia um <script>
// embutido na página sem nenhum aviso visível. Ver comentário acima de
// buildResetPasswordPage.
const RESET_PASSWORD_PAGE_SCRIPT = `(function () {
  var pwd = document.getElementById('pwd');
  var confirm = document.getElementById('confirm');
  var submitBtn = document.getElementById('submit');
  var errorBox = document.getElementById('error');
  var form = document.getElementById('f');

  var EYE_ICON = '${EYE_ICON_SVG}';
  var EYE_OFF_ICON = '${EYE_OFF_ICON_SVG}';

  function setupToggle(toggleId, inputEl) {
    var toggle = document.getElementById(toggleId);
    toggle.innerHTML = EYE_ICON;
    toggle.addEventListener('click', function () {
      var showing = inputEl.type === 'text';
      inputEl.type = showing ? 'password' : 'text';
      toggle.setAttribute('aria-label', showing ? 'Mostrar senha' : 'Ocultar senha');
      toggle.innerHTML = showing ? EYE_ICON : EYE_OFF_ICON;
    });
  }
  setupToggle('pwd-toggle', pwd);
  setupToggle('confirm-toggle', confirm);

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
`;
