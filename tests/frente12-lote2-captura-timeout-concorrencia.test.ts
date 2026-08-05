import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { Payment } from "mercadopago";
import { S3Client } from "@aws-sdk/client-s3";
import {
  BookingStatus,
  OfferBillingCycle,
  PaymentMethod,
  PaymentStatus,
  PresentialPackageMode,
  PresentialPackageStatus
} from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { BookingService } from "../src/modules/bookings/services/booking.service";
import { PaymentService } from "../src/modules/payments/services/payment.service";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";
import { NotificationService } from "../src/modules/notifications/services/notification.service";

// Épico de Frentes, Frente 12 (Revisão geral do fluxo de pagamentos), Lote 2:
// a captura de pagamento na confirmação de sessão acontecia dentro de uma
// transação interativa do Prisma com timeout IGUAL ao timeout do próprio
// cliente da Mercado Pago (15s) - sem nenhuma margem pro resto do trabalho
// (evidência de conclusão + update final do booking). Também corrige duas
// falhas de concorrência menores encontradas na mesma revisão: notificação/
// audit log duplicados numa corrida job-vs-confirmação-manual, e falta de
// advisory lock na confirmação de Pix de ciclo de pacote (webhook).

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

const bookingService = new BookingService();
const paymentService = new PaymentService();
const presentialPackageService = new PresentialPackageService();

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const bookingIds: string[] = [];
const packageIds: string[] = [];
const offerIds: string[] = [];

describe("Frente 12, Lote 2 — captura de pagamento: margem de timeout e concorrência", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `F12L2_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Doze Lote Dois",
        email: `${uid("f12l2_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        emailVerifiedAt: new Date()
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Doze Lote Dois",
        email: `${uid("f12l2_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Doze Lote Dois",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "999888777",
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
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED" } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.clientAnamnesis.deleteMany({ where: { clientId } });
    await prisma.disputeCase.deleteMany({ where: { clientId } });
    await prisma.payment.deleteMany({ where: { booking: { id: { in: bookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.presentialPackageCycle.deleteMany({ where: { packageId: { in: packageIds } } });
    await prisma.presentialPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.availability.deleteMany({ where: { providerId } });
    await prisma.providerCategory.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  async function createBookingReadyToConfirm(daysFromNow: number) {
    const scheduledAt = new Date();
    scheduledAt.setDate(scheduledAt.getDate() - daysFromNow);
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
    await prisma.payment.update({
      where: { bookingId: booking.id },
      data: { status: PaymentStatus.AUTHORIZED, mpPaymentId: `mp_${uid("pay")}` }
    });

    return booking;
  }

  it(
    "captura de pagamento lenta (perto do timeout antigo de 15s) ainda conclui a sessão numa única tentativa",
    async () => {
      vi.spyOn(Payment.prototype, "capture").mockImplementationOnce(async () => {
        // Mais que os 15s antigos (timeout do cliente MP == timeout da
        // transação antes deste lote), mas dentro da margem nova - antes
        // disso quebrava com "Transaction already closed" e exigia uma 2ª
        // tentativa manual do usuário.
        await sleep(16000);
        return { status: "approved", status_detail: "accredited" } as any;
      });

      const booking = await createBookingReadyToConfirm(5);

      await bookingService.updateStatus(clientId, booking.id, BookingStatus.COMPLETED, completionProof);
      const result = await bookingService.updateStatus(
        providerUserId,
        booking.id,
        BookingStatus.COMPLETED,
        completionProof
      );

      expect(result.status).toBe(BookingStatus.COMPLETED);

      const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
      expect(payment.status).toBe(PaymentStatus.CAPTURED);
    },
    45000
  );

  it("duas capturas concorrentes do mesmo pagamento (corrida job vs. confirmação manual) notificam só uma vez", async () => {
    vi.spyOn(Payment.prototype, "capture").mockResolvedValue({ status: "approved", status_detail: "accredited" } as any);
    const sendSpy = vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);

    const booking = await createBookingReadyToConfirm(6);

    await Promise.all([
      paymentService.capturePaymentForBooking(booking.id),
      paymentService.capturePaymentForBooking(booking.id)
    ]);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(payment.status).toBe(PaymentStatus.CAPTURED);

    const capturedCalls = sendSpy.mock.calls.filter(
      ([, input]) => (input as any)?.data?.type === "PAYMENT_CAPTURED"
    );
    expect(capturedCalls.length).toBe(1);
  });

  async function createPackageWithPendingPixCycle(mpPaymentId: string) {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "PRESENTIAL",
        title: `Presencial ${uid("offer")}`,
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 20000,
        presentialPackageMode: PresentialPackageMode.FIXED_RECURRING,
        presentialSessionsPerCycle: 4
      }
    });
    offerIds.push(offer.id);

    const pkg = await prisma.presentialPackage.create({
      data: {
        providerId,
        clientId,
        offerId: offer.id,
        categoryId,
        mode: PresentialPackageMode.FIXED_RECURRING,
        status: PresentialPackageStatus.PENDING_PAYMENT,
        cycleAmountCents: 20000,
        billingCycle: OfferBillingCycle.MONTHLY,
        sessionsPerCycle: 4,
        nextCycleIndex: 1,
        nextBillingAt: new Date(),
        pendingChargeMpPaymentId: mpPaymentId
      }
    });
    packageIds.push(pkg.id);
    return pkg;
  }

  it("duas confirmações concorrentes do mesmo webhook Pix de ciclo ativam o ciclo só uma vez", async () => {
    const mpPaymentId = `mp_${uid("pixcycle")}`;
    await createPackageWithPendingPixCycle(mpPaymentId);

    const [first, second] = await Promise.all([
      presentialPackageService.confirmPendingPixCycle(mpPaymentId),
      presentialPackageService.confirmPendingPixCycle(mpPaymentId)
    ]);

    // Exatamente uma das duas chamadas concorrentes deve ter ativado o
    // ciclo (a outra lê o pendingChargeMpPaymentId já limpo, sob o lock, e
    // desiste cedo sem tentar de novo).
    expect([first, second].filter(Boolean).length).toBe(1);

    const cycles = await prisma.presentialPackageCycle.findMany({ where: { mpPaymentId } });
    expect(cycles.length).toBe(1);
  });
});
