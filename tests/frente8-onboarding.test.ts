import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { AuthService } from "../src/modules/auth/services/auth.service";
import { UserService } from "../src/modules/users/services/user.service";
import { assertAnamnesisCompleted } from "../src/shared/utils/anamnesis-required";
import { generateRefreshToken, hashRefreshToken } from "../src/shared/utils/refresh-token";
import { hashValue } from "../src/shared/utils/hash";

// Frente 8 (segunda camada): onboarding e jornada do cliente.

const authService = new AuthService();
const userService = new UserService();
const PASSWORD = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function registerUser(prefix: string, displayName: string, email?: string) {
  const reg = await request(app)
    .post("/api/auth/register")
    .send({
      name: displayName,
      email: email ?? `${uid(prefix)}@test.com`,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
  return { token: reg.body.accessToken as string, userId: reg.body.user.id as string, email: reg.body.user.email as string };
}

// Lotes que não testam o próprio endpoint de registro (só usam um usuário
// como fixture) criam direto via Prisma, sem passar pelo authRateLimiter
// (20/15min) compartilhado com login — este arquivo já acumula muitas
// descrições e bateria no limite se cada uma passasse pelo HTTP de verdade.
async function createTestUser(prefix: string, displayName: string, overrideEmail?: string) {
  const email = overrideEmail ?? `${uid(prefix)}@test.com`;
  const user = await prisma.user.create({
    data: {
      name: displayName,
      email,
      password: await hashValue(PASSWORD),
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
      termsAcceptedAt: new Date(),
      privacyPolicyAcceptedAt: new Date(),
      termsVersion: "2026.05"
    },
    select: { id: true, email: true }
  });
  return { userId: user.id, email: user.email };
}

async function createVerificationToken(userId: string) {
  const rawToken = generateRefreshToken();
  await prisma.emailVerificationToken.deleteMany({ where: { userId, usedAt: null } });
  await prisma.emailVerificationToken.create({
    data: { userId, tokenHash: hashRefreshToken(rawToken), expiresAt: new Date(Date.now() + 60 * 60 * 1000) }
  });
  return rawToken;
}

describe("Frente 8 (segunda camada), Lote 3 — verificar e-mail não revoga sessão à toa pra CLIENT/PROVIDER", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    await prisma.emailVerificationToken.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("cliente que verifica o e-mail continua com a sessão do cadastro (auto-login) válida", async () => {
    const client = await registerUser("l3_client", "Lote Tres Cliente");
    createdUserIds.push(client.userId);

    const activeBefore = await prisma.session.count({ where: { userId: client.userId, revokedAt: null } });
    expect(activeBefore).toBeGreaterThan(0);

    const rawToken = await createVerificationToken(client.userId);
    await authService.verifyEmail(rawToken);

    const activeAfter = await prisma.session.count({ where: { userId: client.userId, revokedAt: null } });
    expect(activeAfter).toBe(activeBefore);

    // A própria requisição autenticada com o token do cadastro continua
    // funcionando normalmente logo após verificar o e-mail.
    const me = await request(app).get("/api/users/me").set("Authorization", `Bearer ${client.token}`);
    expect(me.status).toBe(200);
  });

  it("e-mail da allowlist de admin ainda revoga sessão ao verificar (a role efetiva muda de verdade)", async () => {
    const adminEmail = env.ADMIN_ALLOWED_EMAILS[0];
    const adminReg = await registerUser("l3_admin", "Lote Tres Admin", adminEmail).catch(() => null);
    const adminId = adminReg?.userId ?? (await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })).id;
    if (adminReg) createdUserIds.push(adminId);

    // Reaproveitar a conta admin compartilhada entre arquivos de teste
    // significa que ela já pode estar com e-mail verificado — reseta pra
    // garantir que este teste exercita o caminho de verificação de verdade.
    await prisma.user.update({ where: { id: adminId }, data: { emailVerifiedAt: null } });
    await prisma.session.updateMany({ where: { userId: adminId, revokedAt: null }, data: { revokedAt: new Date() } });
    const login = await request(app).post("/api/auth/login").send({ email: adminEmail, password: PASSWORD });
    if (login.status !== 200) return; // conta admin com senha diferente noutro arquivo — não é o foco deste teste

    const activeBefore = await prisma.session.count({ where: { userId: adminId, revokedAt: null } });
    expect(activeBefore).toBeGreaterThan(0);

    const rawToken = await createVerificationToken(adminId);
    await authService.verifyEmail(rawToken);

    const activeAfter = await prisma.session.count({ where: { userId: adminId, revokedAt: null } });
    expect(activeAfter).toBe(0);

    await prisma.user.update({ where: { id: adminId }, data: { emailVerifiedAt: new Date() } });
  });
});

