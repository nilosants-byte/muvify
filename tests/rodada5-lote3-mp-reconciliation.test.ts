import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { Payment } from "mercadopago";
import { prisma } from "../src/config/prisma";
import { PaymentService } from "../src/modules/payments/services/payment.service";
import { AdminService } from "../src/modules/admin/services/admin.service";
import { encryptSensitiveText } from "../src/shared/utils/encryption";
import { env } from "../src/config/env";

// Raio-X de pagamentos, Rodada 5, Lote 3: reconciliação com a Mercado Pago.
// (1) capturePaymentForBooking/deliverContract descartavam o status
// devolvido pela MP na captura — se a MP respondesse 200 com um status
// não-aprovado, o pagamento virava CAPTURED mesmo assim. (2) a dívida do
// profissional cobrava o valor bruto da venda, não o líquido (90%) que ele
// de fato recebeu.

const paymentService = new PaymentService();
const adminService = new AdminService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const bookingIds: string[] = [];

describe("Rodada 5, Lote 3 — reconciliação com a Mercado Pago", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `R5L3_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Lote3 Client",
        email: `${uid("l5l3_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Lote3 Provider",
        email: `${uid("l5l3_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Lote3 Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 20000,
        mpAccountId: "777666555",
        mpAccessToken: encryptSensitiveText("fake_access_token"),
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { booking: { id: { in: bookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("capturePaymentForBooking não marca CAPTURED quando a MP responde com status não-aprovado", async () => {
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 60 * 60 * 1000),
        priceCents: 10000,
        status: "CONFIRMED"
      }
    });
    bookingIds.push(booking.id);
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        amountCents: 10000,
        providerAmountCents: 9000,
        platformFeeCents: 1000,
        method: "CREDIT_CARD",
        status: "AUTHORIZED",
        mpPaymentId: `mp_${uid("cap")}`
      }
    });

    vi.spyOn(Payment.prototype, "capture").mockResolvedValue({ status: "cancelled", status_detail: "expired" } as any);

    await expect(paymentService.capturePaymentForBooking(booking.id)).rejects.toThrow(/recusada/i);

    const afterAttempt = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(afterAttempt.status).toBe("AUTHORIZED");
    expect(afterAttempt.capturedAt).toBeNull();
  });

  it("capturePaymentForBooking marca CAPTURED normalmente quando a MP aprova", async () => {
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 60 * 60 * 1000),
        priceCents: 10000,
        status: "CONFIRMED"
      }
    });
    bookingIds.push(booking.id);
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        amountCents: 10000,
        providerAmountCents: 9000,
        platformFeeCents: 1000,
        method: "CREDIT_CARD",
        status: "AUTHORIZED",
        mpPaymentId: `mp_${uid("cap_ok")}`
      }
    });

    vi.spyOn(Payment.prototype, "capture").mockResolvedValue({ status: "approved", status_detail: "accredited" } as any);

    const captured = await paymentService.capturePaymentForBooking(booking.id);
    expect(captured.status).toBe("CAPTURED");

    const afterAttempt = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(afterAttempt.status).toBe("CAPTURED");
    expect(afterAttempt.capturedAt).not.toBeNull();
  });

  it("dashboard agrega a comissão real da plataforma no mês, não só o faturamento bruto (moderado #5)", async () => {
    const adminEmail = env.ADMIN_ALLOWED_EMAILS[0];
    let admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!admin) {
      admin = await prisma.user.create({
        data: { name: "Lote3 Admin", email: adminEmail, password: "x", phone: `11${Date.now().toString().slice(-9)}9`, role: "CLIENT" }
      });
    }

    const scheduledAt = new Date();
    scheduledAt.setDate(1);
    scheduledAt.setHours(12, 0, 0, 0);
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt,
        priceCents: 10000,
        status: "COMPLETED",
        completedAt: scheduledAt
      }
    });
    bookingIds.push(booking.id);
    await prisma.payment.create({
      data: {
        bookingId: booking.id,
        amountCents: 10000,
        providerAmountCents: 9000,
        platformFeeCents: 1000,
        method: "CREDIT_CARD",
        status: "CAPTURED",
        capturedAt: scheduledAt,
        mpPaymentId: `mp_${uid("commission")}`
      }
    });

    const overview = await adminService.getDashboardOverview({
      month: scheduledAt.getMonth() + 1,
      year: scheduledAt.getFullYear()
    });

    expect(overview.attentionNeeded.commissionThisMonthCents).toBeGreaterThanOrEqual(1000);
  });
});
