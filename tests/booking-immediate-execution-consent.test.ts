import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/config/prisma";
import { BookingService } from "../src/modules/bookings/services/booking.service";

// Raio-X de pagamentos, Rodada 3, Lote 5: agendamento presencial marcado para
// menos de 7 dias corridos pode ter o cancelamento resolvido pela regra das
// 2h antes que o prazo de arrependimento de 7 dias do CDC (art. 49) termine
// — mesmo carve-out já usado na consultoria (consentimento expresso ao
// início imediato do atendimento). Agendamento para 7 dias ou mais nunca
// esbarra nisso.

const bookingService = new BookingService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const bookingIds: string[] = [];

describe("Consentimento de início imediato em agendamento presencial (Rodada 3, Lote 5)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `IEC_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Immediate Exec Client",
        email: `${uid("iec_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Immediate Exec Provider",
        email: `${uid("iec_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Immediate Exec Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
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

  function scheduledAtDaysFromNow(days: number) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    date.setHours(14, 0, 0, 0);
    return date.toISOString();
  }

  it("bloqueia agendamento pra menos de 7 dias sem o consentimento expresso", async () => {
    await expect(
      bookingService.create(
        clientId,
        providerId,
        categoryId,
        scheduledAtDaysFromNow(3),
        undefined,
        "CREDIT_CARD" as any
      )
    ).rejects.toThrow(/início imediato/);
  });

  it("permite agendamento pra menos de 7 dias com o consentimento expresso, e grava o timestamp", async () => {
    const booking = await bookingService.create(
      clientId,
      providerId,
      categoryId,
      scheduledAtDaysFromNow(3),
      undefined,
      "CREDIT_CARD" as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true
    );
    bookingIds.push(booking.id);

    const fromDb = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(fromDb.immediateExecutionAcknowledgedAt).not.toBeNull();
  });

  it("agendamento pra 7 dias ou mais não exige consentimento nenhum", async () => {
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
    expect(fromDb.immediateExecutionAcknowledgedAt).toBeNull();
  });
});
