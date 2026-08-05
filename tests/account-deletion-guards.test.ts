import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/config/prisma";
import { UserService } from "../src/modules/users/services/user.service";
import { encryptSensitiveText } from "../src/shared/utils/encryption";
import { hashValue } from "../src/shared/utils/hash";

// Raio-X de pagamentos, Rodada 4, Lote 2: deleteMe não verificava nada antes
// de anonimizar — cliente com dívida em aberto podia excluir a conta pra
// escapar dela, e exclusão de conta do profissional não revogava o token do
// Mercado Pago nem encerrava relacionamentos ativos.

const userService = new UserService();
const PASSWORD = "Test1234";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function createUser(prefix: string, role: "CLIENT" | "PROVIDER" = "CLIENT") {
  const hashed = await hashValue(PASSWORD);
  const user = await prisma.user.create({
    data: {
      name: `${prefix} User`,
      email: `${uid(prefix)}@test.com`,
      password: hashed,
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
      role
    }
  });
  return user.id;
}

let categoryId = "";
let dummyProviderId = "";
let dummyProviderUserId = "";
let dummyClientId = "";
const cleanupUserIds: string[] = [];
const cleanupProviderIds: string[] = [];
const cleanupDisputeCaseIds: string[] = [];
const cleanupDebtIds: string[] = [];
const cleanupPackageIds: string[] = [];
const cleanupOfferIds: string[] = [];
const cleanupRequestIds: string[] = [];
const cleanupContractIds: string[] = [];

