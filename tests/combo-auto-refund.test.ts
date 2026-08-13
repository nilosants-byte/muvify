import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Payment, CardToken, PaymentRefund } from "mercadopago";
import { prisma } from "../src/config/prisma";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Frente 5 do roteiro de seguranca de pagamentos: quando a metade de
// consultoria de um combo e estornada automaticamente por falta de entrega
// em 48h, a metade presencial continua normalmente - o aluno precisa ser
// avisado com clareza disso e ter a opcao de cancelar tambem a parte
// presencial, em vez de uma notificacao generica que nao menciona o combo.

const consultancyService = new ConsultancyService();
const presentialPackageService = new PresentialPackageService();

let nextMpPaymentId = 700000;
vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
vi.spyOn(Payment.prototype, "create").mockImplementation(async () => ({
  id: nextMpPaymentId++,
  status: "approved"
} as any));
vi.spyOn(PaymentRefund.prototype, "create").mockImplementation(async ({ payment_id, body }: any) => ({
  id: 999,
  payment_id: Number(payment_id),
  amount: body?.amount
} as any));

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function waitForNotification(userId: string, since: Date) {
  // Frente 12 (segunda camada), Lote 13: sendToUsers é chamada fire-and-
  // forget (void, decisão deliberada da Frente 2/Lote 2 — notificação é
  // best-effort) em todos os call sites da aplicação, então este teste
  // sempre dependeu de poll. Sob a suíte completa (161 arquivos, pool de
  // conexões compartilhado), a janela antiga de 20×50ms (1s) não era
  // suficiente pra esperar o UserNotification.create commitar.
  for (let attempt = 0; attempt < 60; attempt++) {
    const found = await prisma.userNotification.findFirst({
      where: { userId, createdAt: { gt: since } },
      orderBy: { createdAt: "desc" }
    });
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
let offerId = "";

describe("Combo — aviso e opção do aluno quando a consultoria é estornada automaticamente", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `CA_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Combo Client",
        email: `${uid("combo_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        mpCustomerId: "cus_test_combo",
        emailVerifiedAt: new Date()
      }
    });
    clientId = client.id;

    await prisma.customerPaymentMethod.create({
      data: {
        userId: clientId,
        mpCustomerId: "cus_test_combo",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });

    await prisma.clientAnamnesis.create({
      data: { clientId, status: "COMPLETED", completedAt: new Date() }
    });

    const providerUser = await prisma.user.create({
      data: {
        name: "Combo Provider",
        email: `${uid("combo_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Combo Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 30000,
        mpAccountId: "999888777",
        mpAccessToken: encryptSensitiveText("fake_access_token"),
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "COMBO",
        title: "Combo presencial + consultoria",
        billingCycle: "MONTHLY",
        priceCents: 30000,
        comboPresentialShareCents: 20000,
        comboConsultancyShareCents: 10000,
        presentialPackageMode: "FLEXIBLE_CREDITS",
        presentialSessionsPerCycle: 4
      }
    });
    offerId = offer.id;
  });

  afterAll(async () => {
    await prisma.userNotification.deleteMany({ where: { userId: { in: [clientId, providerUserId] } } });
    await prisma.disputeCase.deleteMany({ where: { clientId } });
    await prisma.presentialPackage.deleteMany({ where: { clientId } });
    await prisma.consultancyContract.deleteMany({ where: { clientId } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: offerId } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
    vi.restoreAllMocks();
  });

  it("consultoria do combo vencida sem entrega: avisa com clareza e mantém a parte presencial ativa", async () => {
    const { contract, package: pkg } = await presentialPackageService.purchaseCombo(clientId, {
      offerId,
      categoryId,
      paymentMethod: "CREDIT_CARD" as any,
      acknowledgedImmediateExecution: true
    });

    expect(pkg.status).toBe("ACTIVE");

    // Força o prazo de entrega da consultoria pra "já vencido"
    await prisma.consultancyContract.update({
      where: { id: contract.id },
      data: { deliveryDeadlineAt: new Date(Date.now() - 60 * 60 * 1000) }
    });

    const since = new Date();
    await consultancyService.autoRefundExpiredContracts(new Date());

    const afterContract = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(afterContract.status).toBe("REFUNDED_EXPIRED");

    // A parte presencial não é tocada - continua exatamente como estava.
    const afterPackage = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(afterPackage.status).toBe("ACTIVE");

    const clientNotification = await waitForNotification(clientId, since);
    expect(clientNotification).not.toBeNull();
    const data = clientNotification!.data as any;
    expect(data.type).toBe("COMBO_CONSULTANCY_AUTO_REFUND");
    expect(data.packageId).toBe(pkg.id);
    expect(clientNotification!.body).toMatch(/presencial/i);
    expect(clientNotification!.body).toMatch(/continua/i);

    const providerNotification = await waitForNotification(providerUserId, since);
    expect(providerNotification).not.toBeNull();
    expect(providerNotification!.body).toMatch(/combo/i);
  });

  it("consultoria avulsa (sem combo) mantém a notificação genérica de sempre", async () => {
    const standaloneOffer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "ONLINE_CONSULTANCY",
        title: "Consultoria avulsa",
        billingCycle: "MONTHLY",
        priceCents: 15000
      }
    });

    const request = await prisma.consultancyRequest.create({
      data: {
        providerId,
        clientId,
        status: "RESPONDED",
        quotedOfferId: standaloneOffer.id,
        responseDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        respondedAt: new Date()
      }
    });
    const { contract } = await consultancyService.decideRequest(clientId, request.id, {
      decision: "ACCEPT",
      paymentMethod: "CREDIT_CARD" as any,
      acknowledgedImmediateExecution: true
    });

    await prisma.consultancyContract.update({
      where: { id: contract!.id },
      data: { deliveryDeadlineAt: new Date(Date.now() - 60 * 60 * 1000) }
    });

    const since = new Date();
    await consultancyService.autoRefundExpiredContracts(new Date());

    const notification = await waitForNotification(clientId, since);
    const data = notification!.data as any;
    expect(data.type).toBe("CONSULTANCY_AUTO_REFUND");
    expect(data.packageId).toBeUndefined();

    await prisma.consultancyContract.deleteMany({ where: { id: contract!.id } });
    await prisma.consultancyRequest.deleteMany({ where: { id: request.id } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: standaloneOffer.id } });
  });
});
