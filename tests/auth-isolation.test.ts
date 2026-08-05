import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { clearTokenBlacklist } from "../src/shared/security/token-blacklist";
import { encryptJson } from "../src/shared/utils/encryption";

const password = "Test1234";

function uniqueEmail(prefix: string) {
  return `${prefix}_iso_${Date.now()}@test.com`;
}

let clientAToken = "";
let clientBToken = "";
let providerAToken = "";
let clientAId = "";
let clientBId = "";
let providerAId = "";
let providerAUserId = "";
let categoryId = "";
let bookingId = "";

describe("auth-isolation", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `Cat_iso_${Date.now()}`, description: "Isolation tests" }
    });
    categoryId = category.id;

    const clientAEmail = uniqueEmail("clientA");
    const clientBEmail = uniqueEmail("clientB");
    const providerAEmail = uniqueEmail("providerA");

    const regA = await request(app)
      .post("/api/auth/register")
      .send({
        name: "ClientA",
        email: clientAEmail,
        password,
        phone: `1191${Date.now().toString().slice(-7)}`,
        termsVersion: "2026.05",
        consentAccepted: true
      });
    clientAToken = regA.body.accessToken;
    clientAId = regA.body.user.id;

    const regB = await request(app)
      .post("/api/auth/register")
      .send({
        name: "ClientB",
        email: clientBEmail,
        password,
        phone: `1192${Date.now().toString().slice(-7)}`,
        termsVersion: "2026.05",
        consentAccepted: true
      });
    clientBToken = regB.body.accessToken;
    clientBId = regB.body.user.id;

    const regP = await request(app)
      .post("/api/auth/register")
      .send({
        name: "ProviderA",
        email: providerAEmail,
        password,
        phone: `1193${Date.now().toString().slice(-7)}`,
        role: "PROVIDER",
        termsVersion: "2026.05",
        consentAccepted: true
      });
    providerAToken = regP.body.accessToken;
    providerAUserId = regP.body.user.id;

    const profile = await request(app)
      .post("/api/providers/profile")
      .set("Authorization", `Bearer ${providerAToken}`)
      .send({
        displayName: "ProA",
        bio: "Isolamento",
        experienceYears: 1,
        priceCents: 10000,
        categoryIds: [categoryId]
      });
    providerAId = profile.body.id;

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const weekday = tomorrow.getUTCDay();
    await request(app)
      .post("/api/availability")
      .set("Authorization", `Bearer ${providerAToken}`)
      .send({ weekday, startTime: "09:00", endTime: "17:00", isActive: true });

    await prisma.clientAnamnesis.upsert({
      where: { clientId: clientAId },
      update: { status: "COMPLETED", answers: encryptJson({}) },
      create: { clientId: clientAId, status: "COMPLETED", answers: encryptJson({}) }
    });

    const scheduledAt = new Date(
      Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), 10, 0, 0)
    ).toISOString();

    const bookingRes = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${clientAToken}`)
      .send({ providerId: providerAId, categoryId, scheduledAt, notes: "Isolamento", acknowledgedImmediateExecution: true });

    if (bookingRes.status === 201 && bookingRes.body?.id) {
      bookingId = bookingRes.body.id;
    } else {
      const fb = await prisma.booking.create({
        data: { clientId: clientAId, providerId: providerAId, categoryId, scheduledAt: new Date(scheduledAt), priceCents: 10000 }
      });
      bookingId = fb.id;
    }
  });

  afterAll(async () => {
    await prisma.clientAnamnesis.deleteMany({ where: { clientId: clientAId } });
    await prisma.booking.deleteMany({ where: { id: bookingId } });
    await prisma.favorite.deleteMany({ where: { OR: [{ providerId: providerAId }] } });
    await prisma.availability.deleteMany({ where: { providerId: providerAId } });
    await prisma.providerCategory.deleteMany({ where: { providerId: providerAId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerAId } });
    await prisma.session.deleteMany({ where: { userId: { in: [clientAId, clientBId, providerAUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [clientAId, clientBId, providerAUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await clearTokenBlacklist(clientAId);
    await clearTokenBlacklist(clientBId);
    await clearTokenBlacklist(providerAUserId);
    await prisma.$disconnect();
  });

  // ── Unauthenticated ────────────────────────────────────────────────────────

  it("rejects request with no token (401)", async () => {
    const res = await request(app).get("/api/bookings/me");
    expect(res.status).toBe(401);
  });

  it("rejects request with garbage token (401)", async () => {
    const res = await request(app)
      .get("/api/bookings/me")
      .set("Authorization", "Bearer not.a.valid.jwt.token");
    expect(res.status).toBe(401);
  });

  // ── Role enforcement ───────────────────────────────────────────────────────

  it("blocks CLIENT from provider-only credentials endpoint (403)", async () => {
    const res = await request(app)
      .get("/api/providers/me/credentials")
      .set("Authorization", `Bearer ${clientAToken}`);
    expect(res.status).toBe(403);
  });

  it("blocks PROVIDER from admin endpoint (403)", async () => {
    const res = await request(app)
      .get("/api/admin/dashboard/overview")
      .set("Authorization", `Bearer ${providerAToken}`);
    expect(res.status).toBe(403);
  });

  it("blocks CLIENT from admin endpoint (403)", async () => {
    const res = await request(app)
      .get("/api/admin/dashboard/overview")
      .set("Authorization", `Bearer ${clientAToken}`);
    expect(res.status).toBe(403);
  });

  // ── Cross-user booking isolation ───────────────────────────────────────────

  it("blocks clientB from updating clientA booking status (403 or 404)", async () => {
    const res = await request(app)
      .patch(`/api/bookings/${bookingId}/status`)
      .set("Authorization", `Bearer ${clientBToken}`)
      .send({ status: "CANCELLED" });
    expect([403, 404]).toContain(res.status);
  });

  it("blocks clientB from getting clientA attendance code (403 or 404)", async () => {
    const res = await request(app)
      .get(`/api/bookings/${bookingId}/attendance-code`)
      .set("Authorization", `Bearer ${clientBToken}`);
    expect([403, 404]).toContain(res.status);
  });

  // ── Token blacklist ──────────────────────────────────────

  it("invalidates access token after logout", async () => {
    // Register fresh user so we have a clean session
    const freshEmail = `blacklist_${Date.now()}@test.com`;
    const freshPhone = `1194${Date.now().toString().slice(-7)}`;
    const reg = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Fresh",
        email: freshEmail,
        password,
        phone: freshPhone,
        termsVersion: "2026.05",
        consentAccepted: true
      });

    const accessToken = reg.body.accessToken as string;
    const refreshToken = reg.body.refreshToken as string;
    const freshUserId = reg.body.user.id as string;

    // Token works before logout
    const before = await request(app)
      .get("/api/bookings/me")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(before.status).toBe(200);

    // Logout
    await request(app).post("/api/auth/logout").send({ refreshToken });

    // Wait 100ms so iat (issued-at second) is earlier than the blacklist timestamp
    await new Promise((r) => setTimeout(r, 100));

    // Same access token should now be rejected
    const after = await request(app)
      .get("/api/bookings/me")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(after.status).toBe(401);

    // Cleanup
    await prisma.session.deleteMany({ where: { userId: freshUserId } });
    await prisma.user.deleteMany({ where: { id: freshUserId } });
    await clearTokenBlacklist(freshUserId);
  });
});
