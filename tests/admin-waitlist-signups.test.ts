import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";

// Painel admin de leads da lista de espera pré-lançamento: cadastros só
// existiam pra consultar direto no banco. Cobre auth (403 pra quem não é
// admin), filtro por audience, busca por nome/e-mail, e paginação.

const PASSWORD = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientToken = "";
let clientUserId = "";
let adminId = "";
let adminToken = "";
const seededEmails: string[] = [];

describe("GET /admin/waitlist-signups", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const clientReg = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Waitlist Admin Test Client",
        email: `${uid("wladm_client")}@test.com`,
        password: PASSWORD,
        phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
        termsVersion: "2026.05",
        consentAccepted: true
      });
    clientToken = clientReg.body.accessToken;
    clientUserId = clientReg.body.user.id;

    const adminReg = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Waitlist Admin",
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

    const seed = [
      { email: `${uid("wladm")}@test.com`, name: "Ana Aluna", audience: "CLIENT" as const },
      { email: `${uid("wladm")}@test.com`, name: "Beto Profissional", audience: "PROFESSIONAL" as const },
      { email: `${uid("wladm")}@test.com`, name: "Carla Profissional", audience: "PROFESSIONAL" as const }
    ];
    for (const row of seed) {
      seededEmails.push(row.email);
      await prisma.waitlistSignup.create({ data: row });
    }
  });

  afterAll(async () => {
    await prisma.waitlistSignup.deleteMany({ where: { email: { in: seededEmails } } });
    await prisma.session.deleteMany({ where: { userId: clientUserId } });
    await prisma.user.deleteMany({ where: { id: clientUserId } });
    await prisma.$disconnect();
  });

  it("rejeita quem não é admin com 403", async () => {
    const res = await request(app)
      .get("/api/admin/waitlist-signups")
      .set("Authorization", `Bearer ${clientToken}`);
    expect(res.status).toBe(403);
  });

  it("rejeita requisição sem autenticação", async () => {
    const res = await request(app).get("/api/admin/waitlist-signups");
    expect(res.status).toBe(401);
  });

  it("admin lista os cadastros com total", async () => {
    const res = await request(app)
      .get("/api/admin/waitlist-signups")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.total).toBe("number");
    expect(res.body.total).toBeGreaterThanOrEqual(3);
    const emails = res.body.items.map((i: { email: string }) => i.email);
    for (const seededEmail of seededEmails) {
      expect(emails).toContain(seededEmail);
    }
  });

  it("filtra por audience=PROFESSIONAL", async () => {
    const res = await request(app)
      .get("/api/admin/waitlist-signups?audience=PROFESSIONAL")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const seededInResult = res.body.items.filter((i: { email: string }) => seededEmails.includes(i.email));
    expect(seededInResult).toHaveLength(2);
    expect(seededInResult.every((i: { audience: string }) => i.audience === "PROFESSIONAL")).toBe(true);
  });

  it("busca por nome (q) encontra pelo texto parcial, case-insensitive", async () => {
    const res = await request(app)
      .get("/api/admin/waitlist-signups?q=profissional")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const seededInResult = res.body.items.filter((i: { email: string }) => seededEmails.includes(i.email));
    expect(seededInResult).toHaveLength(2);
  });

  it("rejeita audience inválido com 400", async () => {
    const res = await request(app)
      .get("/api/admin/waitlist-signups?audience=INVALIDO")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it("respeita take/skip pra paginação", async () => {
    const res = await request(app)
      .get("/api/admin/waitlist-signups?take=1&skip=0")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBeGreaterThanOrEqual(3);
  });
});
