import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  ConsultancyContractStatus,
  ConsultancyPaymentStatus,
  OfferBillingCycle,
  PresentialPackageMode,
  PresentialPackageStatus,
  ServiceOfferKind,
  UserRole
} from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { ProviderService } from "../src/modules/providers/services/provider.service";

// Épico de Frentes, Frente 6 (Ofertas do profissional), Lote 8: operação
// contínua do profissional (dashboard e gestão de alunos).
// (1) aluno de COMBO não aparece duplicado (COMBO + PRESENTIAL) no filtro
//     de serviços de listStudentsByService.
// (2) cliente com pacote de créditos avulsos ativo, sem nenhum Booking
//     ainda gerado, é acessível via detalhe do aluno (antes 404).
// (3) pacote presencial PAST_DUE é sinalizado distintamente de um aluno
//     comum inativo (paymentPastDue).

const providerService = new ProviderService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let categoryId = "";
let providerUserId = "";
let providerId = "";

const offerIds: string[] = [];
const requestIds: string[] = [];
const contractIds: string[] = [];
const packageIds: string[] = [];
const clientIds: string[] = [];

describe("Frente 6, Lote 8 — operação contínua do profissional", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `F6L8_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Seis Lote Oito",
        email: `${uid("f6l8_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Seis Lote Oito",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;
  });

  afterAll(async () => {
    await prisma.presentialPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.consultancyContract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [providerUserId, ...clientIds] } } });
    await prisma.user.deleteMany({ where: { id: { in: [providerUserId, ...clientIds] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  async function makeClient(name: string) {
    const client = await prisma.user.create({
      data: {
        name,
        email: `${uid("f6l8_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}${clientIds.length}`,
        role: UserRole.CLIENT
      }
    });
    clientIds.push(client.id);
    return client;
  }

  it("aluno de combo aparece uma vez só (COMBO), não duplicado também como PRESENTIAL", async () => {
    const client = await makeClient("Cliente Combo Lote Oito");

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: ServiceOfferKind.COMBO,
        title: `Combo ${uid("offer")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 60000,
        presentialPackageMode: PresentialPackageMode.FIXED_RECURRING,
        presentialSessionsPerCycle: 4,
        comboPresentialShareCents: 40000,
        comboConsultancyShareCents: 20000
      }
    });
    offerIds.push(offer.id);

    const request = await prisma.consultancyRequest.create({
      data: {
        providerId,
        clientId: client.id,
        status: "RESPONDED",
        quotedOfferId: offer.id,
        responseDeadlineAt: new Date(),
        respondedAt: new Date()
      }
    });
    requestIds.push(request.id);

    const contract = await prisma.consultancyContract.create({
      data: {
        requestId: request.id,
        providerId,
        clientId: client.id,
        offerId: offer.id,
        status: ConsultancyContractStatus.ACTIVE,
        paymentStatus: ConsultancyPaymentStatus.CAPTURED,
        paymentAmountCents: 20000,
        providerAmountCents: 18000,
        platformAmountCents: 2000,
        billingCycle: offer.billingCycle,
        kind: offer.kind,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date(),
        paymentCapturedAt: new Date()
      }
    });
    contractIds.push(contract.id);

    const pkg = await prisma.presentialPackage.create({
      data: {
        providerId,
        clientId: client.id,
        offerId: offer.id,
        categoryId,
        consultancyContractId: contract.id,
        mode: PresentialPackageMode.FIXED_RECURRING,
        status: PresentialPackageStatus.ACTIVE,
        cycleAmountCents: 40000,
        billingCycle: OfferBillingCycle.MONTHLY,
        sessionsPerCycle: 4
      }
    });
    packageIds.push(pkg.id);

    const result = await providerService.listStudentsByService(providerUserId);
    const student = result.students.find((s) => s.clientId === client.id);
    expect(student).toBeTruthy();

    const serviceKinds = student!.services.map((s) => s.serviceKind);
    expect(serviceKinds).toContain("COMBO");
    expect(serviceKinds).not.toContain("PRESENTIAL");
    expect(serviceKinds.filter((k) => k === "COMBO")).toHaveLength(1);

    expect(result.serviceCounts.PRESENTIAL).toBe(0);
    expect(result.serviceCounts.COMBO).toBe(1);
  });

  it("cliente com pacote de créditos avulsos ativo (sem nenhum booking ainda) é acessível via detalhe do aluno", async () => {
    const client = await makeClient("Cliente Creditos Lote Oito");

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: ServiceOfferKind.PRESENTIAL,
        title: `Presencial ${uid("offer")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 30000,
        presentialPackageMode: PresentialPackageMode.FLEXIBLE_CREDITS,
        presentialSessionsPerCycle: 8
      }
    });
    offerIds.push(offer.id);

    const pkg = await prisma.presentialPackage.create({
      data: {
        providerId,
        clientId: client.id,
        offerId: offer.id,
        categoryId,
        mode: PresentialPackageMode.FLEXIBLE_CREDITS,
        status: PresentialPackageStatus.ACTIVE,
        cycleAmountCents: 30000,
        billingCycle: OfferBillingCycle.MONTHLY,
        sessionsPerCycle: 8,
        creditsRemainingThisCycle: 8
      }
    });
    packageIds.push(pkg.id);

    await expect(
      providerService.getStudentManagementDetail(providerUserId, client.id)
    ).resolves.toBeTruthy();
  });

  it("pacote presencial PAST_DUE é sinalizado com paymentPastDue, distinto de um aluno comum inativo", async () => {
    const client = await makeClient("Cliente PastDue Lote Oito");

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: ServiceOfferKind.PRESENTIAL,
        title: `Presencial PastDue ${uid("offer")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 30000,
        presentialPackageMode: PresentialPackageMode.FIXED_RECURRING,
        presentialSessionsPerCycle: 4
      }
    });
    offerIds.push(offer.id);

    const pkg = await prisma.presentialPackage.create({
      data: {
        providerId,
        clientId: client.id,
        offerId: offer.id,
        categoryId,
        mode: PresentialPackageMode.FIXED_RECURRING,
        status: PresentialPackageStatus.PAST_DUE,
        cycleAmountCents: 30000,
        billingCycle: OfferBillingCycle.MONTHLY,
        sessionsPerCycle: 4
      }
    });
    packageIds.push(pkg.id);

    const result = await providerService.listStudentsByService(providerUserId);
    const student = result.students.find((s) => s.clientId === client.id);
    expect(student).toBeTruthy();
    expect(student!.active).toBe(false);
    expect(student!.paymentPastDue).toBe(true);

    const presentialEntry = student!.services.find((s) => s.serviceKind === "PRESENTIAL");
    expect(presentialEntry?.paymentPastDue).toBe(true);
  });
});
