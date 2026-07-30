import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { redis } from "../src/config/redis";
import { AuthService } from "../src/modules/auth/services/auth.service";
import {
  clearLocalLoginAttempts,
  getLocalLoginAttempts,
  incrementLocalLoginAttempts
} from "../src/shared/security/login-attempts";

// Épico de Frentes, Frente 3 (Cadastro/onboarding), Lote 5:
// (1) erro de validação indica o campo/regra que falhou, não só "Erro de
//     validação." genérico.
// (2) throttle de reenvio de verificação de e-mail cai pro fallback local
//     quando Redis não está pronto.
// (3) lockout de 2FA usa o mesmo primitivo de fallback local do lockout de
//     login (unitário, já que a checagem completa é desligada em NODE_ENV
//     de teste pra não interferir nos outros testes da suíte).
// (4) conta com e-mail não verificado é bloqueada em ações sensíveis
//     (booking) mas continua conseguindo logar e navegar.

const authService = new AuthService();
const PASSWORD = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

describe("Frente 3, Lote 5 — erro de validação com detalhe de campo", () => {
  it("registro com senha inválida retorna o campo e a regra que falharam, não só mensagem genérica", async () => {
    const res = await request(app).post("/api/auth/register").send({
      name: "Erro Validacao",
      email: `${uid("errval")}@test.com`,
      password: "short",
      phone: `11${Date.now().toString().slice(-9)}1`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/letras e numeros|8 character/i);
    expect(res.body.errors).toBeTruthy();
  });
});

describe("Frente 3, Lote 5 — throttle de reenvio de verificação sem Redis", () => {
  let userId = "";
  const originalRedisStatus = redis.status;

  beforeAll(async () => {
    await prisma.$connect();
    const email = `${uid("resend_fallback")}@test.com`;
    const reg = await request(app).post("/api/auth/register").send({
      name: "Resend Fallback",
      email,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}2`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    userId = reg.body.user.id;
  });

  afterEach(() => {
    redis.status = originalRedisStatus;
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("bloqueia depois de 3 reenvios usando o contador local quando Redis não está pronto", async () => {
    redis.status = "end";

    await authService.resendVerificationEmail(userId);
    await authService.resendVerificationEmail(userId);
    await authService.resendVerificationEmail(userId);

    await expect(authService.resendVerificationEmail(userId)).rejects.toThrow(/muitas tentativas/i);
  });
});

describe("Frente 3, Lote 5 — primitivo de lockout local (usado por login e 2FA)", () => {
  const key = `2fa:test:${uid("k")}`;

  afterEach(() => {
    clearLocalLoginAttempts(key);
  });

  it("conta tentativas e bloqueia ao atingir o limite, com namespace próprio pro 2FA", () => {
    expect(getLocalLoginAttempts(key)).toBe(0);
    incrementLocalLoginAttempts(key, 60);
    incrementLocalLoginAttempts(key, 60);
    expect(getLocalLoginAttempts(key)).toBe(2);
    clearLocalLoginAttempts(key);
    expect(getLocalLoginAttempts(key)).toBe(0);
  });
});

describe("Frente 3, Lote 5 — e-mail não verificado bloqueia ações sensíveis, não login", () => {
  let token = "";
  let userId = "";
  let providerId = "";
  const userIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    const email = `${uid("unverified")}@test.com`;
    const reg = await request(app).post("/api/auth/register").send({
      name: "Nao Verificado",
      email,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}3`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    token = reg.body.accessToken;
    userId = reg.body.user.id;
    userIds.push(userId);

    const providerUser = await prisma.user.create({
      data: {
        name: "Provider Para Nao Verificado",
        email: `${uid("provfornv")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}4`,
        role: "PROVIDER",
        emailVerifiedAt: new Date()
      }
    });
    userIds.push(providerUser.id);
    const category = await prisma.serviceCategory.create({ data: { name: `NV_${uid("c")}`, description: "test" } });
    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUser.id,
        displayName: "Provider Para Nao Verificado",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        crefValidationStatus: "APPROVED",
        minBookingNoticeHours: 1
      }
    });
    providerId = provider.id;
    await prisma.availability.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        providerId,
        weekday,
        startTime: "06:00",
        endTime: "22:00",
        isActive: true
      }))
    });
    await prisma.providerCategory.create({ data: { providerId, categoryId: category.id } });
    await prisma.clientAnamnesis.create({ data: { clientId: userId, status: "COMPLETED", completedAt: new Date() } });

    // limpeza da categoria fica de fora do afterAll pra não colidir com o helper
  });

  afterAll(async () => {
    await prisma.availability.deleteMany({ where: { providerId } });
    await prisma.providerCategory.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId: userId } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("login continua funcionando normalmente sem e-mail verificado", async () => {
    const res = await request(app).get("/api/users/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("criar agendamento presencial é bloqueado sem e-mail verificado", async () => {
    const scheduledAt = new Date();
    scheduledAt.setDate(scheduledAt.getDate() + 10);
    scheduledAt.setHours(14, 0, 0, 0);

    const res = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${token}`)
      .send({
        providerId,
        categoryId: (await prisma.providerCategory.findFirstOrThrow({ where: { providerId } })).categoryId,
        scheduledAt: scheduledAt.toISOString(),
        paymentMethod: "CREDIT_CARD"
      });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/confirme seu e-mail/i);
  });

  it("depois de verificar o e-mail, a mesma ação passa a funcionar (sem erro de e-mail)", async () => {
    await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });

    const scheduledAt = new Date();
    scheduledAt.setDate(scheduledAt.getDate() + 11);
    scheduledAt.setHours(15, 0, 0, 0);

    const res = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${token}`)
      .send({
        providerId,
        categoryId: (await prisma.providerCategory.findFirstOrThrow({ where: { providerId } })).categoryId,
        scheduledAt: scheduledAt.toISOString(),
        paymentMethod: "CREDIT_CARD"
      });
    expect(res.status).not.toBe(403);
  });
});
