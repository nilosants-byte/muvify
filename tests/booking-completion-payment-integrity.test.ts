import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Payment } from "mercadopago";
import { S3Client } from "@aws-sdk/client-s3";
import { BookingStatus, PaymentStatus } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { BookingService } from "../src/modules/bookings/services/booking.service";
import { PaymentService } from "../src/modules/payments/services/payment.service";

// Fake in-memory R2 (mesma estrategia de tests/completion-evidence.test.ts)
// pra permitir a selfie de conclusao ser "salva" sem depender de uma conta
// Cloudflare real.
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

// Raio-X de pagamentos (27/07/2026) — Lote 2: uma sessao presencial paga no
// cartao nunca pode terminar "concluida" sem o dinheiro ter sido de fato
// resolvido (nem autorizado, nem capturado). Espelha a trava que ja existia
// so pra Pix.

const bookingService = new BookingService();
const paymentService = new PaymentService();

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

describe("Integridade da conclusao de sessao presencial (Lote 2 do raio-x)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `CI_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Completion Integrity Client",
        email: `${uid("ci_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });

    const providerUser = await prisma.user.create({
      data: {
        name: "Completion Integrity Provider",
        email: `${uid("ci_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Completion Integrity Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "777666555",
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

  async function createBookingReadyToConfirm(daysFromNow: number, paymentStatus: PaymentStatus | null) {
    const scheduledAt = new Date();
    scheduledAt.setDate(scheduledAt.getDate() - daysFromNow); // no passado, pronta pra concluir
    scheduledAt.setHours(14, 0, 0, 0);

    const futureScheduledAt = new Date();
    futureScheduledAt.setDate(futureScheduledAt.getDate() + daysFromNow + 30);
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
    if (paymentStatus) {
      await prisma.payment.update({ where: { bookingId: booking.id }, data: { status: paymentStatus } });
    }

    return booking;
  }

  it("bloqueia a conclusao quando o pagamento no cartao nunca foi autorizado", async () => {
    const booking = await createBookingReadyToConfirm(1, PaymentStatus.PENDING_AUTH);

    await bookingService.updateStatus(clientId, booking.id, BookingStatus.COMPLETED, completionProof);
    await expect(
      bookingService.updateStatus(providerUserId, booking.id, BookingStatus.COMPLETED, completionProof)
    ).rejects.toThrow(/não foi autorizado/);

    const afterBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(afterBooking.status).toBe(BookingStatus.CONFIRMED);
    expect(afterBooking.providerConfirmedAt).toBeNull();
  });

  it("quando a captura falha na conclusao, nao marca concluido e nao lanca a acao como sucesso", async () => {
    vi.spyOn(Payment.prototype, "capture").mockRejectedValueOnce(new Error("MP indisponivel"));

    const booking = await createBookingReadyToConfirm(2, PaymentStatus.AUTHORIZED);
    await prisma.payment.update({ where: { bookingId: booking.id }, data: { mpPaymentId: `mp_${uid("pay")}` } });

    await bookingService.updateStatus(clientId, booking.id, BookingStatus.COMPLETED, completionProof);
    await expect(
      bookingService.updateStatus(providerUserId, booking.id, BookingStatus.COMPLETED, completionProof)
    ).rejects.toThrow();

    const afterBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(afterBooking.status).toBe(BookingStatus.CONFIRMED);
    expect(afterBooking.providerConfirmedAt).toBeNull();

    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(payment.status).toBe(PaymentStatus.AUTHORIZED);
  });

  it("conclui normalmente quando a captura funciona", async () => {
    vi.spyOn(Payment.prototype, "capture").mockResolvedValueOnce({ status: "approved", status_detail: "accredited" } as any);

    const booking = await createBookingReadyToConfirm(3, PaymentStatus.AUTHORIZED);
    await prisma.payment.update({ where: { bookingId: booking.id }, data: { mpPaymentId: `mp_${uid("pay")}` } });

    await bookingService.updateStatus(clientId, booking.id, BookingStatus.COMPLETED, completionProof);
    await bookingService.updateStatus(providerUserId, booking.id, BookingStatus.COMPLETED, completionProof);

    const afterBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(afterBooking.status).toBe(BookingStatus.COMPLETED);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(payment.status).toBe(PaymentStatus.CAPTURED);
  });

  it("captureIfAuthorizedForBookingOrDispute cria um DisputeCase quando a captura falha, sem lancar excecao", async () => {
    vi.spyOn(Payment.prototype, "capture").mockRejectedValueOnce(new Error("MP indisponivel"));

    const booking = await createBookingReadyToConfirm(4, PaymentStatus.AUTHORIZED);
    await prisma.payment.update({ where: { bookingId: booking.id }, data: { mpPaymentId: `mp_${uid("pay")}` } });

    await expect(
      paymentService.captureIfAuthorizedForBookingOrDispute(booking.id, "teste")
    ).resolves.toBeNull();

    const dispute = await prisma.disputeCase.findFirst({
      where: { bookingId: booking.id, type: "CAPTURE_FAILED" }
    });
    expect(dispute).not.toBeNull();
    expect(dispute?.clientId).toBe(clientId);
    expect(dispute?.providerId).toBe(providerId);
  });
});
