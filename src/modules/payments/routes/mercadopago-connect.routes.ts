import { Router } from "express";
import { PaymentService } from "../services/payment.service";

const paymentService = new PaymentService();

function readQueryString(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHtml(title: string, description: string, hint: string) {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeHint = escapeHtml(hint);
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      :root { color-scheme: light dark; }
      body { margin: 0; font-family: Arial, sans-serif; background: #101820; color: #f3f5f7; }
      main { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
      section { width: min(560px, 100%); border-radius: 12px; border: 1px solid #2b3a4a; background: #152232; padding: 24px; box-sizing: border-box; }
      h1 { margin: 0 0 12px; font-size: 24px; }
      p { margin: 0 0 12px; line-height: 1.5; }
      code { background: #0d1722; border: 1px solid #223446; border-radius: 6px; padding: 2px 6px; }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>${safeTitle}</h1>
        <p>${safeDescription}</p>
        <p>${safeHint}</p>
      </section>
    </main>
  </body>
</html>`;
}

export const mpConnectRoutes = Router();

mpConnectRoutes.get("/mp/return", async (request, response) => {
  const code = readQueryString(request.query.code);
  const state = readQueryString(request.query.state);
  const oauthError = readQueryString(request.query.error);
  const oauthErrorDescription = readQueryString(request.query.error_description);

  if (oauthError) {
    return response.status(400).type("html").send(
      renderHtml(
        "Falha ao conectar Mercado Pago",
        `O Mercado Pago retornou um erro: ${oauthError}.`,
        oauthErrorDescription ?? "Tente gerar um novo link de onboarding no app."
      )
    );
  }

  if (!code || !state) {
    return response.status(400).type("html").send(
      renderHtml(
        "Callback invalido",
        "Nao foi possivel concluir a conexao com o Mercado Pago.",
        "Parametros obrigatorios ausentes (code/state). Gere um novo onboarding no app."
      )
    );
  }

  try {
    const result = await paymentService.completeProviderOnboardingCallback(code, state);
    return response.status(200).type("html").send(
      renderHtml(
        "Conta Mercado Pago vinculada",
        "Conta conectada com sucesso e registrada no app.",
        `Conta conectada: ${result.mpAccountId}. Atualize o status em GET /api/payments/provider/account.`
      )
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Nao foi possivel concluir a conexao. Tente novamente.";
    return response.status(400).type("html").send(
      renderHtml(
        "Falha ao concluir conexao",
        message,
        "Gere um novo link de onboarding no app e tente novamente."
      )
    );
  }
});

mpConnectRoutes.get("/mp/refresh", (_request, response) => {
  response.status(200).type("html").send(
    renderHtml(
      "Reconectar Mercado Pago",
      "E necessario reconectar sua conta Mercado Pago.",
      "Gere um novo link de conexao em POST /api/payments/provider/account/onboarding-link."
    )
  );
});
