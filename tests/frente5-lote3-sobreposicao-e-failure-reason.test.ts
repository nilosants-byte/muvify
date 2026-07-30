import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PaymentMethod, PaymentStatus } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { BookingService } from "../src/modules/bookings/services/booking.service";
import { PaymentService } from "../src/modules/payments/services/payment.service";

// Épico de Frentes, Frente 5 (Descoberta, agendamento e agenda), Lote 3:
// (1) dois agendamentos que se sobrepõem no tempo (não exatamente o mesmo
//     instante, mas dentro da duração de sessão do profissional) são
//     rejeitados na criação; agendamentos encostados (uma termina quando a
//     outra começa) continuam permitidos.
// (2) payment.failureReason agora é devolvido por getPaymentForBooking.

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

describe("Frente 5, Lote 3 — sobreposição de horário e payment.failureReason", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `F5L3_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Cinco Lote Tres",
        email: `${uid("f5l3_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        emailVerifiedAt: new Date()
      }
    });
    clientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Cinco Lote Tres",
        email: `${uid("f5l3_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Cinco Lote Tres",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        crefValidationStatus: "APPROVED",
        minBookingNoticeHours: 1,
        sessionDurationMinutes: 60
      }
    });
    providerId = provider.id;

    await prisma.availability.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        providerId,
        weekday,
        startTime: "00:00",
        endTime: "23:59",
        isActive: true
      }))
    });
    await prisma.providerCategory.create({ data: { providerId, categoryId } });
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { booking: { id: { in: bookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.availability.deleteMany({ where: { providerId } });
    await prisma.providerCategory.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [clientId, providerUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("rejeita um segundo agendamento cujo horário se sobrepõe ao primeiro (mesmo sem ser o instante exato)", async () => {
    const first = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    first.setHours(10, 0, 0, 0);

    const booking = await bookingService.create(
      clientId,
      providerId,
      categoryId,
      first.toISOString(),
      undefined,
      PaymentMethod.CREDIT_CARD
    );
    bookingIds.push(booking.id);

    const overlapping = new Date(first.getTime() + 5 * 60 * 1000);
    await expect(
      bookingService.create(clientId, providerId, categoryId, overlapping.toISOString(), undefined, PaymentMethod.CREDIT_CARD)
    ).rejects.toThrow(/conflita/i);
  });

  it("permite um segundo agendamento encostado (começa exatamente quando o primeiro termina)", async () => {
    const first = new Date(Date.now() + 11 * 24 * 60 * 60 * 1000);
    first.setHours(9, 0, 0, 0);

    const firstBooking = await bookingService.create(
      clientId,
      providerId,
      categoryId,
      first.toISOString(),
      undefined,
      PaymentMethod.CREDIT_CARD
    );
    bookingIds.push(firstBooking.id);

    const backToBack = new Date(first.getTime() + 60 * 60 * 1000);
    const secondBooking = await bookingService.create(
      clientId,
      providerId,
      categoryId,
      backToBack.toISOString(),
      undefined,
      PaymentMethod.CREDIT_CARD
    );
    bookingIds.push(secondBooking.id);

    expect(secondBooking.id).not.toBe(firstBooking.id);
  });

  it("getPaymentForBooking devolve failureReason quando o pagamento falhou", async () => {
    const scheduled = new Date(Date.now() + 12 * 24 * 60 * 60 * 1000);
    scheduled.setHours(14, 0, 0, 0);
    const booking = await bookingService.create(
      clientId,
      providerId,
      categoryId,
      scheduled.toISOString(),
      undefined,
      PaymentMethod.CREDIT_CARD
    );
    bookingIds.push(booking.id);

    await prisma.payment.update({
      where: { bookingId: booking.id },
      data: { status: PaymentStatus.FAILED, failureReason: "Cartão recusado pela operadora." }
    });

    const view = await paymentService.getPaymentForBooking(booking.id, clientId);
    expect(view?.failureReason).toBe("Cartão recusado pela operadora.");
  });
});
