import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Payment, CardToken } from "mercadopago";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";
import { prisma } from "../src/config/prisma";
import { encryptSensitiveText } from "../src/shared/utils/encryption";
import * as platformFeeModule from "../src/shared/utils/platform-fee";
import { NotificationService } from "../src/modules/notifications/services/notification.service";

// Raio-X de pagamentos, Rodada 3, Lote 7: achado grave #2 que ficou de fora
// do plano original da Rodada 3 — duplo clique em comprar um pacote
// presencial ou combo podia gerar cobrança REAL duplicada no Mercado Pago,
// porque a checagem "já existe um pacote ativo?" rodava fora de transação,
// sem trava nem constraint única. Corrigido com o mesmo idioma de advisory
// lock já usado com segurança em booking.service.ts::create.

const packageService = new PresentialPackageService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const offerIds: string[] = [];
const packageIds: string[] = [];
const contractIds: string[] = [];

describe("Duplo clique em compra de pacote/combo não gera cobrança duplicada (Rodada 3, Lote 7)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `DC_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Double Click Client",
        email: `${uid("dc_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        mpCustomerId: "cus_test_dc"
      }
    });
    clientId = client.id;

    await prisma.customerPaymentMethod.create({
      data: {
        userId: clientId,
        mpCustomerId: "cus_test_dc",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });

    const providerUser = await prisma.user.create({
      data: {
        name: "Double Click Provider",
        email: `${uid("dc_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Double Click Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "555444333",
        mpAccessToken: encryptSensitiveText("fake_access_token"),
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;
  });

  afterAll(async () => {
    await prisma.consultancyContract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId } });
    await prisma.presentialPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
    vi.restoreAllMocks();
  });

  it("duas compras concorrentes do mesmo pacote (créditos flexíveis): só uma cria o pacote, a outra recebe 409", async () => {
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

    const [r1, r2] = await Promise.allSettled([
      packageService.purchasePackage(clientId, {
        offerId: offer.id,
        categoryId,
        paymentMethod: "CREDIT_CARD" as any
      }),
      packageService.purchasePackage(clientId, {
        offerId: offer.id,
        categoryId,
        paymentMethod: "CREDIT_CARD" as any
      })
    ]);

    const statuses = [r1.status, r2.status];
    expect(statuses.filter((s) => s === "fulfilled")).toHaveLength(1);
    expect(statuses.filter((s) => s === "rejected")).toHaveLength(1);

    const fulfilled = (r1.status === "fulfilled" ? r1 : r2) as PromiseFulfilledResult<any>;
    packageIds.push(fulfilled.value.package.id);

    const count = await prisma.presentialPackage.count({ where: { clientId, offerId: offer.id } });
    expect(count).toBe(1);
  });

  it("duas compras concorrentes do mesmo combo: só uma cria pacote+contrato, a outra recebe 409, sem cobrança duplicada", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "COMBO",
        title: `Combo ${uid("offer")}`,
        billingCycle: "MONTHLY",
        priceCents: 90000,
        presentialPackageMode: "FIXED_RECURRING",
        presentialSessionsPerCycle: 4,
        acceptsCreditCard: true,
        comboPresentialShareCents: 60000,
        comboConsultancyShareCents: 30000,
        comboPresentialDaysPerWeek: 2,
        comboOnlineDaysPerWeek: 3
      }
    });
    offerIds.push(offer.id);

    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
    const paymentCreateSpy = vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 8100, status: "approved" } as any);

    const purchaseInput = {
      offerId: offer.id,
      categoryId,
      paymentMethod: "CREDIT_CARD" as any,
      weeklySchedule: [{ weekday: 1, time: "08:00" }],
      acknowledgedImmediateExecution: true
    };

    const [r1, r2] = await Promise.allSettled([
      packageService.purchaseCombo(clientId, purchaseInput),
      packageService.purchaseCombo(clientId, purchaseInput)
    ]);

    const statuses = [r1.status, r2.status];
    expect(statuses.filter((s) => s === "fulfilled")).toHaveLength(1);
    expect(statuses.filter((s) => s === "rejected")).toHaveLength(1);

    const fulfilled = (r1.status === "fulfilled" ? r1 : r2) as PromiseFulfilledResult<any>;
    packageIds.push(fulfilled.value.package.id);
    contractIds.push(fulfilled.value.contract.id);

    const packageCount = await prisma.presentialPackage.count({ where: { clientId, offerId: offer.id } });
    expect(packageCount).toBe(1);

    // Consultoria (1x) + ciclo presencial (1x) = 2 cobranças reais no total,
    // nunca 4 (o que aconteceria se as duas requisições concorrentes
    // tivessem passado pela reserva).
    expect(paymentCreateSpy).toHaveBeenCalledTimes(2);
  });

  it("purchaseCombo: se a criação do contrato de consultoria falhar depois de reservar o pacote, cancela o pacote órfão automaticamente", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "COMBO",
        title: `Combo ${uid("offer")}`,
        billingCycle: "MONTHLY",
        priceCents: 90000,
        presentialPackageMode: "FLEXIBLE_CREDITS",
        presentialSessionsPerCycle: 4,
        presentialHasFixedTerm: true,
        presentialTotalCycles: 1,
        acceptsCreditCard: true,
        comboPresentialShareCents: 60000,
        comboConsultancyShareCents: 30000,
        comboPresentialDaysPerWeek: 2,
        comboOnlineDaysPerWeek: 3
      }
    });
    offerIds.push(offer.id);

    // providerSplitAmount só é chamado na criação do contrato de
    // consultoria (a reserva do pacote em modo FLEXIBLE_CREDITS não calcula
    // split nenhum) — ponto de injeção preciso pra simular a falha
    // exatamente onde ela deixava o pacote órfão, sem mexer na 1ª transação.
    const splitSpy = vi
      .spyOn(platformFeeModule, "providerSplitAmount")
      .mockImplementationOnce(() => {
        throw new Error("falha simulada de conexão");
      });
    const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers");

    await expect(
      packageService.purchaseCombo(clientId, {
        offerId: offer.id,
        categoryId,
        paymentMethod: "CREDIT_CARD" as any,
        acknowledgedImmediateExecution: true
      })
    ).rejects.toThrow();

    expect(splitSpy).toHaveBeenCalledTimes(1);

    // O pacote reservado antes da falha não pode continuar como fantasma —
    // senão o guard de "já existe um pacote ativo" bloqueia pra sempre.
    const orphaned = await prisma.presentialPackage.findFirst({ where: { clientId, offerId: offer.id } });
    expect(orphaned).not.toBeNull();
    expect(orphaned!.status).toBe("CANCELLED");
    packageIds.push(orphaned!.id);

    // Rodada 5, Lote 1: o cliente nunca recebeu confirmação de que esse
    // pacote fantasma tinha sido criado — o cleanup automático não pode
    // notificar "cancelado" sobre algo que, do ponto de vista dele, nunca
    // existiu.
    expect(notifySpy).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ data: expect.objectContaining({ type: "PRESENTIAL_PACKAGE_CANCELLED" }) })
    );
    notifySpy.mockRestore();

    // Uma nova tentativa (sem o mock de falha) precisa funcionar de cara.
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test2" } as any);
    vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 8200, status: "approved" } as any);
    const retry = await packageService.purchaseCombo(clientId, {
      offerId: offer.id,
      categoryId,
      paymentMethod: "CREDIT_CARD" as any,
      acknowledgedImmediateExecution: true
    });
    packageIds.push(retry.package.id);
    contractIds.push((retry.contract as { id: string }).id);
  });
});
