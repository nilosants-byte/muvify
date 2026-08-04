import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { CrefValidationStatus } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { BookingService } from "../src/modules/bookings/services/booking.service";
import { NotificationService } from "../src/modules/notifications/services/notification.service";
import { hashValue } from "../src/shared/utils/hash";

// Épico de Frentes, Frente 9, Lote 15 (decisão do usuário: construir):
// não existia lembrete de "avalie sua sessão/profissional" - cliente só
// avaliava se lembrasse sozinho. Novo job sendReviewReminders, disparado
// 24h depois da sessão COMPLETED sem review associada ainda.

const bookingService = new BookingService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let categoryId = "";
let clientId = "";
let providerUserId = "";
let providerId = "";
const createdUserIds: string[] = [];
const bookingIds: string[] = [];
const reviewIds: string[] = [];

describe("Frente 9, Lote 15 — lembrete de avaliação pendente", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `F9L15_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Frente Nove Lote Quinze Client",
        email: `${uid("f9l15_client")}@test.com`,
        password: await hashValue("Test1234"),
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;
    createdUserIds.push(clientId);

    const providerUser = await prisma.user.create({
      data: {
        name: "Frente Nove Lote Quinze Provider",
        email: `${uid("f9l15_provider")}@test.com`,
        password: await hashValue("Test1234"),
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;
    createdUserIds.push(providerUserId);

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "F9L15 Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: `mp_${uid("f9l15")}`,
        crefValidationStatus: CrefValidationStatus.APPROVED
      }
    });
    providerId = provider.id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.review.deleteMany({ where: { id: { in: reviewIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  async function makeCompletedBooking(completedAt: Date) {
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: completedAt,
        priceCents: 10000,
        status: "COMPLETED",
        completedAt
      }
    });
    bookingIds.push(booking.id);
    return booking;
  }

  it("sessão concluída há mais de 24h sem avaliação recebe o lembrete", async () => {
    const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
    const booking = await makeCompletedBooking(new Date(Date.now() - 25 * 60 * 60 * 1000));

    await bookingService.sendReviewReminders();

    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.reviewReminderSentAt).not.toBeNull();
    expect(notifySpy).toHaveBeenCalledWith([clientId], expect.objectContaining({
      data: expect.objectContaining({ type: "REVIEW_REMINDER", bookingId: booking.id })
    }));
  });

  it("sessão concluída há menos de 24h ainda não recebe o lembrete", async () => {
    const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
    const booking = await makeCompletedBooking(new Date(Date.now() - 2 * 60 * 60 * 1000));

    await bookingService.sendReviewReminders();

    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.reviewReminderSentAt).toBeNull();
    // Escopado pra ESTA reserva - o job roda sobre a tabela toda, então em
    // banco de teste compartilhado outras reservas elegíveis (de outros
    // arquivos) podem legitimamente disparar notifySpy também.
    expect(notifySpy).not.toHaveBeenCalledWith(
      [clientId],
      expect.objectContaining({ data: expect.objectContaining({ bookingId: booking.id }) })
    );
  });

  it("sessão já avaliada não recebe o lembrete", async () => {
    const notifySpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
    const booking = await makeCompletedBooking(new Date(Date.now() - 30 * 60 * 60 * 1000));
    const review = await prisma.review.create({
      data: { bookingId: booking.id, userId: clientId, providerId, rating: 5, comment: "Ótimo!" }
    });
    reviewIds.push(review.id);

    await bookingService.sendReviewReminders();

    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.reviewReminderSentAt).toBeNull();
    expect(notifySpy).not.toHaveBeenCalledWith(
      [clientId],
      expect.objectContaining({ data: expect.objectContaining({ bookingId: booking.id }) })
    );
  });

  it("lembrete não duplica em execuções repetidas do job", async () => {
    vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
    const booking = await makeCompletedBooking(new Date(Date.now() - 26 * 60 * 60 * 1000));

    await bookingService.sendReviewReminders();
    const firstRun = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(firstRun.reviewReminderSentAt).not.toBeNull();

    await bookingService.sendReviewReminders();
    const secondRun = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(secondRun.reviewReminderSentAt?.getTime()).toBe(firstRun.reviewReminderSentAt?.getTime());
  });
});
