import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { Payment, CardToken } from "mercadopago";
import { prisma } from "../src/config/prisma";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { AdminService } from "../src/modules/admin/services/admin.service";

// Raio-X de pagamentos, Rodada 5, Lote 2: suspensão de conta bloqueava login
// e negócio novo (Rodada 4, Lote 3), mas os dois motores de cobrança
// recorrente (chargeDueCycles de pacote presencial, deliverContract de
// consultoria) nunca checavam suspendedAt — um profissional banido
// continuava faturando com alunos que já tinha. Além disso, suspender
// agora cancela automaticamente pacotes/consultorias ativos do profissional.

const packageService = new PresentialPackageService();
const consultancyService = new ConsultancyService();
const adminService = new AdminService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function createProvider(prefix: string) {
  const providerUser = await prisma.user.create({
    data: {
      name: `${prefix} Provider`,
      email: `${uid(prefix)}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
      role: "PROVIDER"
    }
  });
  const provider = await prisma.providerProfile.create({
    data: {
      userId: providerUser.id,
      displayName: `${prefix} Provider`,
      bio: "test",
      experienceYears: 3,
      priceCents: 10000,
      mpAccountId: `mp_${uid(prefix)}`,
      crefValidationStatus: "APPROVED"
    }
  });
  return { providerUserId: providerUser.id, providerId: provider.id };
}

async function createActiveContract(providerId: string, clientId: string, offerId: string) {
  const offer = await prisma.providerServiceOffer.findUniqueOrThrow({ where: { id: offerId } });
  const consultancyRequest = await prisma.consultancyRequest.create({
    data: {
      providerId,
      clientId,
      status: "RESPONDED",
      quotedOfferId: offerId,
      responseDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      respondedAt: new Date()
    }
  });
  return prisma.consultancyContract.create({
    data: {
      requestId: consultancyRequest.id,
      providerId,
      clientId,
      offerId,
      status: "ACTIVE",
      paymentMethod: "PIX" as any,
      paymentInstallments: 1,
      paymentStatus: "CAPTURED" as any,
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

async function createClient(prefix: string) {
  const client = await prisma.user.create({
    data: {
      name: `${prefix} Client`,
      email: `${uid(prefix)}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
      role: "CLIENT"
    }
  });
  return client.id;
}

let categoryId = "";
let adminId = "";
const userIdsToCleanup: string[] = [];
const providerIdsToCleanup: string[] = [];
const offerIdsToCleanup: string[] = [];