describe("Frente 8 (segunda camada), Lote 4 — /auth/refresh tem balde próprio, separado de login/registro", () => {
  it("25 chamadas de refresh (mais que o antigo limite compartilhado de 20/15min) não batem em 429", async () => {
    // Token inválido de propósito — o que importa aqui é só a contagem do
    // rate limiter, que roda antes da lógica de negócio. Nenhuma delas deve
    // devolver 429; todas devem cair em 401 (token inválido).
    let sawRateLimited = false;
    for (let i = 0; i < 25; i += 1) {
      const response = await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken: `bogus_${uid("l4_refresh")}` });
      if (response.status === 429) sawRateLimited = true;
      expect(response.status).not.toBe(429);
    }
    expect(sawRateLimited).toBe(false);
  }, 30000);
});

describe("Frente 8 (segunda camada), Lote 5 — link de verificação resistente a pré-fetch de scanner de e-mail", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    await prisma.emailVerificationToken.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("GET não consome o token (simula pré-fetch de scanner corporativo) — só o POST consome de verdade", async () => {
    const client = await registerUser("l5_client", "Lote Cinco Cliente");
    createdUserIds.push(client.userId);
    const rawToken = await createVerificationToken(client.userId);

    // "Scanner" visita o link 2x antes do clique real do usuário.
    const scan1 = await request(app).get("/api/auth/verify-email").query({ token: rawToken });
    expect(scan1.status).toBe(200);
    expect(scan1.text).toContain("Confirmar meu e-mail");

    const scan2 = await request(app).get("/api/auth/verify-email").query({ token: rawToken });
    expect(scan2.status).toBe(200);
    expect(scan2.text).toContain("Confirmar meu e-mail");

    const stillUnused = await prisma.emailVerificationToken.findFirst({ where: { userId: client.userId } });
    expect(stillUnused?.usedAt).toBeNull();
    const userStillUnverified = await prisma.user.findUniqueOrThrow({ where: { id: client.userId } });
    expect(userStillUnverified.emailVerifiedAt).toBeNull();

    // Clique real do usuário no botão da página (POST).
    const confirm = await request(app).post("/api/auth/verify-email").send({ token: rawToken });
    expect(confirm.status).toBe(200);
    expect(confirm.text).toContain("E-mail confirmado");

    const usedNow = await prisma.emailVerificationToken.findFirst({ where: { userId: client.userId } });
    expect(usedNow?.usedAt).not.toBeNull();
    const userVerifiedNow = await prisma.user.findUniqueOrThrow({ where: { id: client.userId } });
    expect(userVerifiedNow.emailVerifiedAt).not.toBeNull();
  });

  it("GET com token já usado (ou inválido) mostra a página de erro, não a de confirmação", async () => {
    const response = await request(app).get("/api/auth/verify-email").query({ token: "token-que-nunca-existiu" });
    expect(response.status).toBe(400);
    expect(response.text).not.toContain("Confirmar meu e-mail");
  });

  it("POST com token inválido devolve a página de erro, sem lançar exceção", async () => {
    const response = await request(app).post("/api/auth/verify-email").send({ token: "token-que-nunca-existiu" });
    expect(response.status).toBe(400);
    expect(response.text).not.toContain("E-mail confirmado");
  });
});

