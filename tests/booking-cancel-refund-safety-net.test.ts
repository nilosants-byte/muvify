import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { PaymentRefund } from "mercadopago";
import { PaymentStatus, BookingStatus } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { BookingService } from "../src/modules/bookings/services/booking.service";
import { PaymentService } from "../src/modules/payments/services/payment.service";

// Raio-X de pagamentos (27/07/2026) — Lote 1: cancelPaymentForBooking nao pode
// mais deixar uma falha de estorno da MP subir sem controle. Antes desta
// correcao, uma falha aqui (o caminho de cancelamento mais comum do app)
// deixava o agendamento cancelado no banco sem que ninguem soubesse que o
// dinheiro nao voltou. Agora deve sempre resolver num estado estavel: cria
// um DisputeCase (mesmo padrao ja usado em consultoria/pacote presencial) e
// nunca lanca excecao.

const bookingService = new BookingService();
const paymentService = new PaymentService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const bookingIds: string[] = [];

describe("Rede de seguranca de estorno — cancelPaymentForBooking (Lote 1 do raio-x)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `RS_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Refund Safety Client",
        email: `${uid("refund_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Refund Safety Provider",
        email: `${uid("refund_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Refund Safety Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "888777666",
        crefValidationStatus: "APPROVED",
        minBookingNoticeHours: 1
      }
    });
    providerId = provider.id;

    await prisma.availability.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        providerId,
        weekday,
        startTime: "06:00",
        endTime: "22:00",
        isActive: true
      }))
    });
    await prisma.providerCategory.create({ data: { providerId, categoryId } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.disputeCase.deleteMany({ where: { clientId } });
    await prisma.payment.deleteMany({ where: { booking: { id: { in: bookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.availability.deleteMany({ where: { providerId } });
    await prisma.providerCategory.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  async function createCapturedBooking(daysFromNow = 2) {
    const scheduledAt = new Date();
    scheduledAt.setDate(scheduledAt.getDate() + daysFromNow);
    scheduledAt.setHours(14, 0, 0, 0);
    const booking = await bookingService.create(
      clientId,
      providerId,
      categoryId,
      scheduledAt.toISOString(),
      undefined,
      "CREDIT_CARD" as any
    );
    bookingIds.push(booking.id);

    // Simula uma sessao ja concluida e cobrada de verdade (CAPTURED).
    await prisma.payment.update({
      where: { bookingId: booking.id },
      data: { status: PaymentStatus.CAPTURED, mpPaymentId: `mp_${uid("pay")}`, capturedAt: new Date() }
    });
    await prisma.booking.update({ where: { id: booking.id }, data: { status: BookingStatus.CONFIRMED } });

    return booking;
  }

  it("quando o estorno da MP falha, cria um DisputeCase em vez de lancar excecao", async () => {
    vi.spyOn(PaymentRefund.prototype, "create").mockRejectedValueOnce(new Error("MP indisponivel"));

    const booking = await createCapturedBooking(2);

    await expect(paymentService.cancelPaymentForBooking(booking.id)).resolves.toBeUndefined();

    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(payment.status).toBe(PaymentStatus.CAPTURED);

    const dispute = await prisma.disputeCase.findFirst({ where: { bookingId: booking.id, type: "REFUND_FAILED" } });
    expect(dispute).not.toBeNull();
    expect(dispute?.clientId).toBe(clientId);
    expect(dispute?.providerId).toBe(providerId);
    expect(dispute?.amountCents).toBe(payment.amountCents);
  });

  it("quando o estorno da MP funciona, marca REFUNDED normalmente e nao cria disputa", async () => {
    vi.spyOn(PaymentRefund.prototype, "create").mockResolvedValueOnce({ id: 12345 } as any);

    const booking = await createCapturedBooking(3);
    await paymentService.cancelPaymentForBooking(booking.id);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(payment.status).toBe(PaymentStatus.REFUNDED);

    const dispute = await prisma.disputeCase.findFirst({ where: { bookingId: booking.id, type: "REFUND_FAILED" } });
    expect(dispute).toBeNull();
  });

  it("o loop de cancelamento de sessoes futuras de um pacote continua processando mesmo se uma sessao falhar ao estornar", async () => {
    // Regressao indireta: antes da correcao, cancelPaymentForBooking lancava
    // excecao em caso de falha, o que interrompia qualquer loop chamando-o em
    // sequencia (ex: presential-package.service.ts::cancelPackage). Agora
    // nunca lanca, entao chamar em sequencia para varios bookings sempre
    // conclui todos, mesmo com falha no meio.
    vi.spyOn(PaymentRefund.prototype, "create")
      .mockResolvedValueOnce({ id: 1 } as any)
      .mockRejectedValueOnce(new Error("falha no meio da lista"))
      .mockResolvedValueOnce({ id: 2 } as any);

    const b1 = await createCapturedBooking(4);
    const b2 = await createCapturedBooking(5);
    const b3 = await createCapturedBooking(6);

    for (const b of [b1, b2, b3]) {
      await paymentService.cancelPaymentForBooking(b.id);
    }

    const payments = await prisma.payment.findMany({
      where: { bookingId: { in: [b1.id, b2.id, b3.id] } }
    });
    const byBooking = new Map(payments.map((p) => [p.bookingId, p.status]));
    expect(byBooking.get(b1.id)).toBe(PaymentStatus.REFUNDED);
    expect(byBooking.get(b2.id)).toBe(PaymentStatus.CAPTURED);
    expect(byBooking.get(b3.id)).toBe(PaymentStatus.REFUNDED);
  });
});
