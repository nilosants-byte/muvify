import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// @sentry/node é ESM com exports não-configuráveis - vi.spyOn direto no
// namespace do módulo falha ("Cannot redefine property"). vi.mock
// substitui o módulo inteiro antes da resolução dos imports; vi.hoisted
// garante que o mock exista antes do factory (hoisted) rodar. Mesmo padrão
// já usado em tests/frente9-lote12-email-failure-alerting.test.ts.
const { captureExceptionMock, captureMessageMock } = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  captureMessageMock: vi.fn()
}));
vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
  captureMessage: captureMessageMock,
  setUser: vi.fn(),
  setTag: vi.fn()
}));

import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { PaymentService } from "../src/modules/payments/services/payment.service";
import { BookingService } from "../src/modules/bookings/services/booking.service";
import { AuthService } from "../src/modules/auth/services/auth.service";
import { EmailService } from "../src/shared/services/email.service";
import { EmailQueueService } from "../src/shared/services/email-queue.service";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Frente 13 (segunda camada), Lote 4: 5 pontos financeiros/compliance que
// só logavam no console em caso de falha, sem nenhum sinal no Sentry —
// achados G2/G3/G4 da investigação de observabilidade backend, mais o
// subconjunto de M8 que envolve dinheiro (cancelar cobrança/restaurar
// crédito no auto-expire de agendamento) e M7 (e-mail de recuperação de
// senha).

const paymentService = new PaymentService();
const bookingService = new BookingService();
const authService = new AuthService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const bookingIds: string[] = [];