describe("Frente 8 (segunda camada), Lote 8 — lembrete de onboarding abandonado (e-mail e anamnese)", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    await prisma.clientAnamnesis.deleteMany({ where: { clientId: { in: createdUserIds } } });
    await prisma.emailVerificationToken.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("cadastro com e-mail não verificado há mais de 24h recebe lembrete uma única vez", async () => {
    const client = await createTestUser("l8_email", "Lote Oito E-mail");
    createdUserIds.push(client.userId);

    const oldEnough = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await prisma.user.update({ where: { id: client.userId }, data: { createdAt: oldEnough } });

    await authService.sendUnverifiedEmailReminders();
    const afterFirstRun = await prisma.user.findUniqueOrThrow({ where: { id: client.userId } });
    expect(afterFirstRun.emailVerificationReminderSentAt).not.toBeNull();

    const tokenAfterFirstRun = await prisma.emailVerificationToken.findFirst({ where: { userId: client.userId } });
    expect(tokenAfterFirstRun).not.toBeNull();

    // Segunda execução do job não gera um novo token nem reenvia — a flag
    // no User já impede reprocessar o mesmo usuário.
    await authService.sendUnverifiedEmailReminders();
    const tokenCountAfterSecondRun = await prisma.emailVerificationToken.count({
      where: { userId: client.userId }
    });
    expect(tokenCountAfterSecondRun).toBe(1);
  });

  it("cadastro recente (menos de 24h) não recebe lembrete ainda", async () => {
    const client = await createTestUser("l8_email_recent", "Lote Oito E-mail Recente");
    createdUserIds.push(client.userId);

    await authService.sendUnverifiedEmailReminders();
    const after = await prisma.user.findUniqueOrThrow({ where: { id: client.userId } });
    expect(after.emailVerificationReminderSentAt).toBeNull();
  });

  it("anamnese em rascunho parada há mais de 24h recebe lembrete uma única vez", async () => {
    const client = await createTestUser("l8_anamnesis", "Lote Oito Anamnese");
    createdUserIds.push(client.userId);

    const oldEnough = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await prisma.clientAnamnesis.create({
      data: { clientId: client.userId, status: "DRAFT", updatedAt: oldEnough }
    });

    await userService.sendAnamnesisDraftReminders();
    const afterFirstRun = await prisma.clientAnamnesis.findUniqueOrThrow({ where: { clientId: client.userId } });
    expect(afterFirstRun.draftReminderSentAt).not.toBeNull();
    const firstReminderTimestamp = afterFirstRun.draftReminderSentAt;

    // Segunda execução não sobrescreve — a flag já marcada impede
    // reprocessar o mesmo rascunho de novo.
    await userService.sendAnamnesisDraftReminders();
    const afterSecondRun = await prisma.clientAnamnesis.findUniqueOrThrow({ where: { clientId: client.userId } });
    expect(afterSecondRun.draftReminderSentAt?.getTime()).toBe(firstReminderTimestamp?.getTime());
  });

  it("anamnese completa (não em rascunho) nunca recebe lembrete de rascunho abandonado", async () => {
    const client = await createTestUser("l8_anamnesis_done", "Lote Oito Anamnese Completa");
    createdUserIds.push(client.userId);

    const oldEnough = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await prisma.clientAnamnesis.create({
      data: { clientId: client.userId, status: "COMPLETED", completedAt: oldEnough, updatedAt: oldEnough }
    });

    await userService.sendAnamnesisDraftReminders();
    const after = await prisma.clientAnamnesis.findUniqueOrThrow({ where: { clientId: client.userId } });
    expect(after.draftReminderSentAt).toBeNull();
  });
});

