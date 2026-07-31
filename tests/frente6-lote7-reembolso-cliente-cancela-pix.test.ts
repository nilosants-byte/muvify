import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { PaymentRefund } from "mercadopago";
import {
  BookingStatus,
  ConsultancyPaymentMethod,
  PresentialPackageMode,
  PresentialPackageStatus
} from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";

// Épico de Frentes, Frente 6 (Ofertas do profissional), Lote 7: quando é o
// PROFISSIONAL quem cancela um pacote FIXED_RECURRING+Pix (ciclo cobrado
// adiantado), há reembolso proporcional e as sessões futuras CONFIRMED são
// canceladas. Quando é o CLIENTE quem cancela o mesmo tipo de pacote,
// nenhum dos dois acontecia — janela de arrependimento que existe pra todo
// o resto (inclusive consultoria) não existia pra esse tipo específico.

const packageService = new PresentialPackageService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const packageIds: string[] = [];
const bookingIds: string[] = [];

describe("Frente 6, Lote 7 — reembolso ao cliente cancelar pacote FIXED_RECURRING+Pix", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `F6L7_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Seis Lote Sete",
        email: `${uid("f6l7_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Seis Lote Sete",
        email: `${uid("f6l7_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Seis Lote Sete",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.disputeCase.deleteMany({ where: { clientId } });
    await prisma.presentialPackageCycle.deleteMany({ where: { package: { id: { in: packageIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.presentialPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  async function createCyclePixPackage() {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "PRESENTIAL",
        title: `Pacote Pix ${uid("offer")}`,
        billingCycle: "MONTHLY",
        priceCents: 40000,
        presentialPackageMode: "FIXED_RECURRING",
        presentialSessionsPerCycle: 4
      }
    });

    const pkg = await prisma.presentialPackage.create({
      data: {
        providerId,
        clientId,
        offerId: offer.id,
        categoryId,
        mode: PresentialPackageMode.FIXED_RECURRING,
        status: PresentialPackageStatus.ACTIVE,
        paymentMethod: ConsultancyPaymentMethod.PIX,
        cycleAmountCents: 40000,
        billingCycle: "MONTHLY",
        sessionsPerCycle: 4
      }
    });
    packageIds.push(pkg.id);

    const now = new Date();
    const cycle = await prisma.presentialPackageCycle.create({
      data: {
        packageId: pkg.id,
        cycleIndex: 1,
        amountCents: 40000,
        sessionsGranted: 4,
        mpPaymentId: `mp_${uid("cycle")}`,
        capturedAt: now,
        periodStart: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        periodEnd: new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000)
      }
    });

    const futureBooking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        packageId: pkg.id,
        scheduledAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        priceCents: 0,
        status: BookingStatus.CONFIRMED
      }
    });
    bookingIds.push(futureBooking.id);

    return { pkg, cycle, futureBooking };
  }

  it("cliente cancela o pacote logo após a compra (nenhuma sessão entregue ainda): recebe reembolso integral do ciclo e as sessões futuras são canceladas", async () => {
    const { pkg, cycle, futureBooking } = await createCyclePixPackage();

    const refundSpy = vi.spyOn(PaymentRefund.prototype, "create").mockResolvedValue({} as any);

    await packageService.cancelPackage(clientId, pkg.id);

    expect(refundSpy).toHaveBeenCalledWith(
      expect.objectContaining({ payment_id: cycle.mpPaymentId })
    );

    const bookingAfter = await prisma.booking.findUniqueOrThrow({ where: { id: futureBooking.id } });
    expect(bookingAfter.status).toBe(BookingStatus.CANCELLED);

    const pkgAfter = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(pkgAfter.status).toBe(PresentialPackageStatus.CANCELLED);
  });

  it("falha no reembolso ao cliente cancelar cria um DisputeCase mencionando o cliente como quem cancelou", async () => {
    const { pkg, cycle } = await createCyclePixPackage();

    vi.spyOn(PaymentRefund.prototype, "create").mockRejectedValue(new Error("mp indisponível"));

    await packageService.cancelPackage(clientId, pkg.id);

    const dispute = await prisma.disputeCase.findFirst({
      where: { presentialPackageCycleId: cycle.id, type: "REFUND_FAILED" }
    });
    expect(dispute).toBeTruthy();
    expect(dispute!.contextNote).toMatch(/cancelamento pelo cliente/i);
  });
});