describe("Frente 13, Lote 4 — Sentry nos pontos financeiros críticos sem captura", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `F13L4_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Frente Treze Lote Quatro Cliente",
        email: `${uid("f13l4_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        emailVerifiedAt: new Date()
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Frente Treze Lote Quatro Profissional",
        email: `${uid("f13l4_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Frente Treze Lote Quatro Profissional",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    captureExceptionMock.mockClear();
    captureMessageMock.mockClear();
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { booking: { id: { in: bookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  async function createBookingWithPayment(overrides: {
    bookingStatus?: "PENDING" | "CONFIRMED";
    paymentStatus?: "PENDING_AUTH" | "FAILED" | "AUTHORIZED";
    paymentMethod?: "CREDIT_CARD";
    scheduledAt?: Date;
    confirmationDeadlineAt?: Date | null;
    clientConfirmedAt?: Date | null;
    providerConfirmedAt?: Date | null;
  }) {
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: overrides.scheduledAt ?? new Date(Date.now() + 40 * 60 * 1000),
        priceCents: 10000,
        status: overrides.bookingStatus ?? "PENDING",
        confirmationDeadlineAt: overrides.confirmationDeadlineAt,
        clientConfirmedAt: overrides.clientConfirmedAt ?? null,
        providerConfirmedAt: overrides.providerConfirmedAt ?? null
      }
    });
    bookingIds.push(booking.id);
    await prisma.payment.create({
      data: {
        bookingId: booking.id,
        amountCents: 10000,
        method: overrides.paymentMethod ?? "CREDIT_CARD",
        status: overrides.paymentStatus ?? "PENDING_AUTH"
      }
    });
    return booking;
  }

  it("G2 — refreshProviderMpTokens: status HTTP inesperado (não 400/401) chama Sentry.captureMessage", async () => {
    await prisma.providerProfile.update({
      where: { id: providerId },
      data: {
        mpAccountId: "111222333",
        mpRefreshToken: encryptSensitiveText("refresh_qualquer"),
        mpTokenExpiresAt: new Date(Date.now() + 1000)
      }
    });

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({})
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await paymentService.refreshProviderMpTokens();

    expect(captureMessageMock).toHaveBeenCalledWith(
      expect.stringContaining("HTTP 503"),
      "error"
    );

    await prisma.providerProfile.update({
      where: { id: providerId },
      data: { mpAccountId: null, mpRefreshToken: null, mpTokenExpiresAt: null }
    });
  });

  it("G2 — refreshProviderMpTokens: exceção de rede chama Sentry.captureException", async () => {
    await prisma.providerProfile.update({
      where: { id: providerId },
      data: {
        mpAccountId: "111222333",
        mpRefreshToken: encryptSensitiveText("refresh_qualquer"),
        mpTokenExpiresAt: new Date(Date.now() + 1000)
      }
    });

    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("timeout de rede"));

    await paymentService.refreshProviderMpTokens();

    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: "timeout de rede" }),
      expect.objectContaining({ tags: expect.objectContaining({ area: "mp-token-refresh" }) })
    );

    await prisma.providerProfile.update({
      where: { id: providerId },
      data: { mpAccountId: null, mpRefreshToken: null, mpTokenExpiresAt: null }
    });
  });

  it("G3 — authorizeDuePayments: falha ao autorizar chama Sentry.captureException", async () => {
    const preAuthWindowMs = env.PRE_AUTH_WINDOW_MINUTES * 60 * 1000;
    const booking = await createBookingWithPayment({
      bookingStatus: "PENDING",
      paymentStatus: "PENDING_AUTH",
      scheduledAt: new Date(Date.now() + preAuthWindowMs / 2)
    });

    vi.spyOn(PaymentService.prototype, "authorizePayment").mockRejectedValueOnce(
      new Error("falha ao autorizar")
    );

    await paymentService.authorizeDuePayments();

    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: "falha ao autorizar" }),
      expect.objectContaining({
        tags: expect.objectContaining({ area: "payment-authorize-due" }),
        extra: expect.objectContaining({ paymentId: expect.any(String) })
      })
    );
    void booking;
  });

  it("G4 — autoCaptureSingleConfirmation: falha ao capturar chama Sentry.captureException", async () => {
    const booking = await createBookingWithPayment({
      bookingStatus: "CONFIRMED",
      paymentStatus: "AUTHORIZED",
      scheduledAt: new Date(Date.now() - (env.AUTO_CAPTURE_CONFIRMATION_HOURS + 1) * 60 * 60 * 1000),
      clientConfirmedAt: new Date(),
      providerConfirmedAt: null
    });

    vi.spyOn(PaymentService.prototype, "capturePaymentForBooking").mockRejectedValueOnce(
      new Error("falha ao capturar")
    );

    await paymentService.autoCaptureSingleConfirmation();

    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: "falha ao capturar" }),
      expect.objectContaining({
        tags: expect.objectContaining({ area: "payment-auto-capture" }),
        extra: expect.objectContaining({ bookingId: booking.id })
      })
    );
  });

  it("M8 (booking auto-expire) — falha ao cancelar pagamento/restaurar crédito chama Sentry.captureException", async () => {
    const booking = await createBookingWithPayment({
      bookingStatus: "PENDING",
      paymentStatus: "PENDING_AUTH",
      scheduledAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
      confirmationDeadlineAt: new Date(Date.now() - 60 * 1000)
    });

    vi.spyOn(PaymentService.prototype, "cancelPaymentForBooking").mockRejectedValueOnce(
      new Error("falha ao cancelar pagamento")
    );

    await bookingService.autoExpireStaleBookings();

    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: "falha ao cancelar pagamento" }),
      expect.objectContaining({
        tags: expect.objectContaining({ area: "booking-auto-expire-cancel-payment" }),
        extra: expect.objectContaining({ bookingId: booking.id })
      })
    );

    const afterDb = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(afterDb.status).toBe("CANCELLED");
  });

  it("M7 — forgotPassword: falha ao enfileirar e-mail chama Sentry.captureException (sem expor ao chamador)", async () => {
    vi.spyOn(EmailService.prototype, "canSendEmail").mockReturnValue(true);
    vi.spyOn(EmailQueueService.prototype, "enqueuePasswordReset").mockRejectedValueOnce(
      new Error("smtp indisponível")
    );

    const client = await prisma.user.create({
      data: {
        name: "Frente Treze Lote Quatro Esqueci Senha",
        email: `${uid("f13l4_forgot")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}3`,
        role: "CLIENT",
        emailVerifiedAt: new Date()
      }
    });

    const response = await authService.forgotPassword({ email: client.email, channel: "EMAIL" });
    expect(response.message).toBeTruthy();

    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: "smtp indisponível" }),
      expect.objectContaining({
        tags: expect.objectContaining({ area: "auth-forgot-password-email" }),
        extra: expect.objectContaining({ userId: client.id })
      })
    );

    await prisma.passwordResetToken.deleteMany({ where: { userId: client.id } });
    await prisma.user.deleteMany({ where: { id: client.id } });
  });
});
