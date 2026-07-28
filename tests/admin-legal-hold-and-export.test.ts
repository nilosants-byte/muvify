import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { AdminService } from "../src/modules/admin/services/admin.service";
import { DataRetentionService } from "../src/modules/privacy/services/data-retention.service";

// Raio-X de pagamentos, Rodada 4, Lote 9: legal hold só existia como env var
// fixa (DATA_RETENTION_LEGAL_HOLD_USER_IDS) — mudar exigia editar variável
// de ambiente e redeployar. Agora persistido em User.legalHoldUntil, e o
// job automático de retenção passa a respeitar isso via
// DataRetentionService.resolveLegalHoldUserIds. Também cobre o novo
// endpoint de exportação de dados iniciada pelo admin (reaproveita
// userService.exportMyData, antes só self-service).

const adminService = new AdminService();
const dataRetentionService = new DataRetentionService();
const PASSWORD = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  return { token: reg.body.accessToken as string, userId: reg.body.user.id as string };
}

let clientId = "";
let adminId = "";
let adminToken = "";

describe("Legal hold persistido por usuário + exportação de dados pelo admin (Rodada 4, Lote 9)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const client = await registerUser("lh_client", "Legal Hold Client");
    clientId = client.userId;

    const adminReg = await request(app)
      .post("/api/auth/register")
      .send({
        name: "LH Admin",
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
    await prisma.adminAuditLog.deleteMany({ where: { adminId } });
    await prisma.session.deleteMany({ where: { userId: clientId } });
    await prisma.user.deleteMany({ where: { id: clientId } });
    await prisma.$disconnect();
  });

  it("aplica legal hold via HTTP e ele aparece no detalhe do usuário", async () => {
    const until = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .post(`/api/admin/users/${clientId}/legal-hold`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ until, reason: "Processo judicial em curso, número 123." });

    expect(res.status).toBe(200);
    expect(res.body.legalHoldUntil).not.toBeNull();

    const detail = await request(app)
      .get(`/api/admin/users/${clientId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.body.legalHoldUntil).not.toBeNull();
    expect(detail.body.legalHoldReason).toContain("Processo judicial");
  });

  it("resolveLegalHoldUserIds inclui o usuário sob hold ativo, junto com IDs extras informados", async () => {
    const ids = await dataRetentionService.resolveLegalHoldUserIds(["outro-id-qualquer"]);
    expect(ids).toContain(clientId);
    expect(ids).toContain("outro-id-qualquer");
  });

  it("rejeita legal hold com data no passado", async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    await expect(
      adminService.setLegalHold(adminId, clientId, past, "motivo qualquer")
    ).rejects.toThrow(/inválida/i);
  });

  it("remove o legal hold e o usuário some da lista de holds ativos", async () => {
    const res = await request(app)
      .delete(`/api/admin/users/${clientId}/legal-hold`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.legalHoldUntil).toBeNull();

    const ids = await dataRetentionService.resolveLegalHoldUserIds([]);
    expect(ids).not.toContain(clientId);
  });

  it("rejeita remover legal hold de quem não está sob hold", async () => {
    await expect(adminService.clearLegalHold(adminId, clientId)).rejects.toThrow(/não está sob legal hold/i);
  });

  it("admin exporta dados de um usuário via HTTP e a exportação é registrada em audit log", async () => {
    const res = await request(app)
      .post(`/api/admin/users/${clientId}/export-data`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.profile.id).toBe(clientId);
    expect(res.body.exportedAt).toBeDefined();

    let auditEntry = null;
    for (let attempt = 0; attempt < 5 && !auditEntry; attempt++) {
      auditEntry = await prisma.adminAuditLog.findFirst({
        where: { adminId, action: "ADMIN_USER_DATA_EXPORTED", targetId: clientId }
      });
      if (!auditEntry) await sleep(150);
    }
    expect(auditEntry).not.toBeNull();
  });

  it("um usuário comum não consegue aplicar legal hold em ninguém (403)", async () => {
    const another = await registerUser("lh_other", "Other User");
    const res = await request(app)
      .post(`/api/admin/users/${clientId}/legal-hold`)
      .set("Authorization", `Bearer ${another.token}`)
      .send({ until: new Date(Date.now() + 1000000).toISOString(), reason: "teste" });
    expect(res.status).toBe(403);

    await prisma.session.deleteMany({ where: { userId: another.userId } });
    await prisma.user.deleteMany({ where: { id: another.userId } });
  });
});
