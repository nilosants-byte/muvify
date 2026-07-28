import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { Payment } from "mercadopago";
import { BookingStatus, PaymentMethod, PaymentStatus } from "@prisma/client";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";

// Raio-X de pagamentos, Rodada 3, Lote 3: mecanismo minimo de suspensao de
// conta (Termos, Clausula 19.2, ja prometia isso e nao existia nenhuma acao
// admin pra executar). Cobre tambem uma regressao encontrada de bandeja:
// o schema de validacao de resolveCase nunca ganhou "RETRY_CAPTURE" quando
// essa resolucao foi criada (Rodada 2, Lote 2), entao toda chamada real via
// API/mobile era rejeitada com 400 antes de chegar no service.

const PASSWORD = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// Blacklist de token e granularidade de segundo (payload.iat <= blacklistedSince):
// preciso esperar passar o segundo antes de logar de novo e considerar o token novo valido.
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

let clientEmail = "";
let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
let adminId = "";
let adminToken = "";
const bookingIds: string[] = [];
const disputeCaseIds: string[] = [];

describe("Suspensao de conta pelo admin (Rodada 3, Lote 3)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `SUSP_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    clientEmail = `${uid("susp_client")}@test.com`;
    const client = await registerUser("susp_client", "Susp Client", undefined, clientEmail);
    clientId = client.userId;

    const provider = await registerUser("susp_provider", "Susp Provider", "PROVIDER");
    providerUserId = provider.userId;
    const providerProfile = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Susp Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 9000,
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = providerProfile.id;

    // O role efetivo ADMIN so e calculado no login se o e-mail estiver na
    // allowlist E o e-mail estiver verificado — por isso o findUnique+update
    // direto (registro comum nao verifica e-mail automaticamente).
    const admin = await registerUser("susp_admin", "Susp Admin", undefined, env.ADMIN_ALLOWED_EMAILS[0]);
    adminId = admin.userId;
    await prisma.user.update({ where: { id: adminId }, data: { emailVerifiedAt: new Date() } });
    const adminLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: env.ADMIN_ALLOWED_EMAILS[0], password: PASSWORD });
    adminToken = adminLogin.body.accessToken;
  });

  afterAll(async () => {
    await prisma.disputeCase.deleteMany({ where: { id: { in: disputeCaseIds } } });
    await prisma.payment.deleteMany({ where: { booking: { id: { in: bookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [clientId, providerUserId, adminId] } } });
    // writeAdminAuditLog e fire-and-forget (void) — apaga por ultimo pra nao
    // disputar com uma escrita ainda em andamento (mesmo cuidado do Lote 1).
    await prisma.adminAuditLog.deleteMany({ where: { adminId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId, adminId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("um usuario comum nao consegue suspender ninguem via HTTP (403)", async () => {
    const clientLogin = await request(app).post("/api/auth/login").send({ email: clientEmail, password: PASSWORD });
    const res = await request(app)
      .post(`/api/admin/users/${providerUserId}/suspend`)
      .set("Authorization", `Bearer ${clientLogin.body.accessToken}`)
      .send({ reason: "teste" });
    expect(res.status).toBe(403);
  });

  it("admin suspende um usuario: bloqueia login e revoga token ja emitido", async () => {
    const preSuspendLogin = await request(app).post("/api/auth/login").send({ email: clientEmail, password: PASSWORD });
    const tokenIssuedBeforeSuspension = preSuspendLogin.body.accessToken as string;
    expect(tokenIssuedBeforeSuspension).toBeTruthy();

    const suspendRes = await request(app)
      .post(`/api/admin/users/${clientId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "Fraude confirmada em analise manual." });
    expect(suspendRes.status).toBe(200);
    expect(suspendRes.body.suspendedAt).toBeTruthy();
    expect(suspendRes.body.suspensionReason).toBe("Fraude confirmada em analise manual.");

    // Token emitido ANTES da suspensao precisa parar de funcionar imediatamente.
    const blockedRequest = await request(app)
      .get("/api/bookings/me")
      .set("Authorization", `Bearer ${tokenIssuedBeforeSuspension}`);
    expect(blockedRequest.status).toBe(401);

    // Login novo tambem precisa ser recusado enquanto suspenso.
    const loginAttempt = await request(app).post("/api/auth/login").send({ email: clientEmail, password: PASSWORD });
    expect(loginAttempt.status).toBe(403);
    expect(loginAttempt.body.message).toContain("Fraude confirmada");

    let auditLog = null;
    for (let attempt = 0; attempt < 5 && !auditLog; attempt++) {
      auditLog = await prisma.adminAuditLog.findFirst({
        where: { adminId, action: "USER_SUSPENDED", targetId: clientId }
      });
      if (!auditLog) await sleep(150);
    }
    expect(auditLog).not.toBeNull();
  });

  it("nao e possivel suspender o mesmo usuario duas vezes (400)", async () => {
    const res = await request(app)
      .post(`/api/admin/users/${clientId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "Tentativa duplicada" });
    expect(res.status).toBe(400);
  });

  it("nao e possivel suspender uma conta de administrador (400)", async () => {
    const res = await request(app)
      .post(`/api/admin/users/${adminId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "teste" });
    expect(res.status).toBe(400);
  });

  it("reativar libera o login de novo", async () => {
    const res = await request(app)
      .post(`/api/admin/users/${clientId}/reactivate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send();
    expect(res.status).toBe(200);
    expect(res.body.suspendedAt).toBeNull();

    // Espera passar o segundo pra nao correr risco do novo login gerar um
    // token com iat igual ao momento em que o token antigo foi blacklistado.
    await sleep(1100);
    const reloginRes = await request(app).post("/api/auth/login").send({ email: clientEmail, password: PASSWORD });
    expect(reloginRes.status).toBe(200);
    expect(reloginRes.body.accessToken).toBeTruthy();
  });

  it("nao e possivel reativar quem nao esta suspenso (400)", async () => {
    const res = await request(app)
      .post(`/api/admin/users/${clientId}/reactivate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send();
    expect(res.status).toBe(400);
  });

  it("regressao: resolver disputa com RETRY_CAPTURE via HTTP nao e mais rejeitado pela validacao (Zod)", async () => {
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        priceCents: 9000,
        status: BookingStatus.COMPLETED
      }
    });
    bookingIds.push(booking.id);

    const mpPaymentId = `mp_${uid("retryhttp")}`;
    await prisma.payment.create({
      data: {
        bookingId: booking.id,
        amountCents: 9000,
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.AUTHORIZED,
        mpPaymentId,
        authorizedAt: new Date()
      }
    });

    const disputeCase = await prisma.disputeCase.create({
      data: { type: "CAPTURE_FAILED", clientId, providerId, amountCents: 9000, mpPaymentId, bookingId: booking.id }
    });
    disputeCaseIds.push(disputeCase.id);

    vi.spyOn(Payment.prototype, "capture").mockResolvedValueOnce({} as any);

    const res = await request(app)
      .post(`/api/admin/disputes/${disputeCase.id}/resolve`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ resolution: "RETRY_CAPTURE", note: "Cartao regularizado, tentando capturar de novo." });

    expect(res.status).toBe(200);
    expect(res.body.resolution).toBe("CAPTURED");

    vi.restoreAllMocks();
  });
});
