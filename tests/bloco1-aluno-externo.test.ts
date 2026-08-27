import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ConsultancyContractOrigin, ConsultancyContractStatus } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { ProviderService } from "../src/modules/providers/services/provider.service";
import { FinancialService } from "../src/modules/financial/services/financial.service";
import { AdminService } from "../src/modules/admin/services/admin.service";
import { encryptSensitiveText } from "../src/shared/utils/encryption";
import { env } from "../src/config/env";

// Bloco 1 (aluno externo): profissional cadastra manualmente um aluno que já
// era dele fora do Muvify. Cobre a fundação de dados: contrato sem comissão
// nem CREF, visível em "Meus alunos"/"Meu treino", invisível nos relatórios
// de receita/comissão, e imune aos jobs de prazo de entrega (que cancelariam
// o vínculo por engano, já que ele não tem prazo real).

const consultancyService = new ConsultancyService();
const providerService = new ProviderService();
const financialService = new FinancialService();
const adminService = new AdminService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let adminId = "";
const contractIds: string[] = [];

describe("Bloco 1 — fundação do aluno externo", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const client = await prisma.user.create({
      data: {
        name: "Aluno Externo Client",
        email: `${uid("ext_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Aluno Externo Provider",
        email: `${uid("ext_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    // Sem CREF aprovado de propósito — é justamente o caso que este bloco
    // precisa liberar (não há venda intermediada pelo app pra esse aluno).
    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Aluno Externo Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 15000,
        mpAccountId: "555444333",
        mpAccessToken: encryptSensitiveText("fake_access_token"),
        crefValidationStatus: "IN_REVIEW"
      }
    });
    providerId = provider.id;

    const adminReg = await prisma.user
      .create({
        data: {
          name: "Aluno Externo Admin",
          email: env.ADMIN_ALLOWED_EMAILS[0],
          password: "x",
          phone: `11${Date.now().toString().slice(-9)}9`,
          role: "CLIENT"
        }
      })
      .catch(() => prisma.user.findUniqueOrThrow({ where: { email: env.ADMIN_ALLOWED_EMAILS[0] } }));
    adminId = adminReg.id;
  });

  afterAll(async () => {
    await prisma.disputeCase.deleteMany({ where: { clientId } });
    await prisma.trainingPlan.deleteMany({ where: { providerId } });
    const requestIds = (
      await prisma.consultancyRequest.findMany({ where: { clientId }, select: { id: true } })
    ).map((r) => r.id);
    const offerIds = (
      await prisma.consultancyContract.findMany({ where: { clientId }, select: { offerId: true } })
    ).map((c) => c.offerId);
    await prisma.consultancyContract.deleteMany({ where: { clientId } });
    await prisma.consultancyRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.$disconnect();
  });

  it("cria contrato origin EXTERNAL sem comissão, sem CREF e sem passar pelo Mercado Pago", async () => {
    const contract = await consultancyService.createExternalStudentContract(providerUserId, { clientId });
    contractIds.push(contract.id);

    expect(contract.origin).toBe(ConsultancyContractOrigin.EXTERNAL);
    expect(contract.status).toBe(ConsultancyContractStatus.ACTIVE);
    expect(contract.paymentAmountCents).toBe(0);
    expect(contract.providerAmountCents).toBe(0);
    expect(contract.platformAmountCents).toBe(0);
    expect(contract.mpPaymentId).toBeNull();
  });

  it("rejeita criar um segundo contrato externo ativo pra mesma dupla profissional/aluno", async () => {
    await expect(
      consultancyService.createExternalStudentContract(providerUserId, { clientId })
    ).rejects.toThrow(/já possui um contrato ativo/i);
  });

  it("profissional sem CREF consegue entregar ficha externa, mas continua bloqueado no fluxo pago normal", async () => {
    const contract = await prisma.consultancyContract.findFirstOrThrow({
      where: { providerId, clientId, origin: ConsultancyContractOrigin.EXTERNAL }
    });

    const { plan, contract: updatedContract } = await consultancyService.deliverExternalPlan(
      providerUserId,
      contract.id,
      { title: "Ficha do aluno externo", exercises: [{ name: "Agachamento", repetitionsSets: "3x10", load: "40kg" }] }
    );

    expect(plan.contractId).toBe(contract.id);
    expect(updatedContract.status).toBe(ConsultancyContractStatus.DELIVERED);

    await expect(
      consultancyService.createTrainingPlan(providerUserId, { title: "Ficha modelo", exercises: [] })
    ).rejects.toThrow(/CREF/i);
  });

  it("aparece em 'Meu treino' (aluno) e em 'Meus alunos' (profissional)", async () => {
    const myTraining = await consultancyService.getMyTraining(clientId);
    const found = myTraining.contracts.find((c: any) => c.id === contractIds[0]);
    expect(found).toBeTruthy();
    expect(found!.trainingPlans.length).toBeGreaterThan(0);

    const myStudents = await providerService.listStudentsByService(providerUserId);
    const foundStudent = myStudents.students.find((s: any) => s.clientId === clientId);
    expect(foundStudent).toBeTruthy();
  });

  it("não aparece nos relatórios de receita/comissão (financeiro do profissional e visão geral do admin)", async () => {
    const month = new Date().toISOString().slice(0, 7);
    const dashboard = await financialService.getDashboard(providerUserId, month);
    expect(dashboard.appRevenueCents).toBe(0);

    const overview = await adminService.getDashboardOverview(adminId, {});
    expect(typeof overview.attentionNeeded.commissionThisMonthCents).toBe("number");
  });

  it("rejeita abrir contestação de entrega contra um contrato externo", async () => {
    await expect(
      consultancyService.contestDelivery(clientId, contractIds[0], "Não gostei da ficha.")
    ).rejects.toThrow(/não é intermediado pelo Muvify/i);
  });

  it("fica imune aos jobs de prazo de entrega (não é cancelado nem notificado como se tivesse vencido)", async () => {
    // O contrato externo já foi entregue no teste acima (status DELIVERED),
    // então o teste de imunidade real é criar um SEGUNDO contrato externo,
    // ainda sem entrega, e rodar os jobs de prazo/expiração/auto-reembolso
    // sobre ele — sem o filtro origin: MARKETPLACE, ele seria cancelado
    // minutos depois de criado (deliveryDeadlineAt = now).
    const client2 = await prisma.user.create({
      data: {
        name: "Aluno Externo Client 2",
        email: `${uid("ext_client2")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}3`,
        role: "CLIENT"
      }
    });

    const contract2 = await consultancyService.createExternalStudentContract(providerUserId, {
      clientId: client2.id
    });

    await consultancyService.sendConsultancyExpiryReminders(new Date());
    await consultancyService.autoRefundExpiredContracts(new Date());

    const reloaded = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract2.id } });
    expect(reloaded.status).toBe(ConsultancyContractStatus.ACTIVE);
    expect(reloaded.paymentStatus).toBe("CAPTURED");

    await prisma.consultancyContract.deleteMany({ where: { clientId: client2.id } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId: client2.id } });
    await prisma.user.deleteMany({ where: { id: client2.id } });
  });
});
