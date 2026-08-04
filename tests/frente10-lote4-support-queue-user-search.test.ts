import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";

// Épico de Frentes, Frente 10, Lote 4: fila de suporte e busca de usuário
// sem paginação real, sem SLA, sem detalhe completo.
// (1) listSupportTickets/searchUsers tinham take fixo sem skip/total -
//     registros mais antigos ficavam permanentemente inalcançáveis.
// (2) attentionNeeded não distinguia ticket "aberto agora" de "aberto há
//     uma semana".
// (3) não existia GET de detalhe de um ticket.
// (4) getUserDetail só trazia dívida/disputa - nada de tickets, denúncias,
//     telefone, verificações.

const PASSWORD = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function uniqueEmail(prefix: string) {
  return `${uid(prefix)}@test.com`;
}

let adminId = "";
let adminToken = "";
const createdUserIds: string[] = [];
const createdTicketIds: string[] = [];

describe("Frente 10, Lote 4 — fila de suporte e busca de usuário", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const adminEmail = env.ADMIN_ALLOWED_EMAILS[0];
    const adminReg = await request(app).post("/api/auth/register").send({
      name: "Frente Dez Lote Quatro Admin",
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
    await prisma.supportTicket.deleteMany({ where: { id: { in: createdTicketIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: [...createdUserIds, adminId] } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it("paginar tickets (skip) não duplica nem pula, e o ticket mais antigo continua alcançável", async () => {
    const userRegister = await request(app).post("/api/auth/register").send({
      name: "Frente Dez Lote Quatro Ticket User",
      email: uniqueEmail("f10l4_ticketuser"),
      password: PASSWORD,
      phone: `1188${Date.now().toString().slice(-8)}`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    const userId = userRegister.body.user.id as string;
    createdUserIds.push(userId);

    const ticketIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const created = await prisma.supportTicket.create({
        data: { userId, subject: `F10L4 ticket ${i}`, message: "mensagem de teste", status: "OPEN" }
      });
      ticketIds.push(created.id);
      createdTicketIds.push(created.id);
      // createdAt asc pra garantir ordenação determinística entre os 3
      await prisma.supportTicket.update({ where: { id: created.id }, data: { createdAt: new Date(Date.now() - (3 - i) * 1000) } });
    }

    const q = encodeURIComponent("Frente Dez Lote Quatro Ticket User");
    const firstPage = await request(app)
      .get(`/api/admin/support/tickets?status=OPEN&take=2&skip=0&q=${q}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.items).toHaveLength(2);
    expect(firstPage.body.total).toBe(3);

    const secondPage = await request(app)
      .get(`/api/admin/support/tickets?status=OPEN&take=2&skip=2&q=${q}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.items).toHaveLength(1);

    const firstIds = firstPage.body.items.map((t: { id: string }) => t.id);
    const secondIds = secondPage.body.items.map((t: { id: string }) => t.id);
    expect(firstIds.filter((id: string) => secondIds.includes(id))).toHaveLength(0);
    expect([...firstIds, ...secondIds].sort()).toEqual([...ticketIds].sort());
  });

  it("GET de detalhe de ticket traz o vínculo com o ticket anterior (parentTicket)", async () => {
    const userRegister = await request(app).post("/api/auth/register").send({
      name: "Frente Dez Lote Quatro Detail User",
      email: uniqueEmail("f10l4_detailuser"),
      password: PASSWORD,
      phone: `1199${Date.now().toString().slice(-8)}`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    const userToken = userRegister.body.accessToken as string;
    const userId = userRegister.body.user.id as string;
    createdUserIds.push(userId);

    const first = await request(app)
      .post("/api/users/me/support-message")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ subject: "Assunto 1", message: "Primeira mensagem" });
    const firstId = first.body.ticketId as string;
    createdTicketIds.push(firstId);

    await request(app)
      .patch(`/api/admin/support/tickets/${firstId}/respond`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ responseMessage: "Resolvido" });

    const second = await request(app)
      .post("/api/users/me/support-message")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ subject: "Assunto 1", message: "Voltou a acontecer" });
    const secondId = second.body.ticketId as string;
    createdTicketIds.push(secondId);

    const detail = await request(app)
      .get(`/api/admin/support/tickets/${secondId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.parentTicket.id).toBe(firstId);
    expect(detail.body.parentTicket.adminResponse).toBe("Resolvido");
  });

  it("attentionNeeded traz overdueSupportTicketsCount pra ticket OPEN há mais de 48h", async () => {
    const userRegister = await request(app).post("/api/auth/register").send({
      name: "Frente Dez Lote Quatro Overdue User",
      email: uniqueEmail("f10l4_overdueuser"),
      password: PASSWORD,
      phone: `1111${Date.now().toString().slice(-8)}`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    const userId = userRegister.body.user.id as string;
    createdUserIds.push(userId);

    const overdueTicket = await prisma.supportTicket.create({
      data: {
        userId,
        subject: "Ticket vencido",
        message: "mensagem",
        status: "OPEN",
        createdAt: new Date(Date.now() - 72 * 60 * 60 * 1000)
      }
    });
    createdTicketIds.push(overdueTicket.id);

    const beforeCount = await prisma.supportTicket.count({
      where: { status: "OPEN", createdAt: { lte: new Date(Date.now() - 48 * 60 * 60 * 1000) } }
    });
    expect(beforeCount).toBeGreaterThanOrEqual(1);

    const overview = await request(app)
      .get("/api/admin/dashboard/overview")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(overview.status).toBe(200);
    expect(overview.body.attentionNeeded.overdueSupportTicketsCount).toBe(beforeCount);
  });

  it("getUserDetail traz telefone, verificações e contadores de ticket/denúncia", async () => {
    const userRegister = await request(app).post("/api/auth/register").send({
      name: "Frente Dez Lote Quatro Detail Full",
      email: uniqueEmail("f10l4_detailfull"),
      password: PASSWORD,
      phone: `1122${Date.now().toString().slice(-8)}`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    const userId = userRegister.body.user.id as string;
    createdUserIds.push(userId);

    const ticket = await prisma.supportTicket.create({
      data: { userId, subject: "Ticket do usuário", message: "mensagem", status: "OPEN" }
    });
    createdTicketIds.push(ticket.id);

    const detail = await request(app)
      .get(`/api/admin/users/${userId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.phone).toBeTruthy();
    expect(detail.body.emailVerifiedAt).toBeDefined();
    expect(detail.body.twoFactorEnabled).toBe(false);
    expect(detail.body.supportTicketsCount).toBeGreaterThanOrEqual(1);
    expect(detail.body.reportsFiledCount).toBe(0);
    expect(detail.body.reportsAgainstCount).toBe(0);
  });

  it("paginar busca de usuário não duplica nem pula", async () => {
    // registerSchema.name rejeita dígitos/underscore - usa um sobrenome só
    // com letras pra buscar, e um e-mail à parte pra garantir unicidade.
    const nameTag = `Buscaunica${Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 6) || "xyzabc"}`;
    const emailTag = uid("f10l4_search");
    const userIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const registered = await request(app).post("/api/auth/register").send({
        name: `Frente Dez Lote Quatro ${nameTag} User`,
        email: `${emailTag}_${i}@test.com`,
        password: PASSWORD,
        phone: `133${i}${Date.now().toString().slice(-7)}`,
        termsVersion: "2026.05",
        consentAccepted: true
      });
      userIds.push(registered.body.user.id);
      createdUserIds.push(registered.body.user.id);
    }

    const firstPage = await request(app)
      .get(`/api/admin/users/search?q=${encodeURIComponent(nameTag)}&page=1&limit=2`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.items).toHaveLength(2);
    expect(firstPage.body.total).toBe(3);
    expect(firstPage.body.totalPages).toBe(2);

    const secondPage = await request(app)
      .get(`/api/admin/users/search?q=${encodeURIComponent(nameTag)}&page=2&limit=2`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(secondPage.body.items).toHaveLength(1);

    const firstIds = firstPage.body.items.map((u: { id: string }) => u.id);
    const secondIds = secondPage.body.items.map((u: { id: string }) => u.id);
    expect(firstIds.filter((id: string) => secondIds.includes(id))).toHaveLength(0);
    expect([...firstIds, ...secondIds].sort()).toEqual([...userIds].sort());
  });
});
