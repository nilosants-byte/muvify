import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { ProviderService } from "../src/modules/providers/services/provider.service";
import { AppError } from "../src/shared/errors/app-error";

// Épico de Frentes, Frente 11, Lote 3: dados sensíveis em texto plano.
// (1) ClientAnamnesis.answers e os campos biométricos de
//     ProviderStudentAssessment (dado de saúde) trafegavam sem criptografia.
// (2) Profissional com um único booking COMPLETED, de qualquer data,
//     mantinha acesso vitalício à anamnese, sem log de quem acessou.

const PASSWORD = "Test1234";
const providerService = new ProviderService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function uniqueEmail(prefix: string) {
  return `${uid(prefix)}@test.com`;
}

const createdUserIds: string[] = [];

async function registerUser(prefix: string) {
  const register = await request(app).post("/api/auth/register").send({
    name: "Frente Onze Lote Tres",
    email: uniqueEmail(prefix),
    password: PASSWORD,
    phone: `11${Date.now().toString().slice(-9)}`,
    termsVersion: "2026.05",
    consentAccepted: true
  });
  const userId = register.body.user.id as string;
  const token = register.body.accessToken as string;
  createdUserIds.push(userId);
  return { userId, token };
}

describe("Frente 11, Lote 3 — anamnese cifrada em repouso", () => {
  it("PUT /me/anamnesis grava answers cifrado no banco, GET devolve decifrado", async () => {
    const { userId, token } = await registerUser("f11l3_anamnesis");

    const put = await request(app)
      .put("/api/users/me/anamnesis")
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "DRAFT", answers: { personal: { fullName: "Segredo De Saude" } } });
    expect(put.status).toBe(200);

    const raw = await prisma.clientAnamnesis.findUniqueOrThrow({ where: { clientId: userId } });
    expect(raw.answers).not.toBeNull();
    expect(raw.answers).toMatch(/^enc:v1:/);
    expect(raw.answers).not.toContain("Segredo De Saude");

    const get = await request(app)
      .get("/api/users/me/anamnesis")
      .set("Authorization", `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body.answers.personal.fullName).toBe("Segredo De Saude");
  });

  afterAll(async () => {
    await prisma.clientAnamnesis.deleteMany({ where: { clientId: { in: createdUserIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });
});

describe("Frente 11, Lote 3 — avaliação física cifrada em repouso", () => {
  let clientId = "";
  let providerUserId = "";
  let providerId = "";
  let categoryId = "";

  beforeAll(async () => {
    await prisma.$connect();
    const category = await prisma.serviceCategory.create({ data: { name: `F11L3_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Assessment Client",
        email: uniqueEmail("f11l3_assess_client"),
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Assessment Provider",
        email: uniqueEmail("f11l3_assess_provider"),
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;
    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Assessment Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        completedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        priceCents: 10000,
        status: "COMPLETED"
      }
    });
  });

  afterAll(async () => {
    await prisma.healthDataAccessLog.deleteMany({ where: { providerId } });
    await prisma.providerStudentAssessment.deleteMany({ where: { providerId } });
    await prisma.booking.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("upsertStudentPhysicalAssessment grava campos cifrados; getStudentManagementDetail devolve decifrado", async () => {
    await providerService.upsertStudentPhysicalAssessment(providerUserId, clientId, {
      weight: "80kg",
      bodyFatPercent: "15%"
    });

    const raw = await prisma.providerStudentAssessment.findUniqueOrThrow({
      where: { providerId_clientId: { providerId, clientId } }
    });
    expect(raw.weight).toMatch(/^enc:v1:/);
    expect(raw.bodyFatPercent).toMatch(/^enc:v1:/);

    const detail = await providerService.getStudentManagementDetail(providerUserId, clientId);
    expect(detail.physicalAssessment.weight).toBe("80kg");
    expect(detail.physicalAssessment.bodyFatPercent).toBe("15%");
  });
});

describe("Frente 11, Lote 3 — janela de acesso e trilha de auditoria da anamnese", () => {
  let clientId = "";
  let providerUserId = "";
  let providerId = "";
  let categoryId = "";

  afterAll(async () => {
    await prisma.healthDataAccessLog.deleteMany({ where: { providerId } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId } });
    await prisma.booking.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  async function setupProviderAndClient(prefix: string) {
    await prisma.$connect();
    const category = await prisma.serviceCategory.create({ data: { name: `${prefix}_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Access Window Client",
        email: uniqueEmail(`${prefix}_client`),
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;
    await prisma.clientAnamnesis.create({
      data: { clientId, status: "COMPLETED", completedAt: new Date() }
    });

    const providerUser = await prisma.user.create({
      data: {
        name: "Access Window Provider",
        email: uniqueEmail(`${prefix}_provider`),
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;
    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Access Window Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;
  }

  it("nega acesso à anamnese quando o único vínculo é um booking COMPLETED fora da janela de retenção", async () => {
    await setupProviderAndClient("f11l3_stale");
    await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 800 * 24 * 60 * 60 * 1000),
        completedAt: new Date(Date.now() - 800 * 24 * 60 * 60 * 1000),
        priceCents: 10000,
        status: "COMPLETED"
      }
    });

    await expect(providerService.getStudentAnamnesis(providerUserId, clientId)).rejects.toThrow(AppError);

    const logs = await prisma.healthDataAccessLog.findMany({ where: { providerId, clientId } });
    expect(logs).toHaveLength(0);
  });

  it("libera acesso e grava HealthDataAccessLog quando o booking COMPLETED é recente", async () => {
    await setupProviderAndClient("f11l3_recent");
    await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        completedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        priceCents: 10000,
        status: "COMPLETED"
      }
    });

    const result = await providerService.getStudentAnamnesis(providerUserId, clientId);
    expect(result.status).toBe("COMPLETED");

    function sleep(ms: number) {
      return new Promise((r) => setTimeout(r, ms));
    }
    await sleep(150);

    const logs = await prisma.healthDataAccessLog.findMany({ where: { providerId, clientId } });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0]!.action).toBe("ANAMNESIS_VIEW");
  });
});
