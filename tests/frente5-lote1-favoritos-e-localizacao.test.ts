import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { CrefValidationStatus, UserRole } from "@prisma/client";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { encryptSensitiveText } from "../src/shared/utils/encryption";
import { haversineKm } from "../src/shared/utils/geo";

// Épico de Frentes, Frente 5 (Descoberta, agendamento e agenda), Lote 1:
// (1) favoritar/listar favoritos não deve devolver mpAccessToken/
//     mpRefreshToken/crefDocumentUrl/credentialDocuments do profissional.
// (2) busca e detalhe público de profissional não devolvem mais a
//     latitude/longitude exata (o mapa da home usa isso como pino real) —
//     agora vem deslocada (jitter 300-500m, determinístico por profissional),
//     mas distanceKm continua calculado a partir da coordenada real.

const SENSITIVE_FIELDS = [
  "mpAccessToken",
  "mpRefreshToken",
  "crefDocumentUrl",
  "credentialDocuments"
];

const marker = `F5L1_${Date.now()}`;
const providerLat = -23.55052;
const providerLng = -46.633308;
const clientLat = -23.5505;
const clientLng = -46.6333;

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientToken = "";
let clientUserId = "";
let providerUserId = "";
let providerId = "";

describe("Frente 5, Lote 1 — favoritos não vazam dados sensíveis; localização pública é aproximada", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const providerUser = await prisma.user.create({
      data: {
        name: `${marker} Provider`,
        email: `${uid("f5l1_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: `${marker} Provider`,
        bio: "Profissional de teste pra Frente 5 Lote 1.",
        experienceYears: 4,
        priceCents: 12000,
        crefValidationStatus: CrefValidationStatus.APPROVED,
        mpAccountId: `mp_${uid("acc")}`,
        mpAccessToken: encryptSensitiveText("fake_access_token_secreto"),
        mpRefreshToken: encryptSensitiveText("fake_refresh_token_secreto"),
        crefDocumentUrl: "https://storage.example.com/cref-documents/documento-real.jpg",
        credentialDocuments: [
          { name: "frente", uri: "cref-documents/real-key-front.jpg", mimeType: "image/jpeg" }
        ],
        latitude: providerLat,
        longitude: providerLng
      }
    });
    providerId = provider.id;

    const clientReg = await request(app).post("/api/auth/register").send({
      name: "Cliente Frente Cinco Lote Um",
      email: `${uid("f5l1_client")}@test.com`,
      password: "Test1234",
      phone: `11${Date.now().toString().slice(-9)}2`,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    clientToken = clientReg.body.accessToken;
    clientUserId = clientReg.body.user.id;
  });

  afterAll(async () => {
    await prisma.favorite.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [providerUserId, clientUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [providerUserId, clientUserId] } } });
    await prisma.$disconnect();
  });

  it("POST /favorites não devolve campos sensíveis do profissional", async () => {
    const res = await request(app)
      .post("/api/favorites")
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ providerId });

    expect(res.status).toBe(201);
    for (const field of SENSITIVE_FIELDS) {
      expect(res.body.provider).not.toHaveProperty(field);
    }
  });

  it("GET /favorites não devolve campos sensíveis do profissional", async () => {
    const res = await request(app)
      .get("/api/favorites")
      .set("Authorization", `Bearer ${clientToken}`);

    expect(res.status).toBe(200);
    const entry = res.body.find((f: any) => f.providerId === providerId);
    expect(entry).toBeTruthy();
    for (const field of SENSITIVE_FIELDS) {
      expect(entry.provider).not.toHaveProperty(field);
    }
  });

  it("busca pública de profissionais não devolve a latitude/longitude exata, mas distanceKm continua correto", async () => {
    const res = await request(app).get("/api/providers").query({
      q: marker,
      lat: clientLat,
      lng: clientLng
    });

    expect(res.status).toBe(200);
    const found = res.body.find((p: any) => p.id === providerId);
    expect(found).toBeTruthy();

    expect(found.latitude).not.toBe(providerLat);
    expect(found.longitude).not.toBe(providerLng);

    const jitterDistanceMeters =
      haversineKm(providerLat, providerLng, found.latitude, found.longitude) * 1000;
    expect(jitterDistanceMeters).toBeGreaterThan(250);
    expect(jitterDistanceMeters).toBeLessThan(600);

    const expectedDistanceKm = haversineKm(clientLat, clientLng, providerLat, providerLng);
    expect(found.distanceKm).toBeCloseTo(expectedDistanceKm, 1);
  });

  it("detalhe público do profissional não devolve a latitude/longitude exata", async () => {
    const res = await request(app).get(`/api/providers/${providerId}`);

    expect(res.status).toBe(200);
    expect(res.body.latitude).not.toBe(providerLat);
    expect(res.body.longitude).not.toBe(providerLng);

    const jitterDistanceMeters =
      haversineKm(providerLat, providerLng, res.body.latitude, res.body.longitude) * 1000;
    expect(jitterDistanceMeters).toBeGreaterThan(250);
    expect(jitterDistanceMeters).toBeLessThan(600);
  });

  it("o deslocamento é determinístico (mesmo profissional sempre retorna a mesma coordenada pública)", async () => {
    const first = await request(app).get(`/api/providers/${providerId}`);
    const second = await request(app).get(`/api/providers/${providerId}`);

    expect(first.body.latitude).toBe(second.body.latitude);
    expect(first.body.longitude).toBe(second.body.longitude);
  });
});
