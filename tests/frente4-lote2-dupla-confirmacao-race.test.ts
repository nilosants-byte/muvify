import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Payment } from "mercadopago";
import { S3Client } from "@aws-sdk/client-s3";
import { BookingStatus, PaymentStatus } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { BookingService } from "../src/modules/bookings/services/booking.service";

const fakeR2 = new Map<string, string>();
vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command: any) => {
  const commandName = command.constructor.name;
  if (commandName === "PutObjectCommand") {
    fakeR2.set(command.input.Key, command.input.Body.toString("utf8"));
    return {};
  }
  if (commandName === "GetObjectCommand") {
    const value = fakeR2.get(command.input.Key);
    if (value === undefined) {
      const err = new Error("NoSuchKey");
      err.name = "NoSuchKey";
      throw err;
    }
    return { Body: { transformToString: async () => value } };
  }
  throw new Error(`Unexpected S3 command in test: ${commandName}`);
});

// Épico de Frentes, Frente 4 (Criação/entrega/evolução do treino), Lote 2:
// (1) cliente e profissional confirmando quase ao mesmo tempo sempre
//     resulta em status COMPLETED (não trava mais em CONFIRMED).
// (2) rede de segurança: uma sessão que ficou travada (dados de antes do
//     fix) com os dois lados confirmados e código de presença validado é
//     encaminhada pra revisão manual (CONFIRMATION_DEADLOCK), não cancelada
//     e estornada automaticamente.

const bookingService = new BookingService();

const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=";
const completionProof = {
  imageBase64: `data:image/jpeg;base64,${TINY_JPEG_BASE64}`,
  mimeType: "image/jpeg" as const,
  cameraFacing: "FRONT" as const
};

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const bookingIds: string[] = [];

describe("Frente 4, Lote 2 — race de dupla-confirmação simultânea", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `DC_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Dupla Confirmacao Client",
        email: `${uid("dc_client")}@test.com`,
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
        name: "Dupla Confirmacao Provider",
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
        displayName: "Dupla Confirmacao Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "555444333",
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

  async function createBookingReadyToConfirm(daysInPast: number, paymentStatus: PaymentStatus) {
    const scheduledAt = new Date();
    scheduledAt.setDate(scheduledAt.getDate() - daysInPast);
    scheduledAt.setHours(14, 0, 0, 0);

    const futureScheduledAt = new Date();
    futureScheduledAt.setDate(futureScheduledAt.getDate() + daysInPast + 30);
    futureScheduledAt.setHours(14, 0, 0, 0);

    const booking = await bookingService.create(
      clientId,
      providerId,
      categoryId,
      futureScheduledAt.toISOString(),
      undefined,
      "CREDIT_CARD" as any
    );
    bookingIds.push(booking.id);

    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.CONFIRMED, attendanceCodeValidatedAt: new Date(), scheduledAt }
    });
    await prisma.payment.update({
      where: { bookingId: booking.id },
      data: { status: paymentStatus, mpPaymentId: `mp_${uid("pay")}` }
    });

    return booking;
  }

  it("cliente e profissional confirmando quase simultaneamente sempre resulta em COMPLETED, sem travar", async () => {
    vi.spyOn(Payment.prototype, "capture").mockResolvedValueOnce({ status: "approved", status_detail: "accredited" } as any);

    const booking = await createBookingReadyToConfirm(1, PaymentStatus.AUTHORIZED);

    const [clientResult, providerResult] = await Promise.allSettled([
      bookingService.updateStatus(clientId, booking.id, BookingStatus.COMPLETED, completionProof),
      bookingService.updateStatus(providerUserId, booking.id, BookingStatus.COMPLETED, completionProof)
    ]);

    expect(clientResult.status).toBe("fulfilled");
    expect(providerResult.status).toBe("fulfilled");

    const afterBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(afterBooking.status).toBe(BookingStatus.COMPLETED);
    expect(afterBooking.clientConfirmedAt).not.toBeNull();
    expect(afterBooking.providerConfirmedAt).not.toBeNull();

    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(payment.status).toBe(PaymentStatus.CAPTURED);
    // Captura só deveria ter sido tentada uma vez, mesmo com as duas
    // confirmações quase simultâneas.
    expect(Payment.prototype.capture).toHaveBeenCalledTimes(1);
  });

  it("sessão travada (dados legados) com os dois lados confirmados é encaminhada pra revisão manual, não cancelada e estornada sozinha", async () => {
    const booking = await createBookingReadyToConfirm(3, PaymentStatus.AUTHORIZED);

    // Simula o estado travado que o bug antigo produzia: os dois campos de
    // confirmação setados, mas o status nunca chegou a virar COMPLETED.
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        clientConfirmedAt: new Date(),
        providerConfirmedAt: new Date(),
        scheduledAt: new Date(Date.now() - 50 * 60 * 60 * 1000)
      }
    });

    await bookingService.autoExpireStaleBookings();

    const afterBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(afterBooking.status).toBe(BookingStatus.CANCELLED);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    // Não foi estornado automaticamente - continua reservado até revisão manual.
    expect(payment.status).toBe(PaymentStatus.AUTHORIZED);

    const dispute = await prisma.disputeCase.findFirst({
      where: { bookingId: booking.id, type: "CONFIRMATION_DEADLOCK" }
    });
    expect(dispute).not.toBeNull();
  });
});
