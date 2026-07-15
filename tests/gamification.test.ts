import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";

const PASSWORD = "Test1234";
let token = "";
let userId = "";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

describe("gamification", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const email = `${uid("gami")}@test.com`;
    const phone = `117${Date.now().toString().slice(-9)}`;
    const reg = await request(app).post("/api/auth/register").send({
      name: "Gamification User",
      email,
      password: PASSWORD,
      phone,
      termsVersion: "2026.05",
      consentAccepted: true,
    });
    token = reg.body.accessToken;
    userId = reg.body.user.id;
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  // ── Profile ───────────────────────────────────────────────────────────────
  it("GET /gamification/me returns gamification profile", async () => {
    const res = await request(app)
      .get("/api/gamification/me")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("GET /gamification/me rejects unauthenticated", async () => {
    const res = await request(app).get("/api/gamification/me");
    expect(res.status).toBe(401);
  });

  // ── Achievements ──────────────────────────────────────────────────────────
  it("GET /gamification/achievements returns achievements list", async () => {
    const res = await request(app)
      .get("/api/gamification/achievements")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /gamification/achievements rejects unauthenticated", async () => {
    const res = await request(app).get("/api/gamification/achievements");
    expect(res.status).toBe(401);
  });

  // ── Training days ─────────────────────────────────────────────────────────
  it("PATCH /gamification/training-days sets training days", async () => {
    const res = await request(app)
      .patch("/api/gamification/training-days")
      .set("Authorization", `Bearer ${token}`)
      .send({ trainingDaysPerWeek: 4 });
    expect(res.status).toBe(204);
  });

  it("PATCH /gamification/training-days rejects out-of-range value", async () => {
    const res = await request(app)
      .patch("/api/gamification/training-days")
      .set("Authorization", `Bearer ${token}`)
      .send({ trainingDaysPerWeek: 8 });
    expect(res.status).toBe(400);
  });

  it("PATCH /gamification/training-days rejects zero", async () => {
    const res = await request(app)
      .patch("/api/gamification/training-days")
      .set("Authorization", `Bearer ${token}`)
      .send({ trainingDaysPerWeek: 0 });
    expect(res.status).toBe(400);
  });

  it("PATCH /gamification/training-days rejects unauthenticated", async () => {
    const res = await request(app)
      .patch("/api/gamification/training-days")
      .send({ trainingDaysPerWeek: 3 });
    expect(res.status).toBe(401);
  });
});
