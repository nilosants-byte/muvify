import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";

// Épico de Frentes, Frente 11, Lote 2: gate de re-consentimento e
// finalidades separadas no mobile.
// (1) NotificationPreferenceType.MARKETING vinha com default ligado
//     (opt-out) igual qualquer categoria operacional - finalidade de
//     marketing precisa ser opt-in.
// (2) POST /users/me/consent era o único endpoint autenticado do módulo
//     sem rate limiter nenhum.

const PASSWORD = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function uniqueEmail(prefix: string) {
  return `${uid(prefix)}@test.com`;
}

const createdUserIds: string[] = [];

async function registerUser(prefix: string) {
  const register = await request(app).post("/api/auth/register").send({
    name: "Frente Onze Lote Dois",
    email: uniqueEmail(prefix),
    password: PASSWORD,
    phone: `11${Date.now().toString().slice(-9)}`,
    termsVersion: "2026.05",
    consentAccepted: true
  });
  const userId = register.body.user.id as string;
  const token = register.body.accessToken as string;
  createdUserIds.push(userId);
  return { userId, token };
}

describe("Frente 11, Lote 2 — gate de re-consentimento e finalidades separadas", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.notificationPreference.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.consentRecord.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it("MARKETING vem desligado por padrão pra usuário sem preferência salva; outras categorias continuam ligadas", async () => {
    const { token } = await registerUser("f11l2_marketing");

    const response = await request(app)
      .get("/api/users/me/notifications/preferences")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    const marketing = response.body.find((p: { type: string }) => p.type === "MARKETING");
    expect(marketing).toBeDefined();
    expect(marketing.enabled).toBe(false);

    const others = response.body.filter((p: { type: string }) => p.type !== "MARKETING");
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((p: { enabled: boolean }) => p.enabled === true)).toBe(true);
  });

  it("MARKETING salvo explicitamente como true continua respeitado (não é sobrescrito pelo default)", async () => {
    const { userId, token } = await registerUser("f11l2_marketing_opt_in");

    const upsert = await request(app)
      .put("/api/users/me/notifications/preferences")
      .set("Authorization", `Bearer ${token}`)
      .send({ preferences: [{ type: "MARKETING", enabled: true }] });
    expect(upsert.status).toBe(200);

    const marketing = upsert.body.find((p: { type: string }) => p.type === "MARKETING");
    expect(marketing.enabled).toBe(true);

    const saved = await prisma.notificationPreference.findUnique({
      where: { userId_type: { userId, type: "MARKETING" } }
    });
    expect(saved?.enabled).toBe(true);
  });

  // Roda por último: writeRateLimiter é por usuário/IP e compartilhado
  // entre todas as rotas de escrita - exaurir o balde aqui não pode
  // atrapalhar os testes anteriores (usuários diferentes, sem colisão).
  it("POST /me/consent usa writeRateLimiter (bloqueia após 20 chamadas na mesma hora)", async () => {
    const { token } = await registerUser("f11l2_rate_limit");

    let lastResponse: request.Response | null = null;
    for (let i = 0; i < 21; i += 1) {
      lastResponse = await request(app)
        .post("/api/users/me/consent")
        .set("Authorization", `Bearer ${token}`)
        .send({});
    }
    expect(lastResponse!.status).toBe(429);
    expect(lastResponse!.body.message).toBe("Muitas alterações em pouco tempo. Tente novamente em 1 hora.");
  }, 30000);
});
