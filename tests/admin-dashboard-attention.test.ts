import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";

// Raio-X de pagamentos, Rodada 4, Lote 8: painel geral do admin só mostrava
// contagem de usuários e ranking de agendamentos — sem faturamento, disputas
// abertas, dívidas em aberto, CREFs pendentes ou tickets sem resposta.
// getDashboardOverview ganhou o bloco attentionNeeded; este teste confirma
// que os números batem com registros reais criados no período.

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
let providerId = "";
let categoryId = "";
let adminId = "";
let adminToken = "";
const bookingIds: string[] = [];
const disputeCaseIds: string[] = [];
const debtIds: string[] = [];
const ticketIds: string[] = [];

describe("GET /admin/dashboard/overview: bloco attentionNeeded (Rodada 4, Lote 8)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `DASH_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await registerUser("dash_client", "Dash Client");
    clientId = client.userId;

    const provider = await registerUser("dash_provider", "Dash Provider", "PROVIDER");
    providerUserId = provider.userId;
    const providerProfile = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Dash Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        crefValidationStatus: "IN_REVIEW"
      }
    });
    providerId = providerProfile.id;

    const adminReg = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Dash Admin",
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

    const now = new Date();
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: now,
        priceCents: 15000,
        status: "COMPLETED"
      }
    });
    bookingIds.push(booking.id);

    const disputeCase = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", clientId, providerId, amountCents: 5000, status: "OPEN" }
    });
    disputeCaseIds.push(disputeCase.id);

    const debt = await prisma.debtRecord.create({
      data: {
        disputeCaseId: disputeCase.id,
        debtorType: "CLIENT",
        clientId,
        amountCents: 3000,
        reason: "teste de dashboard",
        status: "PENDING"
      }
    });
    debtIds.push(debt.id);

    const ticket = await prisma.supportTicket.create({
      data: { userId: clientId, subject: "Dúvida de teste", message: "Mensagem de teste", status: "OPEN" }
    });
    ticketIds.push(ticket.id);
  });

  afterAll(async () => {
    await prisma.supportTicket.deleteMany({ where: { id: { in: ticketIds } } });
    await prisma.debtRecord.deleteMany({ where: { id: { in: debtIds } } });
    await prisma.disputeCase.deleteMany({ where: { id: { in: disputeCaseIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [clientId, providerUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("reflete faturamento realizado, disputas abertas, dívidas pendentes, CREFs em análise e tickets abertos", async () => {
    const res = await request(app)
      .get("/api/admin/dashboard/overview")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const { attentionNeeded } = res.body;
    expect(attentionNeeded).toBeDefined();
    expect(attentionNeeded.revenueThisMonthCents).toBeGreaterThanOrEqual(15000);
    expect(attentionNeeded.openDisputesCount).toBeGreaterThanOrEqual(1);
    expect(attentionNeeded.pendingDebtsCount).toBeGreaterThanOrEqual(1);
    expect(attentionNeeded.pendingDebtsAmountCents).toBeGreaterThanOrEqual(3000);
    expect(attentionNeeded.crefInReviewCount).toBeGreaterThanOrEqual(1);
    expect(attentionNeeded.openTicketsCount).toBeGreaterThanOrEqual(1);
  });
});
