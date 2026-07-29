import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import { S3Client } from "@aws-sdk/client-s3";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";

// Épico de Frentes, Frente 2 (Segurança do código), Lote 4:
// (1) upsertOwnCredentials só aceita uma chave privada de CREF se ela foi
//     realmente enviada por esse mesmo usuário via /uploads/media, em vez
//     de confiar cegamente no que o body declarar.
// (2) Basic Auth do Swagger continua rejeitando senha errada (regressão
//     funcional) após trocar o compare por crypto.timingSafeEqual.

const PASSWORD = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

const VALID_JPEG_BUFFER = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
  "base64"
);

describe("Frente 2, Lote 4 — vínculo de upload de CREF", () => {
  let tokenOwner = "";
  let userOwnerId = "";
  let tokenOther = "";
  let userOtherId = "";
  let providerOwnerId = "";
  let providerOtherId = "";

  beforeAll(async () => {
    await prisma.$connect();

    const regOwner = await request(app).post("/api/auth/register").send({
      name: "Dono Documento",
      email: `${uid("l4_owner")}@test.com`,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}1`,
      role: "PROVIDER",
      termsVersion: "2026.05",
      consentAccepted: true
    });
    tokenOwner = regOwner.body.accessToken;
    userOwnerId = regOwner.body.user.id;
    const profileOwner = await request(app)
      .post("/api/providers/profile")
      .set("Authorization", `Bearer ${tokenOwner}`)
      .send({ displayName: "Dono Documento", bio: "Bio de teste com mais de dez caracteres.", experienceYears: 2, priceCents: 10000, categoryIds: [] });
    providerOwnerId = profileOwner.body.id;

    const regOther = await request(app).post("/api/auth/register").send({
      name: "Outro Provider",
      email: `${uid("l4_other")}@test.com`,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}2`,
      role: "PROVIDER",
      termsVersion: "2026.05",
      consentAccepted: true
    });
    tokenOther = regOther.body.accessToken;
    userOtherId = regOther.body.user.id;
    const profileOther = await request(app)
      .post("/api/providers/profile")
      .set("Authorization", `Bearer ${tokenOther}`)
      .send({ displayName: "Outro Provider", bio: "Bio de teste com mais de dez caracteres.", experienceYears: 2, priceCents: 10000, categoryIds: [] });
    providerOtherId = profileOther.body.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.crefDocumentUpload.deleteMany({ where: { uploadedByUser: { in: [userOwnerId, userOtherId] } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: [providerOwnerId, providerOtherId] } } });
    await prisma.session.deleteMany({ where: { userId: { in: [userOwnerId, userOtherId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userOwnerId, userOtherId] } } });
    await prisma.$disconnect();
  });

  it("rejeita chave de CREF inventada, nunca enviada por esse usuário (403)", async () => {
    const res = await request(app)
      .put("/api/providers/me/credentials")
      .set("Authorization", `Bearer ${tokenOwner}`)
      .send({
        crefNumber: `CREF-${Date.now()}A`,
        credentials: [
          { name: "frente", uri: "cref-documents/nunca-fui-enviada.jpg", mimeType: "image/jpeg" }
        ]
      });
    expect(res.status).toBe(403);
  });

  it("rejeita chave real, mas enviada por outro usuário (403)", async () => {
    vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);

    const upload = await request(app)
      .post("/api/uploads/media")
      .set("Authorization", `Bearer ${tokenOther}`)
      .field("folder", "cref-documents")
      .attach("file", VALID_JPEG_BUFFER, { filename: "other.jpg", contentType: "image/jpeg" });
    const otherKey = upload.body.url as string;

    const res = await request(app)
      .put("/api/providers/me/credentials")
      .set("Authorization", `Bearer ${tokenOwner}`)
      .send({
        crefNumber: `CREF-${Date.now()}B`,
        credentials: [
          { name: "frente", uri: otherKey, mimeType: "image/jpeg" }
        ]
      });
    expect(res.status).toBe(403);
  });

  it("aceita chave realmente enviada por esse mesmo usuário", async () => {
    vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);

    const upload = await request(app)
      .post("/api/uploads/media")
      .set("Authorization", `Bearer ${tokenOwner}`)
      .field("folder", "cref-documents")
      .attach("file", VALID_JPEG_BUFFER, { filename: "mine.jpg", contentType: "image/jpeg" });
    const ownKey = upload.body.url as string;

    const res = await request(app)
      .put("/api/providers/me/credentials")
      .set("Authorization", `Bearer ${tokenOwner}`)
      .send({
        crefNumber: `CREF-${Date.now()}C`,
        credentials: [
          { name: "frente", uri: ownKey, mimeType: "image/jpeg" }
        ]
      });
    expect(res.status).toBe(200);
  });
});

describe("Frente 2, Lote 4 — Basic Auth do Swagger com compare timing-safe", () => {
  // SWAGGER_BASIC_AUTH_PASSWORD é setada em tests/setup.ts (com fallback),
  // então a rota /api/docs já nasce protegida nesse processo de teste.
  const swaggerPassword = process.env.SWAGGER_BASIC_AUTH_PASSWORD as string;

  it("rejeita senha errada (401), mesmo com o mesmo tamanho da correta", async () => {
    const wrongPassword = swaggerPassword.slice(0, -1) + (swaggerPassword.endsWith("x") ? "y" : "x");
    const wrongAuth = Buffer.from(`admin:${wrongPassword}`).toString("base64");
    const res = await request(app).get("/api/docs/").set("Authorization", `Basic ${wrongAuth}`);
    expect(res.status).toBe(401);
  });

  it("rejeita senha errada de tamanho diferente (401)", async () => {
    const wrongAuth = Buffer.from("admin:senha-completamente-errada").toString("base64");
    const res = await request(app).get("/api/docs/").set("Authorization", `Basic ${wrongAuth}`);
    expect(res.status).toBe(401);
  });

  it("aceita a senha correta (não retorna 401)", async () => {
    const correctAuth = Buffer.from(`admin:${swaggerPassword}`).toString("base64");
    const res = await request(app).get("/api/docs/").set("Authorization", `Basic ${correctAuth}`);
    expect(res.status).not.toBe(401);
  });
});
