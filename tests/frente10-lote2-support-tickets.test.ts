import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";

// Épico de Frentes, Frente 10, Lote 2: usuário não conseguia ler nem
// confiar na resposta do suporte.
// (1) Não existia endpoint de listagem de ticket pro dono - só criação.
// (2) Reabrir um assunto criava um ticket novo sem vínculo com o
//     ANSWERED anterior, perdendo o histórico da conversa pro admin.
// (3) replySupportTicket não validava o status atual - um segundo admin
//     podia sobrescrever a resposta do primeiro sem aviso nenhum.

const PASSWORD = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function uniqueEmail(prefix: string) {
  return `${uid(prefix)}@test.com`;
}

let adminId = "";
let adminToken = "";
let userAId = "";
let userAToken = "";
let userBId = "";
let userBToken = "";

describe("Frente 10, Lote 2 — suporte legível e protegido", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const adminEmail = env.ADMIN_ALLOWED_EMAILS[0];
    const adminReg = await request(app).post("/api/auth/register").send({
      name: "Frente Dez Lote Dois Admin",
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

    const userARegister = await request(app).post("/api/auth/register").send({
      name: "Frente Dez Lote Dois User A",
      email: uniqueEmail("f10l2_a"),
      password: PASSWORD,
      phone: `1188${Date.now().toString().slice(-8)}`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    userAToken = userARegister.body.accessToken;
    userAId = userARegister.body.user.id;

    const userBRegister = await request(app).post("/api/auth/register").send({
      name: "Frente Dez Lote Dois User B",
      email: uniqueEmail("f10l2_b"),
      password: PASSWORD,
      phone: `1199${Date.now().toString().slice(-8)}`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    userBToken = userBRegister.body.accessToken;
    userBId = userBRegister.body.user.id;
  });

  afterAll(async () => {
    await prisma.supportTicket.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.session.deleteMany({ where: { userId: { in: [userAId, userBId, adminId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await prisma.$disconnect();
  });

  it("usuário lista os próprios tickets e vê a resposta do admin depois de respondido", async () => {
    const create = await request(app)
      .post("/api/users/me/support-message")
      .set("Authorization", `Bearer ${userAToken}`)
      .send({ subject: "Dúvida sobre pagamento", message: "Como funciona o reembolso?" });
    expect(create.status).toBe(200);
    const ticketId = create.body.ticketId as string;

    const beforeReply = await request(app)
      .get("/api/users/me/support-tickets")
      .set("Authorization", `Bearer ${userAToken}`);
    expect(beforeReply.status).toBe(200);
    const beforeTicket = beforeReply.body.find((t: { id: string }) => t.id === ticketId);
    expect(beforeTicket.status).toBe("OPEN");
    expect(beforeTicket.adminResponse).toBeFalsy();

    const reply = await request(app)
      .patch(`/api/admin/support/tickets/${ticketId}/respond`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ responseMessage: "O reembolso é processado em até 5 dias úteis." });
    expect(reply.status).toBe(200);

    const afterReply = await request(app)
      .get("/api/users/me/support-tickets")
      .set("Authorization", `Bearer ${userAToken}`);
    const afterTicket = afterReply.body.find((t: { id: string }) => t.id === ticketId);
    expect(afterTicket.status).toBe("ANSWERED");
    expect(afterTicket.adminResponse).toBe("O reembolso é processado em até 5 dias úteis.");
  });

  it("usuário não vê ticket de outro usuário (IDOR)", async () => {
    const create = await request(app)
      .post("/api/users/me/support-message")
      .set("Authorization", `Bearer ${userBToken}`)
      .send({ subject: "Assunto do B", message: "Mensagem privada do usuário B" });
    const ticketId = create.body.ticketId as string;

    const asA = await request(app)
      .get("/api/users/me/support-tickets")
      .set("Authorization", `Bearer ${userAToken}`);
    expect(asA.body.some((t: { id: string }) => t.id === ticketId)).toBe(false);
  });

  it("reabrir com um ANSWERED recente grava o vínculo parentTicketId", async () => {
    const first = await request(app)
      .post("/api/users/me/support-message")
      .set("Authorization", `Bearer ${userAToken}`)
      .send({ subject: "Problema recorrente", message: "Primeira mensagem" });
    const firstId = first.body.ticketId as string;

    await request(app)
      .patch(`/api/admin/support/tickets/${firstId}/respond`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ responseMessage: "Resolvido, qualquer coisa reabra." });

    const second = await request(app)
      .post("/api/users/me/support-message")
      .set("Authorization", `Bearer ${userAToken}`)
      .send({ subject: "Problema recorrente", message: "Voltou a acontecer" });
    const secondId = second.body.ticketId as string;

    const stored = await prisma.supportTicket.findUniqueOrThrow({ where: { id: secondId } });
    expect(stored.parentTicketId).toBe(firstId);
  });

  it("duas respostas ao mesmo ticket: a segunda recebe 409, a resposta original permanece intacta", async () => {
    const create = await request(app)
      .post("/api/users/me/support-message")
      .set("Authorization", `Bearer ${userAToken}`)
      .send({ subject: "Corrida entre admins", message: "Mensagem de teste" });
    const ticketId = create.body.ticketId as string;

    const firstReply = await request(app)
      .patch(`/api/admin/support/tickets/${ticketId}/respond`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ responseMessage: "Resposta do primeiro admin" });
    expect(firstReply.status).toBe(200);

    const secondReply = await request(app)
      .patch(`/api/admin/support/tickets/${ticketId}/respond`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ responseMessage: "Resposta do segundo admin (não devia sobrescrever)" });
    expect(secondReply.status).toBe(409);

    const stored = await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(stored.adminResponse).toBe("Resposta do primeiro admin");
  });
});
