import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";

const PASSWORD = "Test1234";
let providerToken = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
let availabilityId = "";
let blockId = "";
let calendarEventId = "";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

describe("availability, manual-blocks and calendar", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `AvailCat_${Date.now()}`, description: "test" },
    });
    categoryId = category.id;

    const email = `${uid("avail_prov")}@test.com`;
    const phone = `112${Date.now().toString().slice(-9)}`;
    const reg = await request(app).post("/api/auth/register").send({
      name: "Availability Provider",
      email,
      password: PASSWORD,
      phone,
      role: "PROVIDER",
      termsVersion: "2026.05",
      consentAccepted: true,
    });
    providerToken = reg.body.accessToken;
    providerUserId = reg.body.user.id;

    const profile = await request(app)
      .post("/api/providers/profile")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({
        displayName: "Availability Provider",
        bio: "Testing availability and calendar",
        experienceYears: 1,
        priceCents: 8000,
        categoryIds: [categoryId],
      });
    providerId = profile.body.id;
  });

  afterAll(async () => {
    await prisma.providerCalendarEvent.deleteMany({ where: { providerId } });
    await prisma.providerManualBlock.deleteMany({ where: { providerId } });
    await prisma.availability.deleteMany({ where: { providerId } });
    await prisma.providerCategory.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: providerUserId } });
    await prisma.user.deleteMany({ where: { id: providerUserId } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  // ── Availability ──────────────────────────────────────────────────────────
  it("GET /availability/me returns empty list initially", async () => {
    const res = await request(app)
      .get("/api/availability/me")
      .set("Authorization", `Bearer ${providerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("POST /availability creates a slot", async () => {
    const res = await request(app)
      .post("/api/availability")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ weekday: 1, startTime: "08:00", endTime: "17:00", isActive: true });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    availabilityId = res.body.id;
  });

  it("POST /availability rejects invalid time (end before start)", async () => {
    const res = await request(app)
      .post("/api/availability")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ weekday: 2, startTime: "17:00", endTime: "08:00" });
    expect(res.status).toBe(400);
  });

  it("POST /availability rejects weekday out of range", async () => {
    const res = await request(app)
      .post("/api/availability")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ weekday: 8, startTime: "09:00", endTime: "17:00" });
    expect(res.status).toBe(400);
  });

  it("DELETE /availability/:id removes slot", async () => {
    const res = await request(app)
      .delete(`/api/availability/${availabilityId}`)
      .set("Authorization", `Bearer ${providerToken}`);
    expect(res.status).toBe(204);
  });

  it("GET /availability/me rejects unauthenticated", async () => {
    const res = await request(app).get("/api/availability/me");
    expect(res.status).toBe(401);
  });

  it("POST /availability rejects CLIENT role", async () => {
    const email = `${uid("avail_client")}@test.com`;
    const phone = `110${Date.now().toString().slice(-9)}`;
    const reg = await request(app).post("/api/auth/register").send({
      name: "Client Avail",
      email,
      password: PASSWORD,
      phone,
      termsVersion: "2026.05",
      consentAccepted: true,
    });
    const clientToken = reg.body.accessToken;
    const clientId = reg.body.user.id;

    const res = await request(app)
      .post("/api/availability")
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ weekday: 1, startTime: "09:00", endTime: "18:00" });
    expect(res.status).toBe(403);

    await prisma.session.deleteMany({ where: { userId: clientId } });
    await prisma.user.deleteMany({ where: { id: clientId } });
  });

  // ── Manual Blocks ─────────────────────────────────────────────────────────
  it("GET /manual-blocks returns list", async () => {
    const res = await request(app)
      .get("/api/manual-blocks")
      .set("Authorization", `Bearer ${providerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("POST /manual-blocks creates a block", async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const date = tomorrow.toISOString().slice(0, 10);
    const res = await request(app)
      .post("/api/manual-blocks")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ date, startTime: "12:00", endTime: "14:00", label: "Almoço" });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    blockId = res.body.id;
  });

  it("POST /manual-blocks rejects past date", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const date = yesterday.toISOString().slice(0, 10);
    const res = await request(app)
      .post("/api/manual-blocks")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ date, startTime: "12:00", endTime: "14:00", label: "Passado" });
    expect(res.status).toBe(400);
  });

  it("DELETE /manual-blocks/:id removes block", async () => {
    const res = await request(app)
      .delete(`/api/manual-blocks/${blockId}`)
      .set("Authorization", `Bearer ${providerToken}`);
    expect(res.status).toBe(204);
  });

  // ── Calendar ──────────────────────────────────────────────────────────────
  it("GET /providers/dashboard/calendar returns calendar", async () => {
    const res = await request(app)
      .get("/api/providers/dashboard/calendar")
      .set("Authorization", `Bearer ${providerToken}`);
    expect(res.status).toBe(200);
  });

  it("POST /providers/dashboard/calendar/manual creates event", async () => {
    const start = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
    const end = new Date(Date.now() + 2 * 24 * 3600 * 1000 + 3600 * 1000).toISOString();
    const res = await request(app)
      .post("/api/providers/dashboard/calendar/manual")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ title: "Evento Teste", startsAt: start, endsAt: end });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    calendarEventId = res.body.id;
  });

  it("POST /providers/dashboard/calendar/manual rejects missing title", async () => {
    const start = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
    const end = new Date(Date.now() + 3 * 24 * 3600 * 1000 + 3600 * 1000).toISOString();
    const res = await request(app)
      .post("/api/providers/dashboard/calendar/manual")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ startsAt: start, endsAt: end });
    expect(res.status).toBe(400);
  });

  it("PATCH /providers/dashboard/calendar/manual/:id updates event", async () => {
    const res = await request(app)
      .patch(`/api/providers/dashboard/calendar/manual/${calendarEventId}`)
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ title: "Evento Atualizado" });
    expect(res.status).toBe(200);
  });

  it("DELETE /providers/dashboard/calendar/manual/:id removes event", async () => {
    const res = await request(app)
      .delete(`/api/providers/dashboard/calendar/manual/${calendarEventId}`)
      .set("Authorization", `Bearer ${providerToken}`);
    expect(res.status).toBe(204);
  });

  // ── Public schedule preview ───────────────────────────────────────────────
  it("GET /providers/:providerId/schedule-preview is public", async () => {
    // Only CREF-approved providers are exposed publicly.
    await prisma.providerProfile.update({
      where: { id: providerId },
      data: { crefValidationStatus: "APPROVED" },
    });

    const res = await request(app).get(`/api/providers/${providerId}/schedule-preview`);
    expect(res.status).toBe(200);
  });
});
