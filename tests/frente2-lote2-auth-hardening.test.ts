import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";

// Épico de Frentes, Frente 2 (Segurança do código), Lote 2:
// (1) login roda o mesmo custo de bcrypt.compare tanto pra e-mail
//     inexistente quanto pra senha errada (timing side-channel fechado).
// (2) forgotPassword paga o mesmo custo mínimo nos ramos que retornam cedo.
// (3) senhas comuns são recusadas no registro/troca/reset.

const PASSWORD = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

describe("Frente 2, Lote 2 — endurecimento de autenticação", () => {
  let userId = "";
  let userEmail = "";

  beforeAll(async () => {
    await prisma.$connect();
    userEmail = `${uid("f2l2_user")}@test.com`;
    const reg = await request(app).post("/api/auth/register").send({
      name: "Lote Dois Auth",
      email: userEmail,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}1`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    userId = reg.body.user.id;
  });

  afterAll(async () => {
    await prisma.passwordResetToken.deleteMany({ where: { userId } });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("login com e-mail inexistente continua rejeitando com 401 (regressão funcional após equalizar timing)", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: `${uid("nunca_existiu")}@test.com`, password: "QualquerSenha123" });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/credenciais/i);
  });

  it("login com senha errada continua rejeitando com 401", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: userEmail, password: "SenhaErrada9999" });
    expect(res.status).toBe(401);
  });

  it("login com credenciais certas continua funcionando", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: userEmail, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it("forgotPassword com e-mail inexistente continua respondendo 200 com mensagem genérica", async () => {
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ channel: "EMAIL", email: `${uid("nunca_existiu2")}@test.com` });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain("Se o e-mail existir");
    expect(res.body.resetToken).toBeUndefined();
  });

  it("forgotPassword com e-mail existente continua gerando resetToken normalmente", async () => {
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ channel: "EMAIL", email: userEmail });
    expect(res.status).toBe(200);
    expect(res.body.resetToken).toBeTruthy();

    const tokenRecord = await prisma.passwordResetToken.findFirst({
      where: { userId },
      orderBy: { expiresAt: "desc" }
    });
    expect(tokenRecord).not.toBeNull();
  });

  it("registro rejeita senha comum (senha1234)", async () => {
    const res = await request(app).post("/api/auth/register").send({
      name: "Senha Fraca",
      email: `${uid("senha_fraca")}@test.com`,
      password: "senha1234",
      phone: `11${Date.now().toString().slice(-9)}2`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    expect(res.status).toBe(400);
  });

  it("registro aceita senha forte normal (não está na lista de comuns)", async () => {
    const email = `${uid("senha_forte")}@test.com`;
    const res = await request(app).post("/api/auth/register").send({
      name: "Senha Forte",
      email,
      password: "Xk9mQp2vLr7z",
      phone: `11${Date.now().toString().slice(-9)}3`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    expect(res.status).toBe(201);
    await prisma.session.deleteMany({ where: { userId: res.body.user.id } });
    await prisma.user.deleteMany({ where: { id: res.body.user.id } });
  });

  it("reset-password rejeita nova senha comum (password123)", async () => {
    const forgot = await request(app)
      .post("/api/auth/forgot-password")
      .send({ channel: "EMAIL", email: userEmail });
    const resetToken = forgot.body.resetToken as string;

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: resetToken, newPassword: "password123" });
    expect(res.status).toBe(400);
  });
});
