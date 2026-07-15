import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";

const PASSWORD = "Test1234";
let token = "";
let userId = "";
let clientEmail = "";
let providerToken = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// Changing the password blacklists every access token issued at or before that
// same second; sleeping past the second boundary avoids a freshly-issued token
// being born already blacklisted.
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("users — extended profile, security and preferences", () => {
  beforeAll(async () => {
    await prisma.$connect();

    // CLIENT user
    clientEmail = `${uid("usr_client")}@test.com`;
    const phone = `115${Date.now().toString().slice(-9)}`;
    const reg = await request(app).post("/api/auth/register").send({
      name: "Extended Client",
      email: clientEmail,
      password: PASSWORD,
      phone,
      termsVersion: "2026.05",
      consentAccepted: true,
    });
    token = reg.body.accessToken;
    userId = reg.body.user.id;

    // PROVIDER user + profile
    const category = await prisma.serviceCategory.create({
      data: { name: `UsrCat_${Date.now()}`, description: "test" },
    });
    categoryId = category.id;

    const provEmail = `${uid("usr_prov")}@test.com`;
    const provPhone = `116${Date.now().toString().slice(-9)}`;
    const provReg = await request(app).post("/api/auth/register").send({
      name: "Extended Provider",
      email: provEmail,
      password: PASSWORD,
      phone: provPhone,
      role: "PROVIDER",
      termsVersion: "2026.05",
      consentAccepted: true,
    });
    providerToken = provReg.body.accessToken;
    providerUserId = provReg.body.user.id;

    const profile = await request(app)
      .post("/api/providers/profile")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({
        displayName: "Extended Provider",
        bio: "Testing user extended routes",
        experienceYears: 3,
        priceCents: 12000,
        categoryIds: [categoryId],
      });
    providerId = profile.body.id;
  });

  afterAll(async () => {
    // clientAnamnesis and providerBankAccount cascade on User/ProviderProfile delete
    await prisma.providerCategory.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [userId, providerUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  // ── GET /me ───────────────────────────────────────────────────────────────
  it("GET /users/me returns current user", async () => {
    const res = await request(app)
      .get("/api/users/me")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(userId);
  });

  it("GET /users/me rejects unauthenticated", async () => {
    const res = await request(app).get("/api/users/me");
    expect(res.status).toBe(401);
  });

  // ── PATCH /me ─────────────────────────────────────────────────────────────
  it("PATCH /users/me updates display name", async () => {
    const res = await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Updated Extended Client" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated Extended Client");
  });

  it("PATCH /users/me rejects empty name", async () => {
    const res = await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "" });
    expect(res.status).toBe(400);
  });

  // ── Anamnesis (CLIENT only) ────────────────────────────────────────────────
  it("GET /users/me/anamnesis returns empty for new client", async () => {
    const res = await request(app)
      .get("/api/users/me/anamnesis")
      .set("Authorization", `Bearer ${token}`);
    expect([200, 404]).toContain(res.status);
  });

  it("PUT /users/me/anamnesis creates anamnesis", async () => {
    const res = await request(app)
      .put("/api/users/me/anamnesis")
      .set("Authorization", `Bearer ${token}`)
      .send({
        weight: 80,
        height: 175,
        goal: "LOSE_WEIGHT",
        activityLevel: "MODERATE",
        healthIssues: "Nenhum",
      });
    expect(res.status).toBe(200);
  });

  it("PUT /users/me/anamnesis rejects PROVIDER role", async () => {
    const res = await request(app)
      .put("/api/users/me/anamnesis")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ weight: 75, height: 180, goal: "GAIN_MUSCLE", activityLevel: "HIGH" });
    expect(res.status).toBe(403);
  });

  // ── Bank account (PROVIDER only) ──────────────────────────────────────────
  it("GET /users/me/provider-bank-account returns data", async () => {
    const res = await request(app)
      .get("/api/users/me/provider-bank-account")
      .set("Authorization", `Bearer ${providerToken}`);
    expect([200, 404]).toContain(res.status);
  });

  it("PUT /users/me/provider-bank-account sets bank info", async () => {
    const res = await request(app)
      .put("/api/users/me/provider-bank-account")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({
        holderName: "Extended Provider",
        holderDocument: "12345678909",
        bankName: "341 - Itaú",
        agency: "0001",
        accountNumber: "123456",
        accountDigit: "7",
        accountType: "CHECKING",
      });
    expect(res.status).toBe(200);
  });

  it("GET /users/me/provider-bank-account rejects CLIENT role", async () => {
    const res = await request(app)
      .get("/api/users/me/provider-bank-account")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  // ── Security ──────────────────────────────────────────────────────────────
  it("POST /users/me/security/password changes password", async () => {
    const res = await request(app)
      .post("/api/users/me/security/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: PASSWORD, newPassword: "NewTest5678", confirmNewPassword: "NewTest5678" });
    expect([200, 204]).toContain(res.status);

    // Changing the password blacklists the access token used to change it, so
    // re-login with the new password before reverting.
    await sleep(1100);
    const reloginNew = await request(app).post("/api/auth/login").send({ email: clientEmail, password: "NewTest5678" });
    expect(reloginNew.body.accessToken).toBeTruthy();

    const revertRes = await request(app)
      .post("/api/users/me/security/password")
      .set("Authorization", `Bearer ${reloginNew.body.accessToken}`)
      .send({ currentPassword: "NewTest5678", newPassword: PASSWORD, confirmNewPassword: PASSWORD });
    expect([200, 204]).toContain(revertRes.status);

    // That revert blacklists reloginNew's token too; re-login again for the tests that follow.
    await sleep(1100);
    const reloginOriginal = await request(app).post("/api/auth/login").send({ email: clientEmail, password: PASSWORD });
    expect(reloginOriginal.body.accessToken).toBeTruthy();
    token = reloginOriginal.body.accessToken;
  });

  it("POST /users/me/security/password rejects wrong current password", async () => {
    const res = await request(app)
      .post("/api/users/me/security/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "WrongPassword", newPassword: "NewTest5678", confirmNewPassword: "NewTest5678" });
    expect(res.status).toBe(400);
  });

  it("GET /users/me/security/recovery-email returns data", async () => {
    const res = await request(app)
      .get("/api/users/me/security/recovery-email")
      .set("Authorization", `Bearer ${token}`);
    expect([200, 404]).toContain(res.status);
  });

  it("PUT /users/me/security/recovery-email sets recovery email", async () => {
    const res = await request(app)
      .put("/api/users/me/security/recovery-email")
      .set("Authorization", `Bearer ${token}`)
      .send({ recoveryEmail: `recovery_${uid("rec")}@test.com` });
    expect(res.status).toBe(200);
  });

  it("PUT /users/me/security/recovery-email rejects invalid email format", async () => {
    const res = await request(app)
      .put("/api/users/me/security/recovery-email")
      .set("Authorization", `Bearer ${token}`)
      .send({ recoveryEmail: "not-an-email" });
    expect(res.status).toBe(400);
  });

  // ── Notification preferences ───────────────────────────────────────────────
  it("GET /users/me/notifications/preferences returns preferences", async () => {
    const res = await request(app)
      .get("/api/users/me/notifications/preferences")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("PUT /users/me/notifications/preferences updates preferences", async () => {
    const res = await request(app)
      .put("/api/users/me/notifications/preferences")
      .set("Authorization", `Bearer ${token}`)
      .send({
        preferences: [
          { type: "MARKETING", enabled: false },
          { type: "BOOKINGS", enabled: true },
        ],
      });
    expect(res.status).toBe(200);
  });

  // ── Support message ───────────────────────────────────────────────────────
  it("POST /users/me/support-message sends message", async () => {
    const res = await request(app)
      .post("/api/users/me/support-message")
      .set("Authorization", `Bearer ${token}`)
      .send({ subject: "Teste de suporte", message: "Esta é uma mensagem de teste enviada pelos testes automatizados." });
    expect([200, 201, 204]).toContain(res.status);
  });

  it("POST /users/me/support-message rejects missing message", async () => {
    const res = await request(app)
      .post("/api/users/me/support-message")
      .set("Authorization", `Bearer ${token}`)
      .send({ subject: "Sem mensagem" });
    expect(res.status).toBe(400);
  });

  // ── Consent ───────────────────────────────────────────────────────────────
  it("POST /users/me/consent records consent", async () => {
    const res = await request(app)
      .post("/api/users/me/consent")
      .set("Authorization", `Bearer ${token}`)
      .send({ termsVersion: "2026.06", consentAccepted: true });
    expect([200, 201]).toContain(res.status);
  });

  // ── Data export ───────────────────────────────────────────────────────────
  it("GET /users/me/data-export returns export", async () => {
    const res = await request(app)
      .get("/api/users/me/data-export")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
