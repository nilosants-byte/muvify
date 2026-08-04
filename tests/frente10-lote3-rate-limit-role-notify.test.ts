import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { NotificationService } from "../src/modules/notifications/services/notification.service";

// Épico de Frentes, Frente 10, Lote 3:
// (1) 14 rotas de escrita do admin usavam uploadRateLimiter (mensagem
//     sobre "upload" sem sentido) em vez de writeRateLimiter.
// (2) changeUserRole não revogava sessão/token - o JWT antigo continuava
//     valendo com o role velho até expirar sozinho.
// (3) sendToUsers filtrava por preferência ANTES de criar a
//     UserNotification - desligar uma categoria fazia o aviso desaparecer
//     da central por completo, não só do push.

const PASSWORD = "Test1234";
const notificationService = new NotificationService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function uniqueEmail(prefix: string) {
  return `${uid(prefix)}@test.com`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let adminId = "";
let adminToken = "";

describe("Frente 10, Lote 3 — rate limit, revogação de sessão, notificação sempre gravada", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const adminEmail = env.ADMIN_ALLOWED_EMAILS[0];
    const adminReg = await request(app).post("/api/auth/register").send({
      name: "Frente Dez Lote Tres Admin",
      email: adminEmail,
      password: PASSWORD,
      phone: `1177${Date.now().toString().slice(-8)}`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    adminId = adminReg.body.user?.id ?? (await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })).id;
    await prisma.user.update({ where: { id: adminId }, data: { emailVerifiedAt: new Date() } });
    const adminLogin = await request(app).post("/api/auth/login").send({ email: adminEmail, password: PASSWORD });
    adminToken = adminLogin.body.accessToken;
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: adminId } });
    await prisma.$disconnect();
  });

  it("trocar o tipo de conta invalida o token corrente e notifica o usuário", async () => {
    const targetRegister = await request(app).post("/api/auth/register").send({
      name: "Frente Dez Lote Tres Target",
      email: uniqueEmail("f10l3_target"),
      password: PASSWORD,
      phone: `1188${Date.now().toString().slice(-8)}`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    const targetToken = targetRegister.body.accessToken as string;
    const targetId = targetRegister.body.user.id as string;

    const beforeChange = await request(app).get("/api/users/me").set("Authorization", `Bearer ${targetToken}`);
    expect(beforeChange.status).toBe(200);

    const changeRole = await request(app)
      .patch(`/api/admin/users/${targetId}/role`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role: "PROVIDER", reason: "Teste de revogação de sessão" });
    expect(changeRole.status).toBe(200);

    const afterChange = await request(app).get("/api/users/me").set("Authorization", `Bearer ${targetToken}`);
    expect(afterChange.status).toBe(401);

    // changeUserRole notifica via void sendToUsers(...).catch(...) -
    // fire-and-forget, precisa de uma folga pra concluir.
    await sleep(150);
    const notification = await prisma.userNotification.findFirst({
      where: { userId: targetId, title: "Tipo de conta atualizado" }
    });
    expect(notification).not.toBeNull();

    await prisma.session.deleteMany({ where: { userId: targetId } });
    await prisma.user.deleteMany({ where: { id: targetId } });
  });

  it("desligar a preferência de uma categoria ainda grava a UserNotification (central), só não gera push", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Frente Dez Lote Tres Prefs",
        email: uniqueEmail("f10l3_prefs"),
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });

    await prisma.notificationPreference.create({
      data: { userId: user.id, type: "SYSTEM", enabled: false }
    });

    await notificationService.sendToUsers([user.id], {
      preferenceType: "SYSTEM",
      title: "Aviso de sistema com preferência desligada",
      body: "corpo do aviso",
      data: { type: "TEST_SYSTEM_NOTICE" }
    });

    const stored = await prisma.userNotification.findFirst({
      where: { userId: user.id, title: "Aviso de sistema com preferência desligada" }
    });
    expect(stored).not.toBeNull();

    await prisma.userNotification.deleteMany({ where: { userId: user.id } });
    await prisma.notificationPreference.deleteMany({ where: { userId: user.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  });

  it("categoria ligada continua gravando a UserNotification normalmente (regressão)", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Frente Dez Lote Tres Prefs Ligada",
        email: uniqueEmail("f10l3_prefs_on"),
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "CLIENT"
      }
    });

    await notificationService.sendToUsers([user.id], {
      preferenceType: "SYSTEM",
      title: "Aviso de sistema com preferência ligada",
      body: "corpo do aviso",
      data: { type: "TEST_SYSTEM_NOTICE" }
    });

    const stored = await prisma.userNotification.findFirst({
      where: { userId: user.id, title: "Aviso de sistema com preferência ligada" }
    });
    expect(stored).not.toBeNull();

    await prisma.userNotification.deleteMany({ where: { userId: user.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  });

  // Roda por último: writeRateLimiter é por admin/IP e compartilhado entre
  // TODAS as rotas de escrita do admin - exaurir o balde aqui bloquearia
  // os testes anteriores que também usam rotas de escrita do admin.
  it("rota de escrita do admin usa a mensagem do writeRateLimiter, não a de upload", async () => {
    let lastResponse: request.Response | null = null;
    for (let i = 0; i < 21; i += 1) {
      lastResponse = await request(app)
        .patch(`/api/admin/support/tickets/00000000-0000-0000-0000-000000000000/respond`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ responseMessage: `tentativa ${i}` });
    }
    expect(lastResponse!.status).toBe(429);
    expect(String(lastResponse!.body.message).toLowerCase()).not.toContain("upload");
    expect(lastResponse!.body.message).toBe("Muitas alterações em pouco tempo. Tente novamente em 1 hora.");
  }, 30000);
});
