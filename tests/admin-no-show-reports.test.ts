import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";

// Raio-X de pagamentos, Rodada 4, Lote 7: GET /admin/no-show-reports era a
// única rota admin sem validate() — minStrikes inválido virava NaN e
// filtrava a lista inteira pra vazia (200 OK, silencioso) em vez de
// rejeitar com 400. Cobre também que o filtro de faltas mínimas funciona.

const PASSWORD = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function registerUser(prefix: string, displayName: string, role?: "PROVIDER", email?: string) {
  const reg = await request(app)
    .post("/api/auth/register")
    .send({
      name: displayName,
      email: email ?? `${uid(prefix)}@test.com`,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
      ...(role ? { role } : {}),
      termsVersion: "2026.05",
      consentAccepted: true
    });
  return { token: reg.body.accessToken as string, userId: reg.body.user.id as string };
}

let clientId = "";
let providerUserId = "";
let adminId = "";
let adminToken = "";

describe("GET /admin/no-show-reports valida minStrikes e filtra por reincidência (Rodada 4, Lote 7)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const client = await registerUser("nsr_client", "NSR Client");
    clientId = client.userId;
    await prisma.user.update({ where: { id: clientId }, data: { noShowStrikes: 3 } });

    const provider = await registerUser("nsr_provider", "NSR Provider", "PROVIDER");
    providerUserId = provider.userId;

    const adminReg = await request(app)
      .post("/api/auth/register")
      .send({
        name: "NSR Admin",
        email: env.ADMIN_ALLOWED_EMAILS[0],
        password: PASSWORD,
        phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
        termsVersion: "2026.05",
        consentAccepted: true
      });
    adminId = adminReg.body.user?.id ?? (await prisma.user.findUniqueOrThrow({ where: { email: env.ADMIN_ALLOWED_EMAILS[0] } })).id;
    await prisma.user.update({ where: { id: adminId }, data: { emailVerifiedAt: new Date() } });
    const adminLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: env.ADMIN_ALLOWED_EMAILS[0], password: PASSWORD });
    adminToken = adminLogin.body.accessToken;
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: { in: [clientId, providerUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.$disconnect();
  });

  it("rejeita minStrikes não numérico com 400 em vez de devolver lista vazia silenciosamente", async () => {
    const res = await request(app)
      .get("/api/admin/no-show-reports?minStrikes=abc")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it("rejeita minStrikes menor que 1", async () => {
    const res = await request(app)
      .get("/api/admin/no-show-reports?minStrikes=0")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it("aceita requisição sem minStrikes (usa o default) e filtra corretamente com o parâmetro presente", async () => {
    const noParam = await request(app)
      .get("/api/admin/no-show-reports")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(noParam.status).toBe(200);

    const highThreshold = await request(app)
      .get("/api/admin/no-show-reports?minStrikes=99")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(highThreshold.status).toBe(200);
    expect(highThreshold.body.some((r: any) => r.reportedUser.id === clientId)).toBe(false);
  });
});