describe("Rodada 5, Lote 2 — suspensão interrompe faturamento recorrente", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const category = await prisma.serviceCategory.create({ data: { name: `R5L2_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const { env } = await import("../src/config/env");
    const adminEmail = env.ADMIN_ALLOWED_EMAILS[0];
    let admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!admin) {
      admin = await prisma.user.create({
        data: {
          name: "Lote2 Admin",
          email: adminEmail,
          password: "x",
          phone: `11${Date.now().toString().slice(-9)}9`,
          role: "CLIENT"
        }
      });
    }
    adminId = admin.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.consultancyContract.deleteMany({ where: { providerId: { in: providerIdsToCleanup } } });
    await prisma.consultancyRequest.deleteMany({ where: { providerId: { in: providerIdsToCleanup } } });
    await prisma.presentialPackage.deleteMany({ where: { providerId: { in: providerIdsToCleanup } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIdsToCleanup } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIdsToCleanup } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIdsToCleanup } } });
    await prisma.adminAuditLog.deleteMany({ where: { adminId } });
    await prisma.user.deleteMany({ where: { id: { in: userIdsToCleanup } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("chargeDueCycles não cobra o ciclo de um pacote cujo profissional está suspenso", async () => {
    const { providerUserId, providerId } = await createProvider("l5l2_billing");
    userIdsToCleanup.push(providerUserId);
    providerIdsToCleanup.push(providerId);
    const clientId = await createClient("l5l2_billing_client");
    userIdsToCleanup.push(clientId);

    const offer = await prisma.providerServiceOffer.create({
      data: { providerId, kind: "PRESENTIAL", title: "Pacote suspenso", billingCycle: "MONTHLY", priceCents: 8000 }
    });
    offerIdsToCleanup.push(offer.id);

    const pkg = await prisma.presentialPackage.create({
      data: {
        providerId,
        clientId,
        offerId: offer.id,
        categoryId,
        mode: "FLEXIBLE_CREDITS",
        status: "ACTIVE",
        cycleAmountCents: 8000,
        billingCycle: "MONTHLY",
        sessionsPerCycle: 2,
        nextBillingAt: new Date(Date.now() - 60 * 60 * 1000)
      }
    });

    await prisma.user.update({ where: { id: providerUserId }, data: { suspendedAt: new Date(), suspensionReason: "teste" } });

    const paymentCreateSpy = vi.spyOn(Payment.prototype, "create");

    await packageService.chargeDueCycles();

    expect(paymentCreateSpy).not.toHaveBeenCalled();
    const afterRun = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(afterRun.nextBillingAt?.getTime()).toBe(pkg.nextBillingAt!.getTime());
  });

  it("deliverContract rejeita quando o profissional está suspenso", async () => {
    const { providerUserId, providerId } = await createProvider("l5l2_deliver");
    userIdsToCleanup.push(providerUserId);
    providerIdsToCleanup.push(providerId);
    const clientId = await createClient("l5l2_deliver_client");
    userIdsToCleanup.push(clientId);

    const offer = await prisma.providerServiceOffer.create({
      data: { providerId, kind: "ONLINE_CONSULTANCY", title: "Consultoria suspensa", billingCycle: "MONTHLY", priceCents: 20000 }
    });
    offerIdsToCleanup.push(offer.id);

    const contract = await createActiveContract(providerId, clientId, offer.id);

    await prisma.user.update({ where: { id: providerUserId }, data: { suspendedAt: new Date(), suspensionReason: "teste" } });

    await expect(
      consultancyService.deliverContract(providerUserId, contract.id, {
        title: "Ficha nova",
        exercises: [{ name: "Agachamento", repetitionsSets: "4x10", load: "40kg" }]
      })
    ).rejects.toThrow(/suspensa/i);
  });

  it("suspender um profissional cancela automaticamente seus pacotes e consultorias ativos", async () => {
    const { providerUserId, providerId } = await createProvider("l5l2_cascade");
    userIdsToCleanup.push(providerUserId);
    providerIdsToCleanup.push(providerId);
    const clientId = await createClient("l5l2_cascade_client");
    userIdsToCleanup.push(clientId);

    const packageOffer = await prisma.providerServiceOffer.create({
      data: { providerId, kind: "PRESENTIAL", title: "Pacote cascata", billingCycle: "MONTHLY", priceCents: 8000 }
    });
    offerIdsToCleanup.push(packageOffer.id);
    const pkg = await prisma.presentialPackage.create({
      data: {
        providerId,
        clientId,
        offerId: packageOffer.id,
        categoryId,
        mode: "FLEXIBLE_CREDITS",
        status: "ACTIVE",
        cycleAmountCents: 8000,
        billingCycle: "MONTHLY",
        sessionsPerCycle: 2
      }
    });

    const consultOffer = await prisma.providerServiceOffer.create({
      data: { providerId, kind: "ONLINE_CONSULTANCY", title: "Consultoria cascata", billingCycle: "MONTHLY", priceCents: 20000 }
    });
    offerIdsToCleanup.push(consultOffer.id);
    const contract = await createActiveContract(providerId, clientId, consultOffer.id);

    await adminService.suspendUser(adminId, providerUserId, "Fraude confirmada — cascata de cancelamento.");

    const pkgAfter = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(pkgAfter.status).toBe("CANCELLED");

    const contractAfter = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(contractAfter.status).toBe("CANCELLED");
  });
});
