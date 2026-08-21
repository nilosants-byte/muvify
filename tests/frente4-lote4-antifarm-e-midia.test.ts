import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import { Payment, CardToken } from "mercadopago";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { ExerciseService } from "../src/modules/exercises/services/exercise.service";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Épico de Frentes, Frente 4 (Criação/entrega/evolução do treino), Lote 4:
// (1) conclusão de ficha online sem anti-farm real (XP/post ilimitado);
// (2) demoVideoUrl aceitava qualquer domínio externo;
// (3) excluir exercício em uso apagava fichas ativas silenciosamente;
// (4) validação de conteúdo da ficha era só tamanho trivial de texto.

const consultancyService = new ConsultancyService();
const exerciseService = new ExerciseService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

const PASSWORD = "Test1234";

async function registerUser(prefix: string, displayName: string, role?: "PROVIDER") {
  const reg = await request(app)
    .post("/api/auth/register")
    .send({
      name: displayName,
      email: `${uid(prefix)}@test.com`,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
      ...(role ? { role } : {}),
      termsVersion: "2026.05",
      consentAccepted: true
    });
  return { token: reg.body.accessToken as string, userId: reg.body.user.id as string };
}

let providerToken = "";
let providerUserId = "";
let providerId = "";
let clientId = "";
let categoryId = "";
let adminId = "";
const offerIds: string[] = [];
const prebuiltExerciseIds: string[] = [];