describe("Travas de saída na exclusão de conta (Rodada 4, Lote 2)", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const category = await prisma.serviceCategory.create({
      data: { name: `ADG_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    dummyProviderUserId = await createUser("adg_dummy_provider", "PROVIDER");
    cleanupUserIds.push(dummyProviderUserId);
    const dummyProvider = await prisma.providerProfile.create({
      data: { userId: dummyProviderUserId, displayName: "Dummy Provider", bio: "x", experienceYears: 1, priceCents: 5000, crefValidationStatus: "APPROVED" }
    });
    dummyProviderId = dummyProvider.id;
    cleanupProviderIds.push(dummyProviderId);

    dummyClientId = await createUser("adg_dummy_client");
    cleanupUserIds.push(dummyClientId);
  });

  afterAll(async () => {
    await prisma.consultancyContract.deleteMany({ where: { id: { in: cleanupContractIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { id: { in: cleanupRequestIds } } });
    await prisma.presentialPackage.deleteMany({ where: { id: { in: cleanupPackageIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: cleanupOfferIds } } });
    await prisma.debtRecord.deleteMany({ where: { id: { in: cleanupDebtIds } } });
    await prisma.disputeCase.deleteMany({ where: { id: { in: cleanupDisputeCaseIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: cleanupProviderIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: cleanupUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("bloqueia exclusão do cliente com dívida pendente", async () => {
    const clientId = await createUser("adg_client_debt");
    cleanupUserIds.push(clientId);
    const dispute = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", clientId, providerId: dummyProviderId, amountCents: 5000 }
    });
    cleanupDisputeCaseIds.push(dispute.id);
    const debt = await prisma.debtRecord.create({
      data: { disputeCaseId: dispute.id, debtorType: "CLIENT", clientId, amountCents: 5000, reason: "teste", status: "PENDING" }
    });
    cleanupDebtIds.push(debt.id);
    // Marca a disputa como resolvida pra não colidir com o guard de disputa aberta.
    await prisma.disputeCase.update({ where: { id: dispute.id }, data: { status: "RESOLVED" } });

    await expect(userService.deleteMe(clientId, PASSWORD)).rejects.toThrow(/pendência financeira/i);
  });

  it("bloqueia exclusão do cliente com disputa em julgamento", async () => {
    const clientId = await createUser("adg_client_dispute");
    cleanupUserIds.push(clientId);
    const dispute = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", clientId, providerId: dummyProviderId, amountCents: 3000, status: "OPEN" }
    });
    cleanupDisputeCaseIds.push(dispute.id);

    await expect(userService.deleteMe(clientId, PASSWORD)).rejects.toThrow(/julgamento/i);
  });

  // Épico de Frentes, Frente 11, Lote 6: pacote presencial ativo do cliente
  // passou a ser cancelado automaticamente em vez de bloquear a exclusão -
  // mesmo tratamento que o lado profissional já tinha.
  it("cancela automaticamente o pacote presencial ativo do cliente em vez de bloquear", async () => {
    const clientId = await createUser("adg_client_pkg");
    cleanupUserIds.push(clientId);
    const providerUserId = await createUser("adg_pkg_provider", "PROVIDER");
    cleanupUserIds.push(providerUserId);
    const provider = await prisma.providerProfile.create({
      data: { userId: providerUserId, displayName: "Provider", bio: "x", experienceYears: 1, priceCents: 5000, crefValidationStatus: "APPROVED" }
    });
    cleanupProviderIds.push(provider.id);
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId: provider.id,
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
    cleanupOfferIds.push(offer.id);
    const pkg = await prisma.presentialPackage.create({
      data: {
        providerId: provider.id,
        clientId,
        offerId: offer.id,
        categoryId,
        mode: "FLEXIBLE_CREDITS",
        status: "ACTIVE",
        cycleAmountCents: 8000,
        billingCycle: "MONTHLY",
        sessionsPerCycle: 2
      }
    });
    cleanupPackageIds.push(pkg.id);

    await userService.deleteMe(clientId, PASSWORD);

    const afterPkg = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(afterPkg.status).toBe("CANCELLED");

    const afterUser = await prisma.user.findUniqueOrThrow({ where: { id: clientId } });
    expect(afterUser.name).toBe("Usuário removido");
  });

  // Raio-X de pagamentos, Rodada 5, Lote 6 (cobertura de testes): este ramo
  // (consultoria ativa bloqueando exclusão do cliente) nunca era exercido
  // isoladamente — só o ramo irmão (pacote presencial ativo) tinha teste.
  // Épico de Frentes, Frente 11, Lote 6: consultoria ativa do cliente
  // passou a ser cancelada automaticamente em vez de bloquear a exclusão.
  it("cancela automaticamente a consultoria ativa do cliente em vez de bloquear", async () => {
    const clientId = await createUser("adg_client_contract");
    cleanupUserIds.push(clientId);

    const offer = await prisma.providerServiceOffer.create({
      data: { providerId: dummyProviderId, kind: "ONLINE_CONSULTANCY", title: `Consultoria ${uid("offer")}`, billingCycle: "MONTHLY", priceCents: 20000 }
    });
    cleanupOfferIds.push(offer.id);
    const request = await prisma.consultancyRequest.create({
      data: {
        providerId: dummyProviderId,
        clientId,
        status: "ACCEPTED",
        quotedOfferId: offer.id,
        responseDeadlineAt: new Date(),
        respondedAt: new Date(),
        clientDecisionAt: new Date()
      }
    });
    cleanupRequestIds.push(request.id);
    const contract = await prisma.consultancyContract.create({
      data: {
        requestId: request.id,
        providerId: dummyProviderId,
        clientId,
        offerId: offer.id,
        status: "ACTIVE",
        paymentMethod: "PIX",
        paymentStatus: "CAPTURED",
        paymentAmountCents: 20000,
        providerAmountCents: 18000,
        platformAmountCents: 2000,
        billingCycle: "MONTHLY",
        kind: "ONLINE_CONSULTANCY",
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date()
      }
    });
    cleanupContractIds.push(contract.id);

    await userService.deleteMe(clientId, PASSWORD);

    const afterContract = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(afterContract.status).toBe("CANCELLED");

    const afterUser = await prisma.user.findUniqueOrThrow({ where: { id: clientId } });
    expect(afterUser.name).toBe("Usuário removido");
  });

  it("permite exclusão do cliente sem nenhuma pendência", async () => {
    const clientId = await createUser("adg_client_ok");
    cleanupUserIds.push(clientId);
    await userService.deleteMe(clientId, PASSWORD);
    const afterDeletion = await prisma.user.findUniqueOrThrow({ where: { id: clientId } });
    expect(afterDeletion.name).toBe("Usuário removido");
  });

  it("bloqueia exclusão do profissional com dívida pendente", async () => {
    const providerUserId = await createUser("adg_prov_debt", "PROVIDER");
    cleanupUserIds.push(providerUserId);
    const provider = await prisma.providerProfile.create({
      data: { userId: providerUserId, displayName: "Provider", bio: "x", experienceYears: 1, priceCents: 5000, crefValidationStatus: "APPROVED" }
    });
    cleanupProviderIds.push(provider.id);
    const dispute = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", providerId: provider.id, clientId: dummyClientId, amountCents: 5000, status: "RESOLVED" }
    });
    cleanupDisputeCaseIds.push(dispute.id);
    const debt = await prisma.debtRecord.create({
      data: { disputeCaseId: dispute.id, debtorType: "PROVIDER", providerId: provider.id, amountCents: 5000, reason: "teste", status: "NOTIFIED" }
    });
    cleanupDebtIds.push(debt.id);

    await expect(userService.deleteMe(providerUserId, PASSWORD)).rejects.toThrow(/pendência financeira/i);
  });

  // Raio-X de pagamentos, Rodada 5, Lote 6 (cobertura de testes): este ramo
  // (disputa em julgamento bloqueando exclusão do profissional) nunca era
  // exercido isoladamente — a mensagem é compartilhada com clientDispute,
  // mas a query de disputa do profissional nunca tinha sido populada num
  // teste.
  it("bloqueia exclusão do profissional com disputa em julgamento", async () => {
    const providerUserId = await createUser("adg_prov_dispute", "PROVIDER");
    cleanupUserIds.push(providerUserId);
    const provider = await prisma.providerProfile.create({
      data: { userId: providerUserId, displayName: "Provider", bio: "x", experienceYears: 1, priceCents: 5000, crefValidationStatus: "APPROVED" }
    });
    cleanupProviderIds.push(provider.id);
    const dispute = await prisma.disputeCase.create({
      data: { type: "REFUND_FAILED", providerId: provider.id, clientId: dummyClientId, amountCents: 5000, status: "OPEN" }
    });
    cleanupDisputeCaseIds.push(dispute.id);

    await expect(userService.deleteMe(providerUserId, PASSWORD)).rejects.toThrow(/julgamento/i);
  });

  it("exclusão do profissional cancela pacotes/consultorias ativas e limpa o token do Mercado Pago", async () => {
    const providerUserId = await createUser("adg_prov_cleanup", "PROVIDER");
    cleanupUserIds.push(providerUserId);
    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Provider",
        bio: "x",
        experienceYears: 1,
        priceCents: 5000,
        crefValidationStatus: "APPROVED",
        mpAccountId: "888777666",
        mpAccessToken: encryptSensitiveText("fake_access_token"),
        mpRefreshToken: encryptSensitiveText("fake_refresh_token")
      }
    });
    cleanupProviderIds.push(provider.id);

    const clientId = await createUser("adg_prov_cleanup_client");
    cleanupUserIds.push(clientId);

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId: provider.id,
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
    cleanupOfferIds.push(offer.id);
    const pkg = await prisma.presentialPackage.create({
      data: {
        providerId: provider.id,
        clientId,
        offerId: offer.id,
        categoryId,
        mode: "FLEXIBLE_CREDITS",
        status: "ACTIVE",
        cycleAmountCents: 8000,
        billingCycle: "MONTHLY",
        sessionsPerCycle: 2
      }
    });
    cleanupPackageIds.push(pkg.id);

    const consultOffer = await prisma.providerServiceOffer.create({
      data: {
        providerId: provider.id,
        kind: "ONLINE_CONSULTANCY",
        title: `Consultoria ${uid("offer")}`,
        billingCycle: "MONTHLY",
        priceCents: 20000
      }
    });
    cleanupOfferIds.push(consultOffer.id);
    const request = await prisma.consultancyRequest.create({
      data: {
        providerId: provider.id,
        clientId,
        status: "ACCEPTED",
        quotedOfferId: consultOffer.id,
        responseDeadlineAt: new Date(),
        respondedAt: new Date(),
        clientDecisionAt: new Date()
      }
    });
    cleanupRequestIds.push(request.id);
    const contract = await prisma.consultancyContract.create({
      data: {
        requestId: request.id,
        providerId: provider.id,
        clientId,
        offerId: consultOffer.id,
        status: "ACTIVE",
        paymentAmountCents: 20000,
        providerAmountCents: 18000,
        platformAmountCents: 2000,
        billingCycle: "MONTHLY",
        kind: "ONLINE_CONSULTANCY",
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date()
      }
    });
    cleanupContractIds.push(contract.id);

    await userService.deleteMe(providerUserId, PASSWORD);

    const afterPkg = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(afterPkg.status).toBe("CANCELLED");

    const afterContract = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(afterContract.status).toBe("CANCELLED");

    const afterProvider = await prisma.providerProfile.findUniqueOrThrow({ where: { id: provider.id } });
    expect(afterProvider.mpAccessToken).toBeNull();
    expect(afterProvider.mpRefreshToken).toBeNull();
    expect(afterProvider.mpAccountId).toBeNull();

    const afterUser = await prisma.user.findUniqueOrThrow({ where: { id: providerUserId } });
    expect(afterUser.name).toBe("Usuário removido");
  });
});
