import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { UserRole } from "@prisma/client";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { ProviderService } from "../src/modules/providers/services/provider.service";

// Épico de Frentes, Frente 5 (Descoberta, agendamento e agenda), Lote 11:
// (1) disponibilidade exige duração mínima (>= 30min).
// (2) reportReason/contestReason curtos demais retornam mensagem em
//     português, não mais o texto padrão em inglês do Zod.
// (3) rate limiter de disponibilidade não menciona mais "upload".
// (4) busca por especialidade encontra por substring/case-insensitive,
//     igual à busca por nome já fazia.
// (5) /favorites exige role CLIENT (defesa em profundidade).

const providerService = new ProviderService();
const PASSWORD = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let categoryId = "";
let providerToken = "";
let providerUserId = "";
let providerId = "";
let clientToken = "";
let clientUserId = "";

describe("Frente 5, Lote 11 — validações, mensagens, rate limit e busca de baixo risco", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `F5L11_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const providerEmail = `${uid("f5l11_provider")}@test.com`;
    const providerPhone = `11${Date.now().toString().slice(-9)}1`;
    const providerReg = await request(app).post("/api/auth/register").send({
      name: "Profissional Frente Cinco Lote Onze",
      email: providerEmail,
      password: PASSWORD,
      phone: providerPhone,
      role: "PROVIDER",
      termsVersion: "2026.05",
      consentAccepted: true
    });
    providerToken = providerReg.body.accessToken;
    providerUserId = providerReg.body.user.id;

    const profile = await request(app)
      .post("/api/providers/profile")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({
        displayName: `${uid("F5L11 Provider")}`,
        bio: "Bio de teste do Lote 11",
        experienceYears: 3,
        priceCents: 10000,
        categoryIds: [categoryId],
        specialties: ["Yoga terapêutico"]
      });
    providerId = profile.body.id;
    await prisma.providerProfile.update({
      where: { id: providerId },
      data: { crefValidationStatus: "APPROVED", mpAccountId: "111222333" }
    });

    const clientEmail = `${uid("f5l11_client")}@test.com`;
    const clientPhone = `11${Date.now().toString().slice(-9)}2`;
    const clientReg = await request(app).post("/api/auth/register").send({
      name: "Cliente Frente Cinco Lote Onze",
      email: clientEmail,
      password: PASSWORD,
      phone: clientPhone,
      termsVersion: "2026.05",
      consentAccepted: true
    });
    clientToken = clientReg.body.accessToken;
    clientUserId = clientReg.body.user.id;
  });

  afterAll(async () => {
    await prisma.favorite.deleteMany({ where: { providerId } });
    await prisma.availability.deleteMany({ where: { providerId } });
    await prisma.providerCategory.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [providerUserId, clientUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [providerUserId, clientUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("POST /availability rejeita janela menor que 30 minutos", async () => {
    const res = await request(app)
      .post("/api/availability")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ weekday: 3, startTime: "09:00", endTime: "09:15" });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/pelo menos 30 minutos/i);
  });

  it("POST /availability rejeita janela maior que 12 horas", async () => {
    const res = await request(app)
      .post("/api/availability")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ weekday: 4, startTime: "06:00", endTime: "19:00" });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/não pode ultrapassar 12 horas/i);
  });

  it("reportar falta com motivo curto demais retorna mensagem em português, não o texto padrão do Zod", async () => {
    const res = await request(app)
      .post("/api/bookings/00000000-0000-0000-0000-000000000000/report-no-show")
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ reportReason: "ab" });

    expect(res.status).toBe(400);
    const body = JSON.stringify(res.body);
    expect(body).toMatch(/pelo menos 3 caracteres/i);
    expect(body).not.toMatch(/String must contain/i);
  });

  it("rate limit de disponibilidade não menciona mais 'upload' na mensagem", async () => {
    const rlEmail = `${uid("f5l11_rl_provider")}@test.com`;
    const rlPhone = `11${Date.now().toString().slice(-9)}3`;
    const rlReg = await request(app).post("/api/auth/register").send({
      name: "Profissional Rate Limit Lote Onze",
      email: rlEmail,
      password: PASSWORD,
      phone: rlPhone,
      role: "PROVIDER",
      termsVersion: "2026.05",
      consentAccepted: true
    });
    const rlToken = rlReg.body.accessToken;
    const rlUserId = rlReg.body.user.id;

    let lastRes: request.Response | null = null;
    for (let i = 0; i < 21; i++) {
      lastRes = await request(app)
        .post("/api/availability")
        .set("Authorization", `Bearer ${rlToken}`)
        .send({}); // corpo inválido de propósito: só o rate limit importa aqui, não a criação.
    }
    expect(lastRes!.status).toBe(429);
    const body = JSON.stringify(lastRes!.body);
    expect(body).not.toMatch(/upload/i);
    expect(body).toMatch(/alterações/i);

    await prisma.session.deleteMany({ where: { userId: rlUserId } });
    await prisma.user.deleteMany({ where: { id: rlUserId } });
  }, 30000);

  it("busca por especialidade encontra por substring/case-insensitive, igual à busca por nome", async () => {
    const results = await providerService.search({ q: "yoga" } as any);
    expect(results.some((p: any) => p.id === providerId)).toBe(true);
  });

  it("POST /favorites exige role CLIENT — profissional não consegue favoritar", async () => {
    const res = await request(app)
      .post("/api/favorites")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ providerId });

    expect(res.status).toBe(403);
  });
});