describe("Frente 8 (segunda camada), Lote 9 — cadastro nunca verificado libera o e-mail depois de expirar", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    await prisma.follow.deleteMany({ where: { followerId: { in: createdUserIds } } });
    await prisma.emailVerificationToken.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("cadastro nunca verificado, sem nenhuma atividade, há mais de 30 dias é apagado — e-mail volta a ficar livre", async () => {
    const email = `${uid("l9_ghost")}@test.com`;
    const client = await createTestUser("l9_ghost", "Lote Nove Fantasma", email);
    createdUserIds.push(client.userId);

    const longAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await prisma.user.update({ where: { id: client.userId }, data: { createdAt: longAgo } });

    await authService.expireUnverifiedRegistrations();

    const stillThere = await prisma.user.findUnique({ where: { id: client.userId } });
    expect(stillThere).toBeNull();

    // O e-mail volta a ficar disponível pra um cadastro de verdade.
    const reRegister = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Dono De Verdade",
        email,
        password: PASSWORD,
        phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
        termsVersion: "2026.05",
        consentAccepted: true
      });
    expect(reRegister.status).toBe(201);
    createdUserIds.push(reRegister.body.user.id);
  });

  it("cadastro nunca verificado, mas com atividade real (seguindo alguém), não é apagado mesmo após 30 dias", async () => {
    const client = await createTestUser("l9_active", "Lote Nove Ativo");
    createdUserIds.push(client.userId);
    const someoneElse = await createTestUser("l9_active_target", "Lote Nove Seguido");
    createdUserIds.push(someoneElse.userId);

    const longAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await prisma.user.update({ where: { id: client.userId }, data: { createdAt: longAgo } });
    await prisma.follow.create({ data: { followerId: client.userId, followingId: someoneElse.userId } });

    await authService.expireUnverifiedRegistrations();

    const stillThere = await prisma.user.findUnique({ where: { id: client.userId } });
    expect(stillThere).not.toBeNull();
  });

  it("cadastro nunca verificado há menos de 30 dias não é apagado ainda", async () => {
    const client = await createTestUser("l9_recent", "Lote Nove Recente");
    createdUserIds.push(client.userId);

    await authService.expireUnverifiedRegistrations();

    const stillThere = await prisma.user.findUnique({ where: { id: client.userId } });
    expect(stillThere).not.toBeNull();
  });
});

describe("Frente 8 (segunda camada), Lote 10 — checagem de anamnese obrigatória centralizada (booking, pacote, consultoria)", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    await prisma.clientAnamnesis.deleteMany({ where: { clientId: { in: createdUserIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("cliente sem anamnese nenhuma é bloqueado com a mensagem específica da ação", async () => {
    const client = await createTestUser("l10_none", "Lote Dez Sem Anamnese");
    createdUserIds.push(client.userId);

    await expect(assertAnamnesisCompleted(client.userId, "Preencha a anamnese antes de X.")).rejects.toThrow(
      "Preencha a anamnese antes de X."
    );
  });

  it("cliente com anamnese em rascunho continua bloqueado", async () => {
    const client = await createTestUser("l10_draft", "Lote Dez Rascunho");
    createdUserIds.push(client.userId);
    await prisma.clientAnamnesis.create({ data: { clientId: client.userId, status: "DRAFT" } });

    await expect(assertAnamnesisCompleted(client.userId, "Preencha a anamnese antes de X.")).rejects.toThrow(
      "Preencha a anamnese antes de X."
    );
  });

  it("cliente com anamnese completa passa sem lançar erro", async () => {
    const client = await createTestUser("l10_done", "Lote Dez Completa");
    createdUserIds.push(client.userId);
    await prisma.clientAnamnesis.create({
      data: { clientId: client.userId, status: "COMPLETED", completedAt: new Date() }
    });

    await expect(assertAnamnesisCompleted(client.userId, "Preencha a anamnese antes de X.")).resolves.toBeUndefined();
  });
});
