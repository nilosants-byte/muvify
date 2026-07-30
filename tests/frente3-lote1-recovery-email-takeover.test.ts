import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { EmailService } from "../src/shared/services/email.service";

// Épico de Frentes, Frente 3 (Cadastro/onboarding), Lote 1:
// (1) trocar recovery-email exige a senha atual (fecha o vetor de sequestro
//     de conta via forgotPassword(channel: RECOVERY_EMAIL)).
// (2) o aviso da troca vai também pro e-mail de login real, não só pro novo.
// (3) recovery-email não pode ser igual ao próprio e-mail de login nem já
//     ser o e-mail de login de outra conta.
// (4) resetPassword via token blacklista o access token já emitido.

const PASSWORD = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Frente 3, Lote 1 — troca de e-mail de recuperação exige senha", () => {
  let token = "";
  let userId = "";
  let userEmail = "";
  let otherUserId = "";
  let otherEmail = "";

  beforeAll(async () => {
    await prisma.$connect();
    userEmail = `${uid("f3l1_user")}@test.com`;
    const reg = await request(app).post("/api/auth/register").send({
      name: "Frente Tres Lote Um",
      email: userEmail,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}1`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    token = reg.body.accessToken;
    userId = reg.body.user.id;

    otherEmail = `${uid("f3l1_other")}@test.com`;
    const regOther = await request(app).post("/api/auth/register").send({
      name: "Frente Tres Outro",
      email: otherEmail,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}2`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    otherUserId = regOther.body.user.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.session.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  it("rejeita trocar recovery-email sem informar a senha atual (regressão do sequestro de conta)", async () => {
    const res = await request(app)
      .put("/api/users/me/security/recovery-email")
      .set("Authorization", `Bearer ${token}`)
      .send({ recoveryEmail: `atacante_${uid("evil")}@test.com` });
    expect(res.status).toBe(400);
  });

  it("rejeita trocar recovery-email com a senha errada", async () => {
    const res = await request(app)
      .put("/api/users/me/security/recovery-email")
      .set("Authorization", `Bearer ${token}`)
      .send({ recoveryEmail: `atacante_${uid("evil")}@test.com`, password: "SenhaErrada9999" });
    expect(res.status).toBe(400);
  });

  it("rejeita recovery-email igual ao próprio e-mail de login", async () => {
    const res = await request(app)
      .put("/api/users/me/security/recovery-email")
      .set("Authorization", `Bearer ${token}`)
      .send({ recoveryEmail: userEmail, password: PASSWORD });
    expect(res.status).toBe(400);
  });

  it("rejeita recovery-email que já é o e-mail de login de outra conta", async () => {
    const res = await request(app)
      .put("/api/users/me/security/recovery-email")
      .set("Authorization", `Bearer ${token}`)
      .send({ recoveryEmail: otherEmail, password: PASSWORD });
    expect(res.status).toBe(400);
  });

  it("com a senha certa, troca com sucesso e avisa tanto o e-mail novo quanto o e-mail de login real", async () => {
    vi.spyOn(EmailService.prototype, "canSendEmail").mockReturnValue(true);
    const sendSpy = vi.spyOn(EmailService.prototype, "sendRecoveryEmailUpdated").mockResolvedValue();

    const newRecoveryEmail = `recovery_${uid("ok")}@test.com`;
    const res = await request(app)
      .put("/api/users/me/security/recovery-email")
      .set("Authorization", `Bearer ${token}`)
      .send({ recoveryEmail: newRecoveryEmail, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.recoveryEmail).toBe(newRecoveryEmail);

    // Espera as duas notificações fire-and-forget serem disparadas.
    await sleep(50);
    const recipients = sendSpy.mock.calls.map((call) => call[0].to);
    expect(recipients).toContain(newRecoveryEmail);
    expect(recipients).toContain(userEmail);
  });
});

describe("Frente 3, Lote 1 — resetPassword blacklista o access token já emitido", () => {
  let userId = "";
  let userEmail = "";

  beforeAll(async () => {
    await prisma.$connect();
    userEmail = `${uid("f3l1_reset")}@test.com`;
    const reg = await request(app).post("/api/auth/register").send({
      name: "Frente Tres Reset",
      email: userEmail,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}3`,
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

  it("token de acesso emitido antes do reset deixa de funcionar depois do reset via token", async () => {
    const login = await request(app).post("/api/auth/login").send({ email: userEmail, password: PASSWORD });
    const oldAccessToken = login.body.accessToken as string;
    expect(oldAccessToken).toBeTruthy();

    // Confirma que o token funciona antes do reset.
    const before = await request(app).get("/api/users/me").set("Authorization", `Bearer ${oldAccessToken}`);
    expect(before.status).toBe(200);

    const forgot = await request(app)
      .post("/api/auth/forgot-password")
      .send({ channel: "EMAIL", email: userEmail });
    const resetToken = forgot.body.resetToken as string;
    expect(resetToken).toBeTruthy();

    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: resetToken, newPassword: "NovaSenha5678" });
    expect([200, 204]).toContain(reset.status);

    const after = await request(app).get("/api/users/me").set("Authorization", `Bearer ${oldAccessToken}`);
    expect(after.status).toBe(401);
  });
});
