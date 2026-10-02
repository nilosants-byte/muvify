import "dotenv/config";
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";

// Achado em teste manual (2026-10-01): o link de "esqueci minha senha" no
// e-mail apontava pra uma URL sem rota nenhuma por trás ("Rota nao
// encontrada.") - a API de reset sempre foi só JSON via POST, pensada pro
// app, nunca existiu uma página pro clique vindo do e-mail. Este teste
// cobre a nova página GET /api/auth/reset-password (token ausente/presente)
// e confirma que o POST JSON que o app mobile usa continua 100% intacto.

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

const createdUserIds: string[] = [];

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

describe("Página web do link de redefinição de senha", () => {
  it("GET sem token mostra a página de erro, não 'Rota nao encontrada'", async () => {
    const response = await request(app).get("/api/auth/reset-password");
    expect(response.status).toBe(400);
    expect(response.text).toContain("Link inv");
    expect(response.text).not.toContain("Rota nao encontrada");
  });

  it("GET com token presente renderiza o formulário de nova senha (não JSON cru)", async () => {
    const registered = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Teste Reset Web",
        email: `${uid("reset_web")}@test.com`,
        password: "Test1234",
        phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
        termsVersion: "2026.05",
        consentAccepted: true
      });
    createdUserIds.push(registered.body.user.id);

    const forgot = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: registered.body.user.email, channel: "EMAIL" });
    const resetToken = forgot.body.resetToken as string;
    expect(resetToken).toBeTruthy();

    const page = await request(app).get("/api/auth/reset-password").query({ token: resetToken });
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.text).toContain("Redefinir senha");
    expect(page.text).toContain(resetToken);
    expect(page.text).toContain("/api/auth/reset-password");
    // Achado em teste manual (2026-10-01): a validação em tempo real e o
    // botão nunca "acendiam" - CSP global bloqueia <script> inline. A
    // página precisa referenciar um arquivo JS próprio (mesma origem),
    // nunca JS embutido na própria página.
    expect(page.text).not.toMatch(/<script>[\s\S]*<\/script>/);
    // Achado em teste manual (2026-10-02): sem versão na URL, o navegador
    // reaproveitava uma cópia em cache do script por até 1h depois de
    // qualquer atualização de conteúdo (o header Cache-Control de longa
    // duração do arquivo é seguro exatamente porque a URL muda sozinha
    // quando o conteúdo muda).
    expect(page.text).toMatch(/<script src="\/api\/auth\/reset-password\.js\?v=[a-f0-9]{12}"><\/script>/);
    // Botões de mostrar/ocultar senha nos dois campos.
    expect(page.text).toContain('id="pwd-toggle"');
    expect(page.text).toContain('id="confirm-toggle"');
  });

  it("GET /api/auth/reset-password.js serve o script de mesma origem (respeita o CSP script-src 'self')", async () => {
    const response = await request(app).get("/api/auth/reset-password.js");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/javascript");
    expect(response.text).toContain("addEventListener('submit'");
    expect(response.text).toContain("pwd-toggle");
  });

  it("o POST JSON usado pelo app mobile continua funcionando sem nenhuma mudança", async () => {
    const registered = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Teste Reset App",
        email: `${uid("reset_app")}@test.com`,
        password: "Test1234",
        phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
        termsVersion: "2026.05",
        consentAccepted: true
      });
    createdUserIds.push(registered.body.user.id);

    const forgot = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: registered.body.user.email, channel: "EMAIL" });
    const resetToken = forgot.body.resetToken as string;

    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: resetToken, newPassword: "NovaSenha123" });
    expect(reset.status).toBe(204);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: registered.body.user.email, password: "NovaSenha123" });
    expect(login.status).toBe(200);
  });
});
