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

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

describe("exercises", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `ExCat_${Date.now()}`, description: "test" },
    });
    categoryId = category.id;

    const email = `${uid("ex_prov")}@test.com`;
    const phone = `111${Date.now().toString().slice(-9)}`;
    const reg = await request(app).post("/api/auth/register").send({
      name: "Exercise Provider",
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
        displayName: "Exercise Provider",
        bio: "Testing exercises",
        experienceYears: 2,
        priceCents: 9000,
        categoryIds: [categoryId],
      });
    providerId = profile.body.id;
  });

  afterAll(async () => {
    // exercises cascade on providerProfile delete
    await prisma.providerCategory.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: providerUserId } });
    await prisma.user.deleteMany({ where: { id: providerUserId } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  // ── Prebuilt (public) ─────────────────────────────────────────────────────
  it("GET /exercises/prebuilt is public", async () => {
    const res = await request(app).get("/api/exercises/prebuilt");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /exercises/prebuilt filters by category", async () => {
    const res = await request(app).get("/api/exercises/prebuilt?category=Peito");
    expect(res.status).toBe(200);
  });

  it("GET /exercises/prebuilt filters by search query", async () => {
    const res = await request(app).get("/api/exercises/prebuilt?q=supino");
    expect(res.status).toBe(200);
  });

  // ── Provider exercises ────────────────────────────────────────────────────
  // Segunda camada: criação/edição/exclusão de exercício virou exclusiva do
  // admin (src/modules/admin/routes/admin.routes.ts) — as rotas POST/PATCH/
  // DELETE /exercises e GET /exercises/mine foram removidas por completo,
  // então nem chegam a checar role: qualquer chamada (mesmo autenticada
  // como PROVIDER) cai no 404 padrão de rota inexistente.
  it("POST /exercises no longer exists — provider can't create exercises anymore", async () => {
    const res = await request(app)
      .post("/api/exercises")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ name: "Exercício Custom Teste", category: "Peito" });
    expect(res.status).toBe(404);
  });

  it("GET /exercises/mine no longer exists", async () => {
    const res = await request(app)
      .get("/api/exercises/mine")
      .set("Authorization", `Bearer ${providerToken}`);
    expect(res.status).toBe(404);
  });

  it("GET /exercises returns combined list (provider only)", async () => {
    const res = await request(app)
      .get("/api/exercises")
      .set("Authorization", `Bearer ${providerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /exercises rejects CLIENT role", async () => {
    const email = `${uid("ex_client2")}@test.com`;
    const phone = `108${Date.now().toString().slice(-9)}`;
    const reg = await request(app).post("/api/auth/register").send({
      name: "Client Exercises Two",
      email,
      password: PASSWORD,
      phone,
      termsVersion: "2026.05",
      consentAccepted: true,
    });
    const clientToken = reg.body.accessToken;
    const clientId = reg.body.user.id;

    const res = await request(app)
      .get("/api/exercises")
      .set("Authorization", `Bearer ${clientToken}`);
    expect(res.status).toBe(403);

    await prisma.session.deleteMany({ where: { userId: clientId } });
    await prisma.user.deleteMany({ where: { id: clientId } });
  });

  it("GET /exercises rejects unauthenticated", async () => {
    const res = await request(app).get("/api/exercises");
    expect(res.status).toBe(401);
  });
});
