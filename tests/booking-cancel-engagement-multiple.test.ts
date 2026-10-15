import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BookingStatus } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { BookingService } from "../src/modules/bookings/services/booking.service";

// Achado em teste manual (2026-10-15): "Cancelar plano" (Meu Personal) pra
// vinculo puramente avulso so cancelava UM booking (o usado so pra
// identificar o profissional em getActiveEngagementSummary) - se o cliente
// tivesse mais de um agendamento pendente/confirmado com o mesmo
// profissional (ex: multiplos dias escolhidos de uma vez ao agendar), os
// outros continuavam ativos e o vinculo de exclusividade nunca era
// liberado de verdade, apesar do toast dizer o contrario.

const bookingService = new BookingService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let otherProviderUserId = "";
let otherProviderId = "";
let categoryId = "";
const userIds: string[] = [];
const providerIds: string[] = [];

async function createBooking(daysFromNow: number, targetProviderId: string) {
  const scheduledAt = new Date();
  scheduledAt.setDate(scheduledAt.getDate() + daysFromNow);
  scheduledAt.setHours(14, 0, 0, 0);
  return bookingService.create(
    clientId,
    targetProviderId,
    categoryId,
    scheduledAt.toISOString(),
    undefined,
    "CREDIT_CARD" as any,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    true
  );
}

describe("Cancelar vínculo avulso cancela TODOS os agendamentos com o profissional (achado 2026-10-15)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `CEM_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Cliente Cancelamento Engagement",
        email: `${uid("cem_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        emailVerifiedAt: new Date()
      }
    });
    clientId = client.id;
    userIds.push(clientId);
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });

    async function makeProvider(suffix: string) {
      const user = await prisma.user.create({
        data: {
          name: `CEM Provider ${suffix}`,
          email: `${uid("cem_provider")}@test.com`,
          password: "x",
          phone: `11${Date.now().toString().slice(-9)}${suffix}`,
          role: "PROVIDER"
        }
      });
      userIds.push(user.id);
      const provider = await prisma.providerProfile.create({
        data: {
          userId: user.id,
          displayName: `CEM Provider ${suffix}`,
          bio: "test",
          experienceYears: 3,
          priceCents: 10000,
          mpAccountId: `mp_${uid("acc")}`,
          crefValidationStatus: "APPROVED",
          minBookingNoticeHours: 1
        }
      });
      providerIds.push(provider.id);
      await prisma.availability.createMany({
        data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          providerId: provider.id,
          weekday,
          startTime: "06:00",
          endTime: "22:00",
          isActive: true
        }))
      });
      await prisma.providerCategory.create({ data: { providerId: provider.id, categoryId } });
      return { userId: user.id, providerId: provider.id };
    }

    const main = await makeProvider("1");
    providerUserId = main.userId;
    providerId = main.providerId;

    const other = await makeProvider("2");
    otherProviderUserId = other.userId;
    otherProviderId = other.providerId;
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { booking: { providerId: { in: providerIds } } } });
    await prisma.booking.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.availability.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerCategory.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("cliente com 2 agendamentos ativos no mesmo profissional: cancela os dois, nao so o 'anchor'", async () => {
    const booking1 = await createBooking(2, providerId);
    const booking2 = await createBooking(3, providerId);

    const result = await bookingService.cancelAllStandaloneBookingsForClient(clientId, providerId);
    expect(result).toEqual({ cancelled: 2, total: 2 });

    const refreshed1 = await prisma.booking.findUnique({ where: { id: booking1.id } });
    const refreshed2 = await prisma.booking.findUnique({ where: { id: booking2.id } });
    expect(refreshed1?.status).toBe(BookingStatus.CANCELLED);
    expect(refreshed2?.status).toBe(BookingStatus.CANCELLED);
  });

  it("não cancela agendamento do cliente com OUTRO profissional", async () => {
    const ownBooking = await createBooking(4, providerId);

    // Inserido direto via Prisma (não por bookingService.create): a regra de
    // exclusividade de marketplace (assertNoActiveEngagementWithOtherProvider)
    // já impede, pela API normal, o cliente ter vínculo ativo com 2
    // profissionais ao mesmo tempo - isso é só pra garantir que o filtro por
    // providerId na query de cancelamento está lá de verdade, mesmo que essa
    // situação não deva acontecer pelo fluxo normal do app.
    const otherScheduledAt = new Date();
    otherScheduledAt.setDate(otherScheduledAt.getDate() + 4);
    otherScheduledAt.setHours(16, 0, 0, 0);
    const otherBooking = await prisma.booking.create({
      data: {
        clientId,
        providerId: otherProviderId,
        categoryId,
        scheduledAt: otherScheduledAt,
        priceCents: 10000,
        status: BookingStatus.PENDING
      }
    });

    const result = await bookingService.cancelAllStandaloneBookingsForClient(clientId, providerId);
    expect(result).toEqual({ cancelled: 1, total: 1 });

    const refreshedOwn = await prisma.booking.findUnique({ where: { id: ownBooking.id } });
    const refreshedOther = await prisma.booking.findUnique({ where: { id: otherBooking.id } });
    expect(refreshedOwn?.status).toBe(BookingStatus.CANCELLED);
    expect(refreshedOther?.status).toBe(BookingStatus.PENDING);
  });
});