describe("Frente 4, Lote 4 — anti-farm de XP e integridade de mídia", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `AF_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const provider = await registerUser("af_provider", "Antifarm Provider", "PROVIDER");
    providerToken = provider.token;
    providerUserId = provider.userId;

    const profile = await request(app)
      .post("/api/providers/profile")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({
        displayName: "Antifarm Provider",
        bio: "Provider de teste anti-farm",
        experienceYears: 3,
        priceCents: 10000,
        categoryIds: [categoryId]
      });
    if (profile.status !== 201) {
      throw new Error(`Falha ao criar perfil de provider: ${profile.status} ${JSON.stringify(profile.body)}`);
    }
    providerId = profile.body.id;

    await prisma.providerProfile.update({
      where: { id: providerId },
      data: {
        crefValidationStatus: "APPROVED",
        mpAccountId: "444333222",
        mpAccessToken: encryptSensitiveText("fake_access_token")
      }
    });

    const client = await prisma.user.create({
      data: {
        name: "Antifarm Client",
        email: `${uid("af_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        mpCustomerId: "cus_test_af"
      }
    });
    clientId = client.id;

    await prisma.customerPaymentMethod.create({
      data: {
        userId: clientId,
        mpCustomerId: "cus_test_af",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });

    // Segunda camada: exclusão de exercício em uso é bloqueada só na
    // versão admin agora (deletePrebuilt) — precisa de um admin de verdade.
    const adminEmail = env.ADMIN_ALLOWED_EMAILS[0]!;
    const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (existingAdmin) {
      adminId = existingAdmin.id;
      await prisma.user.update({ where: { id: adminId }, data: { emailVerifiedAt: new Date() } });
    } else {
      const admin = await prisma.user.create({
        data: {
          name: "Antifarm Admin",
          email: adminEmail,
          password: "x",
          phone: `1188${Date.now().toString().slice(-8)}`,
          role: "ADMIN",
          emailVerifiedAt: new Date()
        }
      });
      adminId = admin.id;
    }
  });

  afterAll(async () => {
    await prisma.trainingPlanCompletion.deleteMany({ where: { providerId } });
    await prisma.trainingPlan.deleteMany({ where: { providerId } });
    await prisma.consultancyContract.deleteMany({ where: { clientId } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId } });
    await prisma.exercise.deleteMany({ where: { providerId } });
    await prisma.exercise.deleteMany({ where: { id: { in: prebuiltExerciseIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: providerUserId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function makeOffer() {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "ONLINE_CONSULTANCY",
        title: `Consultoria ${uid("offer")}`,
        billingCycle: "MONTHLY",
        priceCents: 20000,
        fichaValidityDays: 30
      }
    });
    offerIds.push(offer.id);
    return offer;
  }

  async function makeActiveContract(offerId: string) {
    const offer = await prisma.providerServiceOffer.findUniqueOrThrow({ where: { id: offerId } });
    const req = await prisma.consultancyRequest.create({
      data: {
        providerId,
        clientId,
        status: "ACCEPTED",
        quotedOfferId: offerId,
        responseDeadlineAt: new Date(),
        respondedAt: new Date(),
        clientDecisionAt: new Date()
      }
    });
    return prisma.consultancyContract.create({
      data: {
        requestId: req.id,
        providerId,
        clientId,
        offerId,
        status: "ACTIVE",
        paymentMethod: "CREDIT_CARD",
        paymentStatus: "CAPTURED",
        paymentAmountCents: 20000,
        providerAmountCents: 18000,
        platformAmountCents: 2000,
        billingCycle: offer.billingCycle,
        kind: offer.kind,
        fichaValidityDays: offer.fichaValidityDays,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date()
      }
    });
  }

  it("completeTrainingPlan concede XP/post uma única vez por dia por ficha", async () => {
    const offer = await makeOffer();
    const contract = await makeActiveContract(offer.id);
    const { plan } = await consultancyService.deliverContract(providerUserId, contract.id, {
      title: "Ficha Antifarm",
      exercises: [{ name: "Agachamento", repetitionsSets: "3x10", load: "40kg" }]
    });

    await consultancyService.completeTrainingPlan(clientId, plan.id);
    const completionsAfterFirst = await prisma.trainingPlanCompletion.count({ where: { trainingPlanId: plan.id } });
    expect(completionsAfterFirst).toBe(1);

    await expect(consultancyService.completeTrainingPlan(clientId, plan.id)).rejects.toThrow(
      /já registrou a conclusão deste treino hoje/i
    );

    const completionsAfterSecond = await prisma.trainingPlanCompletion.count({ where: { trainingPlanId: plan.id } });
    expect(completionsAfterSecond).toBe(1);
  });

  it("entregar ficha com demoVideoUrl de domínio externo é rejeitado pela API", async () => {
    const offer = await makeOffer();
    const contract = await makeActiveContract(offer.id);

    const res = await request(app)
      .post(`/api/consultancy/contracts/${contract.id}/deliver`)
      .set("Authorization", `Bearer ${providerToken}`)
      .send({
        title: "Ficha com vídeo externo",
        exercises: [
          {
            name: "Agachamento",
            repetitionsSets: "3x10",
            load: "40kg",
            demoVideoUrl: "https://vimeo.com/123456"
          }
        ]
      });

    expect(res.status).toBe(400);
  });

  it("entregar ficha com demoVideoUrl do YouTube é aceito", async () => {
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
    vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 9001, status: "approved" } as any);

    const offer = await makeOffer();
    const contract = await makeActiveContract(offer.id);

    const res = await request(app)
      .post(`/api/consultancy/contracts/${contract.id}/deliver`)
      .set("Authorization", `Bearer ${providerToken}`)
      .send({
        title: "Ficha com vídeo do YouTube",
        exercises: [
          {
            name: "Agachamento",
            repetitionsSets: "3x10",
            load: "40kg",
            demoVideoUrl: "https://www.youtube.com/watch?v=abc123"
          }
        ]
      });

    expect(res.status).toBe(200);
  });

  it("entregar ficha com conteúdo trivial (nome de exercício com 2 caracteres) é rejeitado", async () => {
    const offer = await makeOffer();
    const contract = await makeActiveContract(offer.id);

    const res = await request(app)
      .post(`/api/consultancy/contracts/${contract.id}/deliver`)
      .set("Authorization", `Bearer ${providerToken}`)
      .send({
        title: "Ficha nonsense",
        exercises: [{ name: "Ag", repetitionsSets: "3x10", load: "x" }]
      });

    expect(res.status).toBe(400);
  });

  it("excluir exercício referenciado em ficha ativa é bloqueado com mensagem clara", async () => {
    const exercise = await exerciseService.createPrebuilt(adminId, {
      name: "Supino Reto Personalizado",
      category: "Peito"
    });
    prebuiltExerciseIds.push(exercise.id);

    const offer = await makeOffer();
    const contract = await makeActiveContract(offer.id);
    await consultancyService.deliverContract(providerUserId, contract.id, {
      title: "Ficha Usando Exercício Custom",
      exercises: [
        { exerciseId: exercise.id, name: exercise.name, repetitionsSets: "3x10", load: "40kg" }
      ]
    });

    await expect(exerciseService.deletePrebuilt(adminId, exercise.id)).rejects.toThrow(/ficha\(s\) ativa\(s\)/i);

    const stillExists = await prisma.exercise.findUnique({ where: { id: exercise.id } });
    expect(stillExists).not.toBeNull();
  });
});
