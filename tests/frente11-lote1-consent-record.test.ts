import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { CURRENT_TERMS_VERSION } from "../src/config/legal";

// Épico de Frentes, Frente 11, Lote 1: consentimento sem histórico nem
// versão canônica.
// (1) User.termsAcceptedAt/privacyPolicyAcceptedAt/termsVersion eram 3
//     campos mutáveis, sobrescritos a cada novo aceite - sem histórico.
// (2) recordConsent/register gravavam termsVersion ENVIADO PELO CLIENTE,
//     sem comparação contra uma versão canônica conhecida pelo servidor.
// (3) getMe não expunha nada que indicasse ao app que os termos vigentes
//     mudaram.

const PASSWORD = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function uniqueEmail(prefix: string) {
  return `${uid(prefix)}@test.com`;
}

const createdUserIds: string[] = [];

describe("Frente 11, Lote 1 — ConsentRecord e versão canônica", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.consentRecord.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it("registrar grava o primeiro ConsentRecord com a versão canônica, ignorando o que o cliente enviou", async () => {
    const register = await request(app).post("/api/auth/register").send({
      name: "Frente Onze Lote Um User",
      email: uniqueEmail("f11l1_register"),
      password: PASSWORD,
      phone: `1177${Date.now().toString().slice(-8)}`,
      termsVersion: "9.9.9-inventada",
      consentAccepted: true
    });
    expect(register.status).toBe(201);
    const userId = register.body.user.id as string;
    createdUserIds.push(userId);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(stored.termsVersion).toBe(CURRENT_TERMS_VERSION);

    const records = await prisma.consentRecord.findMany({ where: { userId } });
    expect(records).toHaveLength(1);
    expect(records[0]!.termsVersion).toBe(CURRENT_TERMS_VERSION);
  });

  it("aceitar os termos de novo grava um ConsentRecord adicional (não sobrescreve o anterior), sempre com a versão canônica", async () => {
    const register = await request(app).post("/api/auth/register").send({
      name: "Frente Onze Lote Um Reaccept",
      email: uniqueEmail("f11l1_reaccept"),
      password: PASSWORD,
      phone: `1188${Date.now().toString().slice(-8)}`,
      termsVersion: CURRENT_TERMS_VERSION,
      consentAccepted: true
    });
    const userId = register.body.user.id as string;
    const token = register.body.accessToken as string;
    createdUserIds.push(userId);

    const consent = await request(app)
      .post("/api/users/me/consent")
      .set("Authorization", `Bearer ${token}`)
      .send({ termsVersion: "0.0.1-forjada" });
    expect(consent.status).toBe(200);
    expect(consent.body.termsVersion).toBe(CURRENT_TERMS_VERSION);

    const records = await prisma.consentRecord.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.termsVersion === CURRENT_TERMS_VERSION)).toBe(true);
  });

  it("getMe retorna needsReconsent true pra usuário com versão desatualizada, e false depois de re-aceitar", async () => {
    const register = await request(app).post("/api/auth/register").send({
      name: "Frente Onze Lote Um Outdated",
      email: uniqueEmail("f11l1_outdated"),
      password: PASSWORD,
      phone: `1199${Date.now().toString().slice(-8)}`,
      termsVersion: CURRENT_TERMS_VERSION,
      consentAccepted: true
    });
    const userId = register.body.user.id as string;
    const token = register.body.accessToken as string;
    createdUserIds.push(userId);

    await prisma.user.update({ where: { id: userId }, data: { termsVersion: "2020.01-desatualizada" } });

    const beforeReconsent = await request(app).get("/api/users/me").set("Authorization", `Bearer ${token}`);
    expect(beforeReconsent.status).toBe(200);
    expect(beforeReconsent.body.needsReconsent).toBe(true);

    await request(app)
      .post("/api/users/me/consent")
      .set("Authorization", `Bearer ${token}`)
      .send({ termsVersion: "irrelevante" });

    const afterReconsent = await request(app).get("/api/users/me").set("Authorization", `Bearer ${token}`);
    expect(afterReconsent.body.needsReconsent).toBe(false);
  });
});
