import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/config/prisma";
import { BookingService } from "../src/modules/bookings/services/booking.service";

// Raio-X de pagamentos, Rodada 4, Lote 4: agendamento avulso nascia PENDING
// sem nenhum prazo pro profissional confirmar — só expirava depois que o
// horário da sessão já tinha passado. Agora ganha confirmationDeadlineAt
// (min(24h, horário - 2h)), lembrete antes de vencer e cancelamento +
// reembolso automático se vencer sem confirmação, antes da sessão chegar.

const bookingService = new BookingService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const bookingIds: string[] = [];

describe("Prazo de confirmação do agendamento avulso (Rodada 4, Lote 4)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `BCD_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Confirmation Deadline Client",
        email: `${uid("bcd_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });

    const providerUser = await prisma.user.create({
      data: {
        name: "Confirmation Deadline Provider",
        email: `${uid("bcd_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Confirmation Deadline Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        crefValidationStatus: "APPROVED",
        minBookingNoticeHours: 1
      }
    });
    providerId = provider.id;

    // Disponibilidade 24h em todos os dias — o teste de prazo limitado a 2h
    // antes do horário marcado usa scheduledAt relativo a "agora" (não a um
    // horário fixo), e uma janela 06:00-22:00 faria o teste falhar de forma
    // determinística dependendo da hora do dia em que a suíte roda.
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
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  let scheduleHourCounter = 0;
  function scheduledAtDaysFromNow(days: number) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    date.setHours(8 + (scheduleHourCounter++ % 10), 0, 0, 0);
    return date.toISOString();
  }

  it("agendamento com bastante antecedência ganha prazo de 24h para confirmação", async () => {
    const booking = await bookingService.create(
      clientId,
      providerId,
      categoryId,
      scheduledAtDaysFromNow(10),
      undefined,
      "CREDIT_CARD" as any
    );
    bookingIds.push(booking.id);

    const fromDb = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(fromDb.confirmationDeadlineAt).not.toBeNull();
    const deadlineMs = fromDb.confirmationDeadlineAt!.getTime();
    const expected24h = Date.now() + 24 * 60 * 60 * 1000;
    expect(Math.abs(deadlineMs - expected24h)).toBeLessThan(60 * 1000);
  });

  it("agendamento com pouca antecedência tem o prazo limitado a 2h antes do horário marcado", async () => {
    const scheduleDate = new Date(Date.now() + 25 * 60 * 60 * 1000); // 25h à frente
    const booking = await bookingService.create(
      clientId,
      providerId,
      categoryId,
      scheduleDate.toISOString(),
      undefined,
      "CREDIT_CARD" as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true // ciência de início imediato (agendamento < 7 dias)
    );
    bookingIds.push(booking.id);

    const fromDb = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(fromDb.confirmationDeadlineAt).not.toBeNull();
    const expectedDeadline = scheduleDate.getTime() - 2 * 60 * 60 * 1000;
    expect(Math.abs(fromDb.confirmationDeadlineAt!.getTime() - expectedDeadline)).toBeLessThan(60 * 1000);
  });

  it("lembrete de confirmação é enviado uma única vez quando o prazo está próximo de vencer", async () => {
    const booking = await bookingService.create(
      clientId,
      providerId,
      categoryId,
      scheduledAtDaysFromNow(10),
      undefined,
      "CREDIT_CARD" as any
    );
    bookingIds.push(booking.id);

    await prisma.booking.update({
      where: { id: booking.id },
      data: { confirmationDeadlineAt: new Date(Date.now() + 60 * 60 * 1000) } // vence em 1h
    });

    await bookingService.sendBookingConfirmationReminders();
    let fromDb = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(fromDb.confirmationReminderSentAt).not.toBeNull();

    const sentAtFirstRun = fromDb.confirmationReminderSentAt;
    await bookingService.sendBookingConfirmationReminders();
    fromDb = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(fromDb.confirmationReminderSentAt?.getTime()).toBe(sentAtFirstRun?.getTime());
  });

  it("booking PENDING que passa do prazo de confirmação antes do horário da sessão é cancelado e reembolsado automaticamente", async () => {
    const booking = await bookingService.create(
      clientId,
      providerId,
      categoryId,
      scheduledAtDaysFromNow(10),
      undefined,
      "CREDIT_CARD" as any
    );
    bookingIds.push(booking.id);

    await prisma.booking.update({
      where: { id: booking.id },
      data: { confirmationDeadlineAt: new Date(Date.now() - 60 * 1000) } // prazo já vencido
    });

    await bookingService.autoExpireStaleBookings();

    const fromDb = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(fromDb.status).toBe("CANCELLED");

    const payment = await prisma.payment.findUnique({ where: { bookingId: booking.id } });
    expect(payment?.status).not.toBe("AUTHORIZED");
  });

  it("booking PENDING confirmado dentro do prazo não é afetado pela expiração automática", async () => {
    const booking = await bookingService.create(
      clientId,
      providerId,
      categoryId,
      scheduledAtDaysFromNow(10),
      undefined,
      "CREDIT_CARD" as any
    );
    bookingIds.push(booking.id);

    await bookingService.autoExpireStaleBookings();

    const fromDb = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(fromDb.status).toBe("PENDING");
  });
});
