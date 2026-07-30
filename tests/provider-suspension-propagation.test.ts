import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { ProviderService } from "../src/modules/providers/services/provider.service";
import { BookingService } from "../src/modules/bookings/services/booking.service";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { AdminService } from "../src/modules/admin/services/admin.service";
import request from "supertest";
import { app } from "../src/app";

// Raio-X de pagamentos, Rodada 4, Lote 3: suspensão só bloqueava o próprio
// login do profissional — ele continuava pesquisável e podia receber novos
// agendamentos/compras normalmente. Também cobre a nova busca de usuário
// 360° (searchUsers/getUserDetail) que ficou de fora do fluxo de disputas.

const providerService = new ProviderService();
const bookingService = new BookingService();
const packageService = new PresentialPackageService();
const consultancyService = new ConsultancyService();
const adminService = new AdminService();

const PASSWORD = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function createUser(prefix: string, role: "CLIENT" | "PROVIDER" = "CLIENT", email?: string) {
  const resolvedEmail = email ?? `${uid(prefix)}@test.com`;
  const reg = await request(app)
    .post("/api/auth/register")
    .send({
      name: `Test User ${prefix.replace(/[^a-zA-Z]/g, " ").trim()}`,
      email: resolvedEmail,
      password: PASSWORD,
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
      ...(role === "PROVIDER" ? { role } : {}),
      termsVersion: "2026.05",
      consentAccepted: true
    });
  return { userId: reg.body.user.id as string, email: resolvedEmail };
}

let clientId = "";
let providerUserId = "";
let providerEmail = "";
let providerId = "";
let categoryId = "";
let adminId = "";
const offerIds: string[] = [];
const requestIds: string[] = [];

describe("Suspensão de conta propaga pra busca e novo negócio (Rodada 4, Lote 3)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `SP_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    clientId = (await createUser("sp_client")).userId;
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });

    const providerReg = await createUser("sp_provider", "PROVIDER");
    providerUserId = providerReg.userId;
    providerEmail = providerReg.email;
    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Suspend Test Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        crefValidationStatus: "APPROVED",
        minBookingNoticeHours: 1
      }
    });
    providerId = provider.id;
    await prisma.availability.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ providerId, weekday, startTime: "06:00", endTime: "22:00", isActive: true }))
    });
    await prisma.providerCategory.create({ data: { providerId, categoryId } });

    const adminReg = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Susp Prop Admin",
        email: env.ADMIN_ALLOWED_EMAILS[0],
        password: PASSWORD,
        phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
        termsVersion: "2026.05",
        consentAccepted: true
      });
    adminId = adminReg.body.user?.id ?? (await prisma.user.findUniqueOrThrow({ where: { email: env.ADMIN_ALLOWED_EMAILS[0] } })).id;
  });

  afterAll(async () => {
    await prisma.consultancyRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.booking.deleteMany({ where: { providerId } });
    await prisma.availability.deleteMany({ where: { providerId } });
    await prisma.providerCategory.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [clientId, providerUserId] } } });
    await prisma.adminAuditLog.deleteMany({ where: { adminId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  function scheduledAtDaysFromNow(days: number) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    date.setHours(14, 0, 0, 0);
    return date.toISOString();
  }

  it("busca de usuário 360° encontra cliente e profissional por nome/e-mail parcial, e getUserDetail agrega dívidas/disputas", async () => {
    const results = await adminService.searchUsers(adminId, providerEmail.split("@")[0]);
    expect(results.some((r) => r.id === providerUserId)).toBe(true);

    const detail = await adminService.getUserDetail(adminId, providerUserId);
    expect(detail.provider?.id).toBe(providerId);
    expect(detail.clientDebts).toEqual([]);
    expect(detail.providerDebts).toEqual([]);
  });

  it("busca rejeita termo curto demais", async () => {
    await expect(adminService.searchUsers(adminId, "ab")).rejects.toThrow(/pelo menos 3 caracteres/i);
  });

  it("suspende o profissional e confirma que ele some da busca e não aceita mais negócio novo", async () => {
    await adminService.suspendUser(adminId, providerUserId, "Fraude confirmada em análise manual.");

    // 1. Some da busca de profissionais.
    const searchResults = await providerService.search({ q: "Suspend Test Provider" } as any);
    expect(searchResults.some((p: any) => p.id === providerId)).toBe(false);

    // 2. Não aceita novo agendamento avulso.
    await expect(
      bookingService.create(clientId, providerId, categoryId, scheduledAtDaysFromNow(10), undefined, "CREDIT_CARD" as any)
    ).rejects.toThrow(/não está disponível/i);

    // 3. Não aceita nova compra de pacote presencial.
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "PRESENTIAL",
        title: `Pacote ${uid("offer")}`,
        billingCycle: "MONTHLY",
        priceCents: 8000,
        presentialPackageMode: "FLEXIBLE_CREDITS",
        presentialSessionsPerCycle: 2,
        presentialHasFixedTerm: true,
        presentialTotalCycles: 1
      }
    });
    offerIds.push(offer.id);
    await expect(
      packageService.purchasePackage(clientId, { offerId: offer.id, categoryId, paymentMethod: "CREDIT_CARD" as any })
    ).rejects.toThrow(/não está disponível/i);

    // 4. Não aceita aceite de proposta de consultoria.
    const consultOffer = await prisma.providerServiceOffer.create({
      data: { providerId, kind: "ONLINE_CONSULTANCY", title: `Consultoria ${uid("offer")}`, billingCycle: "MONTHLY", priceCents: 20000 }
    });
    offerIds.push(consultOffer.id);
    const consultRequest = await prisma.consultancyRequest.create({
      data: {
        providerId,
        clientId,
        status: "RESPONDED",
        quotedOfferId: consultOffer.id,
        responseDeadlineAt: new Date(),
        respondedAt: new Date()
      }
    });
    requestIds.push(consultRequest.id);
    await expect(
      consultancyService.decideRequest(clientId, consultRequest.id, { decision: "ACCEPT", paymentMethod: "CREDIT_CARD" as any, acknowledgedImmediateExecution: true })
    ).rejects.toThrow(/não está disponível/i);

    // Reativa pra não vazar estado suspenso pra outros arquivos de teste concorrentes.
    await adminService.reactivateUser(adminId, providerUserId);
  });

  // Raio-X de pagamentos, Rodada 5, Lote 6 (cobertura de testes): o bloqueio
  // de suspensão em purchaseCombo é idêntico ao de purchasePackage (testado
  // acima), mas nunca era exercido isoladamente — se um refactor futuro
  // tocasse só esse caminho, poderia quebrar sem detecção.
  it("profissional suspenso não aceita compra de combo", async () => {
    await adminService.suspendUser(adminId, providerUserId, "Fraude confirmada em análise manual.");

    const comboOffer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "COMBO",
        title: `Combo ${uid("offer")}`,
        billingCycle: "MONTHLY",
        priceCents: 30000,
        presentialPackageMode: "FLEXIBLE_CREDITS",
        presentialSessionsPerCycle: 2,
        presentialHasFixedTerm: true,
        presentialTotalCycles: 1,
        comboPresentialShareCents: 10000,
        comboConsultancyShareCents: 20000
      }
    });
    offerIds.push(comboOffer.id);

    await expect(
      packageService.purchaseCombo(clientId, {
        offerId: comboOffer.id,
        categoryId,
        paymentMethod: "CREDIT_CARD" as any,
        acknowledgedImmediateExecution: true
      })
    ).rejects.toThrow(/não está disponível/i);

    await adminService.reactivateUser(adminId, providerUserId);
  });
});
