import { Router } from "express";
import fs from "fs";
import path from "path";
import { marked } from "marked";
import { waitlistRateLimiter } from "../../middlewares/rate-limit.middleware";
import { waitlistSignupSchema } from "./validators/waitlist.validator";
import { WaitlistService } from "./services/waitlist.service";
import { renderWaitlistPage, WAITLIST_CSS } from "./templates/waitlist-page.template";

// Frente 17 (segunda camada, prontidão de lançamento): política de privacidade e
// exclusão de conta precisam de URL pública acessível sem instalar o app —
// exigência das duas lojas (Google Play desde 2023, Apple App Store). Servidas
// aqui a partir do próprio backend em vez de um site novo, porque o conteúdo já
// existe em markdown em docs/ e não há domínio/hospedagem dedicada ainda — assim
// que um domínio apontar para este backend, essas rotas já funcionam.
export const publicRoutes = Router();

const docsDir = path.join(__dirname, "..", "..", "..", "docs");

const LEGAL_CSS = `
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.6;
    max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; color: #1a1a1a; background: #fff; }
  h1, h2, h3 { line-height: 1.3; }
  h1 { font-size: 1.7rem; }
  h2 { font-size: 1.3rem; margin-top: 2em; }
  h3 { font-size: 1.1rem; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.92rem; }
  th, td { border: 1px solid #ddd; padding: 8px 10px; text-align: left; }
  th { background: #f5f5f5; }
  code { background: #f0f0f0; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; }
  a { color: #0a6b3d; }
  @media (prefers-color-scheme: dark) {
    body { background: #14161a; color: #e6e6e6; }
    th { background: #1f2329; }
    th, td { border-color: #333; }
    code { background: #23262c; }
    a { color: #4ee79a; }
  }
`;

function renderLegalPage(title: string, markdown: string): string {
  const body = marked.parse(markdown, { async: false }) as string;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — Muvify</title>
<link rel="stylesheet" href="/legal.css" />
</head>
<body>
${body}
</body>
</html>`;
}

publicRoutes.get("/legal.css", (_request, response) => {
  response.type("text/css").send(LEGAL_CSS);
});

publicRoutes.get("/privacidade", (_request, response) => {
  const markdown = fs.readFileSync(path.join(docsDir, "POLITICA-DE-PRIVACIDADE-v1.md"), "utf-8");
  response.type("html").send(renderLegalPage("Política de Privacidade", markdown));
});

publicRoutes.get("/excluir-conta", (_request, response) => {
  const markdown = fs.readFileSync(path.join(docsDir, "EXCLUSAO-DE-CONTA-PUBLICO.md"), "utf-8");
  response.type("html").send(renderLegalPage("Excluir conta", markdown));
});

const waitlistService = new WaitlistService();

publicRoutes.get("/waitlist.css", (_request, response) => {
  response.type("text/css").send(WAITLIST_CSS);
});

// Domínio próprio (muvify.com.br) não tem homepage dedicada ainda — quem
// digitar o endereço puro, sem caminho, cai direto na lista de espera em vez
// do 404 genérico da API.
publicRoutes.get("/", (_request, response) => {
  response.redirect(302, "/lista-espera");
});

// Lista de espera pré-lançamento. GET renderiza a página (form/sucesso/erro
// conforme os query params ?ok=1 / ?erro=1 setados pelo redirect do POST
// abaixo); POST recebe o cadastro. utm_source flui da URL do vídeo do
// YouTube (?utm_source=<video>) pro form via campo oculto, sem precisar de
// JS, pra depois saber qual vídeo converteu mais.
publicRoutes.get("/lista-espera", async (request, response) => {
  const count = await waitlistService.countForSocialProof();
  const utmSource = typeof request.query.utm_source === "string" ? request.query.utm_source : undefined;
  const state = request.query.ok === "1" ? "success" : request.query.erro ? "error" : "form";
  response.type("html").send(renderWaitlistPage({ count, utmSource, state }));
});

// safeParse (não o middleware `validate` padrão) de propósito: essa rota é
// um form HTML puro sem JS, então uma falha de validação precisa
// redirecionar de volta pra página com uma mensagem amigável, não devolver
// o JSON de erro genérico do errorMiddleware pra quem só preencheu um
// campo errado.
publicRoutes.post("/waitlist", waitlistRateLimiter, async (request, response) => {
  const parsed = waitlistSignupSchema.safeParse({ body: request.body });
  if (!parsed.success) {
    return response.redirect(303, "/lista-espera?erro=1");
  }
  try {
    await waitlistService.signup(parsed.data.body);
    return response.redirect(303, "/lista-espera?ok=1");
  } catch (error) {
    console.error("Waitlist signup failed:", error);
    return response.redirect(303, "/lista-espera?erro=1");
  }
});
