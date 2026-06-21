import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { BookingStatus, CrefValidationStatus, PaymentMethod, PaymentStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env";
import { prisma } from "../../../config/prisma";
import { redis } from "../../../config/redis";
import { AppError } from "../../../shared/errors/app-error";
import { deleteByPattern } from "../../../shared/utils/cache";
import { encryptSensitiveText } from "../../../shared/utils/encryption";
import { toProviderPhotoUrl, toUserPhotoUrl } from "../../../shared/utils/photo-url";
import { NotificationService } from "../../notifications/services/notification.service";
import { PaymentService } from "../../payments/services/payment.service";
import { EmailService } from "../../../shared/services/email.service";

const emailService = new EmailService();

type CompletionProofInput = {
  imageBase64: string;
  mimeType: "image/jpeg" | "image/jpg" | "image/png" | "image/webp";
  cameraFacing: "FRONT" | "BACK";
};

const allowedProofMimeTypes = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp"
]);

function checkImageMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 4) return false;
  switch (mimeType) {
    case "image/jpeg":
    case "image/jpg":
      return buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
    case "image/png":
      return buffer[0] === 0x89 && buffer[1] === 0x50 &&
             buffer[2] === 0x4E && buffer[3] === 0x47;
    case "image/webp":
      return buffer.length >= 12 &&
             buffer[0] === 0x52 && buffer[1] === 0x49 &&
             buffer[2] === 0x46 && buffer[3] === 0x46 &&
             buffer[8] === 0x57 && buffer[9] === 0x45 &&
             buffer[10] === 0x42 && buffer[11] === 0x50;
    default:
      return false;
  }
}

function toTime(date: Date) {
  return date.toISOString().slice(11, 16);
}

function toZonedDate(date: Date, timeZone: string) {
  return new Date(date.toLocaleString("en-US", { timeZone }));
}

function toTimeInTimezone(date: Date, timeZone: string) {
  const zonedDate = toZonedDate(date, timeZone);
  const hours = String(zonedDate.getHours()).padStart(2, "0");
  const minutes = String(zonedDate.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function toDateKeyInTimezone(date: Date, timeZone: string) {
  const zonedDate = toZonedDate(date, timeZone);
  const year = zonedDate.getFullYear();
  const month = String(zonedDate.getMonth() + 1).padStart(2, "0");
  const day = String(zonedDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toWeekdayInTimezone(date: Date, timeZone: string) {
  return toZonedDate(date, timeZone).getDay();
}

function formatPtBrDate(date: Date) {
  return date.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function normalizeLoose(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const paymentService = new PaymentService();
const notificationService = new NotificationService();

const attendanceCodeReleaseMs = env.BOOKING_ATTENDANCE_CODE_RELEASE_MINUTES * 60 * 1000;
const attendanceQrTokenPrefix = "muvify-attendance";
const attendanceQrTokenVersion = "v1";

function generateAttendanceCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

type AttendanceQrPayload = {
  bookingId: string;
  code: string;
  exp: number;
};

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

export class BookingService {
  async create(
    clientId: string,
    providerId: string,
    categoryId: string,
    scheduledAt: string,
    offerId?: string,
    paymentMethod: PaymentMethod = PaymentMethod.CREDIT_CARD,
    notes?: string,
    sessionLocation?: string
  ) {
    const scheduleDate = new Date(scheduledAt);
    if (Number.isNaN(scheduleDate.getTime()) || scheduleDate <= new Date()) {
      throw new AppError("Data de agendamento inválida.");
    }

    // Pre-compute timezone-dependent values outside the transaction to
    // minimize the time spent holding the advisory lock.
    const scheduleWeekday = toWeekdayInTimezone(scheduleDate, env.APP_TIMEZONE);
    const scheduleTime = toTimeInTimezone(scheduleDate, env.APP_TIMEZONE);
    const scheduleDateKey = toDateKeyInTimezone(scheduleDate, env.APP_TIMEZONE);

    scheduleDate.setMilliseconds(0); // normaliza ms para garantir lock idêntico para o mesmo horário
    const lockKey = `${providerId}:${scheduleDate.toISOString()}`;

    const createdBooking = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      const provider = await tx.providerProfile.findUnique({
        where: { id: providerId },
        include: {
          availabilities: {
            where: {
              weekday: scheduleWeekday,
              isActive: true
            }
          },
          categoryLinks: true
        }
      });

      if (!provider) {
        throw new AppError("Prestador não encontrado.", StatusCodes.NOT_FOUND);
      }

      if (provider.crefValidationStatus !== CrefValidationStatus.APPROVED) {
        throw new AppError(
          "Este profissional ainda não está habilitado para novos agendamentos.",
          StatusCodes.BAD_REQUEST
        );
      }

      const hasLinkedCategory = provider.categoryLinks.some((item) => item.categoryId === categoryId);
      if (!hasLinkedCategory) {
        if (provider.categoryLinks.length > 0) {
          throw new AppError("Categoria não atendida por este profissional.");
        }

        const category = await tx.serviceCategory.findUnique({
          where: { id: categoryId },
          select: { id: true, name: true }
        });
        if (!category) {
          throw new AppError("Categoria inválida.", StatusCodes.BAD_REQUEST);
        }

        const providerSpecialties = Array.isArray(provider.specialties)
          ? provider.specialties
              .filter((specialty): specialty is string => typeof specialty === "string")
              .map((specialty) => specialty.trim())
              .filter((specialty) => specialty.length > 0)
          : [];

        if (providerSpecialties.length > 0) {
          const normalizedCategory = normalizeLoose(category.name);
          const specialtyMatchesCategory = providerSpecialties.some((specialty) => {
            const normalizedSpecialty = normalizeLoose(specialty);
            return (
              normalizedSpecialty === normalizedCategory ||
              normalizedSpecialty.includes(normalizedCategory) ||
              normalizedCategory.includes(normalizedSpecialty)
            );
          });
          if (!specialtyMatchesCategory) {
            throw new AppError("Categoria não atendida por este profissional.");
          }
        }
      }

      const available = provider.availabilities.some(
        (item) => scheduleTime >= item.startTime && scheduleTime < item.endTime
      );
      if (!available) {
        throw new AppError("Horário fora da disponibilidade informada.");
      }

      const conflict = await tx.booking.findFirst({
        where: {
          providerId,
          scheduledAt: scheduleDate,
          status: {
            in: [BookingStatus.PENDING, BookingStatus.CONFIRMED]
          }
        }
      });
      if (conflict) {
        throw new AppError("Já existe agendamento para este horário.", StatusCodes.CONFLICT);
      }

      const manualBlocks = await tx.providerManualBlock.findMany({
        where: { providerId, date: scheduleDateKey },
        select: { startTime: true, endTime: true },
      });
      const blockedByManual = manualBlocks.some(
        (block) => scheduleTime >= block.startTime && scheduleTime < block.endTime
      );
      if (blockedByManual) {
        throw new AppError(
          "Este horário está bloqueado pelo profissional.",
          StatusCodes.CONFLICT
        );
      }

      let bookingPriceCents = provider.priceCents;

      if (offerId) {
        const offer = await tx.providerServiceOffer.findFirst({
          where: {
            id: offerId,
            providerId,
            isActive: true
          }
        });

        if (!offer) {
          throw new AppError("Oferta selecionada não está disponível para este profissional.");
        }

        const now = new Date();
        const promotionActive =
          offer.isPromotion &&
          typeof offer.promotionPriceCents === "number" &&
          offer.promotionPriceCents > 0 &&
          offer.promotionPriceCents < offer.priceCents &&
          Boolean(offer.promotionEndsAt) &&
          offer.promotionEndsAt! > now;

        bookingPriceCents = promotionActive
          ? offer.promotionPriceCents!
          : offer.priceCents;
      }

      const booking = await tx.booking.create({
        data: {
          clientId,
          providerId,
          categoryId,
          scheduledAt: scheduleDate,
          priceCents: bookingPriceCents,
          notes,
          sessionLocation: sessionLocation ?? null
        },
        include: {
          category: true,
          client: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          provider: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phone: true
                }
              }
            }
          }
        }
      });

      await paymentService.createPendingForBooking(
        tx,
        booking.id,
        booking.priceCents,
        booking.currency,
        paymentMethod
      );
      return booking;
    });

    void deleteByPattern(`schedule:${createdBooking.providerId}:*`).catch(() => undefined);

    // Emails de confirmação — fire-and-forget, não bloqueiam a resposta
    if (emailService.canSendEmail()) {
      const sharedInput = {
        scheduledAt: createdBooking.scheduledAt,
        categoryName: createdBooking.category.name,
        priceCents: createdBooking.priceCents,
      };
      void emailService.sendBookingConfirmationToClient({
        ...sharedInput,
        to: createdBooking.client.email,
        clientName: createdBooking.client.name,
        providerName: createdBooking.provider.displayName,
      }).catch(() => undefined);
      void emailService.sendBookingConfirmationToProvider({
        ...sharedInput,
        to: createdBooking.provider.user.email,
        providerName: createdBooking.provider.displayName,
        clientName: createdBooking.client.name,
      }).catch(() => undefined);
    }

    // Create welcome system message in the booking chat
    void prisma.bookingMessage.create({
      data: {
        bookingId: createdBooking.id,
        isSystem: true,
        content: `🎉 Agendamento solicitado com ${createdBooking.provider.displayName} para ${formatPtBrDate(createdBooking.scheduledAt)}! Use este chat para tirar dúvidas, combinar detalhes ou se apresentar ao seu personal.`,
      },
    }).catch(() => undefined);

    // Lookup client anamnesis status to enrich provider notification
    void (async () => {
      const clientAnamnesis = await prisma.clientAnamnesis.findUnique({
        where: { clientId: createdBooking.clientId },
        select: { status: true },
      }).catch(() => null);

      const anamnesisStatus = clientAnamnesis?.status ?? "NONE";
      const hasAnamnesis = anamnesisStatus === "COMPLETED";
      const hasDraftAnamnesis = anamnesisStatus === "DRAFT";

      // Notification for client — friendly, invites them to chat
      void notificationService
        .sendToUsers([createdBooking.clientId], {
        preferenceType: "BOOKINGS",
          title: "✅ Agendamento solicitado!",
          body: `Seu pedido para ${createdBooking.provider.displayName} em ${formatPtBrDate(createdBooking.scheduledAt)} foi enviado. Que tal se apresentar e tirar dúvidas no chat? 💬`,
          data: {
            type: "BOOKING_CREATED",
            bookingId: createdBooking.id,
            role: "client",
            openChat: "true",
          },
        })
        .catch((error) => {
          console.error("Booking push notification failed:", error);
        });

      // Notification for provider — differentiated, includes student info
      const providerBody = hasAnamnesis
        ? `${createdBooking.client.name} agendou para ${formatPtBrDate(createdBooking.scheduledAt)}. A ficha de anamnese está preenchida — confira para se preparar! 📋`
        : hasDraftAnamnesis
          ? `${createdBooking.client.name} agendou para ${formatPtBrDate(createdBooking.scheduledAt)}. Anamnese incompleta — solicite via chat para se preparar melhor. 📋`
          : `${createdBooking.client.name} agendou para ${formatPtBrDate(createdBooking.scheduledAt)}. Sem anamnese ainda — peça ao aluno pelo chat! 📋`;

      void notificationService
        .sendToUsers([createdBooking.provider.userId], {
        preferenceType: "BOOKINGS",
          title: "📅 Novo agendamento recebido!",
          body: providerBody,
          data: {
            type: "BOOKING_CREATED",
            bookingId: createdBooking.id,
            role: "provider",
            clientId: createdBooking.clientId,
            clientName: createdBooking.client.name,
            anamnesisStatus,
            openChat: "true",
          },
        })
        .catch((error) => {
          console.error("Booking push notification failed:", error);
        });
    })();

    return createdBooking;
  }

  async listMyBookings(userId: string, skip = 0, take = 50) {
    take = Math.max(1, Math.min(take, 200));
    const bookings = await prisma.booking.findMany({
      where: {
        OR: [
          { clientId: userId },
          {
            provider: {
              userId
            }
          }
        ]
      },
      skip,
      take,
      include: {
        category: { select: { id: true, name: true } },
        client: {
          select: {
            id: true,
            name: true,
            email: true,
            photoUrl: true,
            updatedAt: true
          }
        },
        provider: {
          select: {
            id: true,
            displayName: true,
            photoUrl: true,
            updatedAt: true,
            user: {
              select: {
                id: true,
                name: true,
                phone: true,
              }
            }
          }
        }
      },
      orderBy: { scheduledAt: "asc" }
    });

    return bookings.map(
      ({
        attendanceCode,
        attendanceCodeGeneratedAt,
        attendanceCodeExpiresAt,
        ...booking
      }) => ({
        ...booking,
        client: booking.client
          ? {
              ...booking.client,
              photoUrl: toUserPhotoUrl(
                booking.client.id,
                booking.client.photoUrl ?? null,
                booking.client.updatedAt
              ),
            }
          : undefined,
        provider: booking.provider
          ? {
              ...booking.provider,
              photoUrl: toProviderPhotoUrl(
                booking.provider.id,
                booking.provider.photoUrl ?? null,
                booking.provider.updatedAt
              ),
            }
          : undefined,
      })
    );
  }

  async releaseDueAttendanceCodes(referenceDate = new Date()) {
    const upper = new Date(referenceDate.getTime() + attendanceCodeReleaseMs);

    const dueBookings = await prisma.booking.findMany({
      where: {
        status: {
          in: [BookingStatus.PENDING, BookingStatus.CONFIRMED]
        },
        attendanceCode: null,
        scheduledAt: {
          gt: referenceDate,
          lte: upper
        }
      },
      include: {
        client: {
          select: {
            id: true
          }
        }
      }
    });

    const now = new Date();
    await Promise.all(
      dueBookings.map(async (booking) => {
        const code = generateAttendanceCode();
        const expiresAt = new Date(
          booking.scheduledAt.getTime() + env.BOOKING_ATTENDANCE_CODE_EXPIRY_HOURS * 60 * 60 * 1000
        );

        const updatedCount = await prisma.booking.updateMany({
          where: {
            id: booking.id,
            attendanceCode: null
          },
          data: {
            attendanceCode: code,
            attendanceCodeGeneratedAt: now,
            attendanceCodeExpiresAt: expiresAt
          }
        });

        if (updatedCount.count > 0) {
          void notificationService
            .sendToUsers([booking.client.id], {
        preferenceType: "BOOKINGS",
              title: "Código de presença disponivel",
              body: "Seu código de 6 dígitos para validação presencial já esta disponivel no agendamento.",
              data: {
                type: "BOOKING_ATTENDANCE_CODE_AVAILABLE",
                bookingId: booking.id
              }
            })
            .catch((error) => {
              console.error("Booking push notification failed:", error);
            });
        }
      })
    );
  }

  async sendSessionReminders(referenceDate = new Date()) {
    const oneHourMs = 60 * 60 * 1000;
    const thirtyMinMs = 30 * 60 * 1000;
    const windowMs = 5 * 60 * 1000;

    const hour1Lower = new Date(referenceDate.getTime() + oneHourMs - windowMs);
    const hour1Upper = new Date(referenceDate.getTime() + oneHourMs + windowMs);

    const due60 = await prisma.booking.findMany({
      where: {
        status: BookingStatus.CONFIRMED,
        reminder60SentAt: null,
        scheduledAt: { gte: hour1Lower, lte: hour1Upper },
      },
      select: { id: true, clientId: true, provider: { select: { userId: true } } },
    });

    for (const booking of due60) {
      const upd60 = await prisma.booking.updateMany({
        where: { id: booking.id, reminder60SentAt: null },
        data: { reminder60SentAt: referenceDate },
      });
      if (upd60.count > 0) {
        void notificationService
          .sendToUsers([booking.clientId, booking.provider.userId], {
            preferenceType: "BOOKINGS",
            title: "Sessão em 1 hora",
            body: "Você tem uma sessão confirmada em 1 hora.",
            data: { type: "SESSION_REMINDER", bookingId: booking.id },
          })
          .catch((e) => console.error("Session reminder 60 failed:", e));
      }
    }

    const min30Lower = new Date(referenceDate.getTime() + thirtyMinMs - windowMs);
    const min30Upper = new Date(referenceDate.getTime() + thirtyMinMs + windowMs);

    const due30 = await prisma.booking.findMany({
      where: {
        status: BookingStatus.CONFIRMED,
        reminder30SentAt: null,
        scheduledAt: { gte: min30Lower, lte: min30Upper },
      },
      select: { id: true, clientId: true, provider: { select: { userId: true } } },
    });

    for (const booking of due30) {
      const upd30 = await prisma.booking.updateMany({
        where: { id: booking.id, reminder30SentAt: null },
        data: { reminder30SentAt: referenceDate },
      });
      if (upd30.count > 0) {
        void notificationService
          .sendToUsers([booking.clientId, booking.provider.userId], {
            preferenceType: "BOOKINGS",
            title: "Sessão em 30 minutos",
            body: "Sua sessão começa em 30 minutos. Prepare-se!",
            data: { type: "SESSION_REMINDER", bookingId: booking.id },
          })
          .catch((e) => console.error("Session reminder 30 failed:", e));
      }
    }
  }

  async autoExpireStaleBookings(referenceDate = new Date()) {
    // Cancel PENDING bookings whose scheduledAt has already passed
    const expiredPending = await prisma.booking.findMany({
      where: {
        status: BookingStatus.PENDING,
        scheduledAt: { lt: referenceDate }
      },
      select: {
        id: true,
        clientId: true,
        provider: { select: { userId: true } }
      }
    });

    const PENDING_CONCURRENCY = 5;
    for (let i = 0; i < expiredPending.length; i += PENDING_CONCURRENCY) {
      await Promise.allSettled(
        expiredPending.slice(i, i + PENDING_CONCURRENCY).map(async (booking) => {
          const updatedPending = await prisma.booking.updateMany({
            where: { id: booking.id, status: BookingStatus.PENDING },
            data: { status: BookingStatus.CANCELLED }
          });
          if (updatedPending.count === 0) return;
          await paymentService.cancelPaymentForBooking(booking.id).catch((err) => {
            console.error("autoExpire pending: cancel payment failed for booking", booking.id, err);
          });
          void notificationService
            .sendToUsers([booking.clientId, booking.provider.userId], {
              preferenceType: "BOOKINGS",
              title: "Agendamento cancelado automaticamente",
              body: "Um agendamento pendente não foi confirmado a tempo e foi cancelado.",
              data: { type: "BOOKING_EXPIRED", bookingId: booking.id }
            })
            .catch((error) => console.error("Booking expiry notification failed:", error));
        })
      );
    }

    // Cancel CONFIRMED bookings that are more than 48h past scheduledAt and never completed
    const staleConfirmedCutoff = new Date(
      referenceDate.getTime() - 48 * 60 * 60 * 1000
    );
    const expiredConfirmed = await prisma.booking.findMany({
      where: {
        status: BookingStatus.CONFIRMED,
        scheduledAt: { lt: staleConfirmedCutoff }
      },
      select: {
        id: true,
        clientId: true,
        provider: { select: { userId: true } }
      }
    });

    const CONCURRENCY = 5;
    for (let i = 0; i < expiredConfirmed.length; i += CONCURRENCY) {
      await Promise.allSettled(
        expiredConfirmed.slice(i, i + CONCURRENCY).map(async (booking) => {
          const updated = await prisma.booking.updateMany({
            where: { id: booking.id, status: BookingStatus.CONFIRMED },
            data: { status: BookingStatus.CANCELLED }
          });
          if (updated.count === 0) return;
          await paymentService.cancelPaymentForBooking(booking.id).catch((err) => {
            console.error("autoExpire: cancel payment failed for booking", booking.id, err);
          });
          void notificationService
            .sendToUsers([booking.clientId, booking.provider.userId], {
              preferenceType: "BOOKINGS",
              title: "Agendamento expirado",
              body: "Um agendamento confirmado não foi concluído e foi encerrado automaticamente.",
              data: { type: "BOOKING_EXPIRED", bookingId: booking.id }
            })
            .catch((error) => console.error("Booking expiry notification failed:", error));
        })
      );
    }
  }

  async getAttendanceCode(userId: string, bookingId: string) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        provider: {
          select: {
            userId: true
          }
        }
      }
    });

    if (!booking) {
      throw new AppError("Agendamento não encontrado.", StatusCodes.NOT_FOUND);
    }

    if (booking.clientId !== userId) {
      throw new AppError(
        "Somente o aluno pode visualizar o código de presença.",
        StatusCodes.FORBIDDEN
      );
    }

    if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.COMPLETED) {
      throw new AppError(
        "Agendamento encerrado não possui código de presença ativo.",
        StatusCodes.BAD_REQUEST
      );
    }

    const now = new Date();
    const releaseAt = new Date(booking.scheduledAt.getTime() - attendanceCodeReleaseMs);

    if (now < releaseAt && !booking.attendanceCode) {
      return {
        bookingId: booking.id,
        available: false,
        releaseAt: releaseAt.toISOString(),
        validated: false,
        qrToken: null,
        qrDeepLink: null
      };
    }

    let refreshedBooking = booking;
    const isExpired =
      Boolean(booking.attendanceCodeExpiresAt) && booking.attendanceCodeExpiresAt! < now;
    if (!booking.attendanceCode || isExpired) {
      const code = generateAttendanceCode();
      const expiresAt = new Date(
        booking.scheduledAt.getTime() +
          env.BOOKING_ATTENDANCE_CODE_EXPIRY_HOURS * 60 * 60 * 1000
      );

      refreshedBooking = await prisma.booking.update({
        where: { id: booking.id },
        data: {
          attendanceCode: code,
          attendanceCodeGeneratedAt: now,
          attendanceCodeExpiresAt: expiresAt,
          attendanceCodeValidatedAt: null
        },
        include: {
          provider: {
            select: {
              userId: true
            }
          }
        }
      });
    }

    const qrToken = this.buildAttendanceQrToken(
      refreshedBooking.id,
      refreshedBooking.attendanceCode!,
      refreshedBooking.attendanceCodeExpiresAt
    );

    return {
      bookingId: refreshedBooking.id,
      available: true,
      code: refreshedBooking.attendanceCode,
      generatedAt: refreshedBooking.attendanceCodeGeneratedAt?.toISOString() ?? null,
      expiresAt: refreshedBooking.attendanceCodeExpiresAt?.toISOString() ?? null,
      validated: Boolean(refreshedBooking.attendanceCodeValidatedAt),
      validatedAt: refreshedBooking.attendanceCodeValidatedAt?.toISOString() ?? null,
      qrToken,
      qrDeepLink: `muvify://attendance/verify?bookingId=${refreshedBooking.id}&token=${encodeURIComponent(qrToken)}`
    };
  }

  async verifyAttendanceCode(userId: string, bookingId: string, code: string) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        provider: {
          select: {
            userId: true
          }
        }
      }
    });

    if (!booking) {
      throw new AppError("Agendamento não encontrado.", StatusCodes.NOT_FOUND);
    }

    if (booking.provider.userId !== userId) {
      throw new AppError(
        "Somente o profissional pode validar o código de presença.",
        StatusCodes.FORBIDDEN
      );
    }

    const ATTENDANCE_MAX_ATTEMPTS = 10;
    const ATTENDANCE_WINDOW_SECONDS = 15 * 60;
    const attemptKey = `attendance:attempts:${bookingId}`;
    if (redis.status === "ready") {
      const attempts = await redis.incr(attemptKey);
      if (attempts === 1) {
        await redis.expire(attemptKey, ATTENDANCE_WINDOW_SECONDS);
      }
      if (attempts > ATTENDANCE_MAX_ATTEMPTS) {
        throw new AppError(
          "Muitas tentativas de validação. Aguarde 15 minutos antes de tentar novamente.",
          StatusCodes.TOO_MANY_REQUESTS
        );
      }
    }

    if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.COMPLETED) {
      throw new AppError(
        "Agendamento encerrado não permite validação de código.",
        StatusCodes.BAD_REQUEST
      );
    }

    if (!booking.attendanceCode) {
      throw new AppError(
        "Código ainda não foi liberado para este agendamento.",
        StatusCodes.BAD_REQUEST
      );
    }

    const now = new Date();
    if (booking.attendanceCodeExpiresAt && booking.attendanceCodeExpiresAt < now) {
      throw new AppError(
        "Código expirado. Solicite novo código para o aluno.",
        StatusCodes.BAD_REQUEST
      );
    }

    if (booking.attendanceCode !== code.trim()) {
      throw new AppError("Código de presença inválido.", StatusCodes.BAD_REQUEST);
    }

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        attendanceCodeValidatedAt: now
      }
    });

    if (redis.status === "ready") {
      await redis.del(`attendance:attempts:${bookingId}`);
    }

    void notificationService
      .sendToUsers([booking.clientId, booking.provider.userId], {
        preferenceType: "BOOKINGS",
        title: "Código presencial validado",
        body: "Código de presença confirmado. Você já pode concluir com selfie ao final da aula.",
        data: {
          type: "BOOKING_ATTENDANCE_CODE_VALIDATED",
          bookingId: booking.id
        }
      })
      .catch((error) => {
        console.error("Booking push notification failed:", error);
      });

    return {
      bookingId: updated.id,
      validated: true,
      validatedAt: updated.attendanceCodeValidatedAt?.toISOString() ?? null
    };
  }

  async verifyAttendanceQr(userId: string, bookingId: string, qrToken: string) {
    const payload = this.parseAttendanceQrToken(qrToken);
    if (payload.bookingId !== bookingId) {
      throw new AppError(
        "QR Code não pertence a este agendamento.",
        StatusCodes.BAD_REQUEST
      );
    }

    return this.verifyAttendanceCode(userId, bookingId, payload.code);
  }

  async updateStatus(
    userId: string,
    bookingId: string,
    status: BookingStatus,
    completionProof?: CompletionProofInput
  ) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { provider: true }
    });

    if (!booking) {
      throw new AppError("Agendamento não encontrado.", StatusCodes.NOT_FOUND);
    }

    const canManage = booking.clientId === userId || booking.provider.userId === userId;
    if (!canManage) {
      throw new AppError("Sem permissao para alterar este agendamento.", StatusCodes.FORBIDDEN);
    }

    const allowedTransitions: Record<BookingStatus, BookingStatus[]> = {
      [BookingStatus.PENDING]: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
      [BookingStatus.CONFIRMED]: [BookingStatus.COMPLETED, BookingStatus.CANCELLED],
      [BookingStatus.CANCELLED]: [],
      [BookingStatus.COMPLETED]: []
    };

    if (!allowedTransitions[booking.status].includes(status)) {
      throw new AppError("Transição de status inválida.", StatusCodes.BAD_REQUEST);
    }

    if (status === BookingStatus.COMPLETED) {
      return this.confirmCompletion(userId, bookingId, completionProof);
    }

    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data: { status },
      include: {
        client: {
          select: {
            id: true,
            name: true
          }
        },
        provider: {
          select: {
            userId: true,
            displayName: true
          }
        }
      }
    });

    if (status === BookingStatus.CANCELLED) {
      await paymentService.cancelPaymentForBooking(bookingId);
    }

    await this.notifyBookingStatusChange(updated, status, userId);
    return updated;
  }

  private async confirmCompletion(
    userId: string,
    bookingId: string,
    completionProof?: CompletionProofInput
  ) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        provider: true,
        client: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    if (!booking) {
      throw new AppError("Agendamento não encontrado.", StatusCodes.NOT_FOUND);
    }

    const now = new Date();
    const isClient = booking.clientId === userId;
    const isProvider = booking.provider.userId === userId;
    if (!isClient && !isProvider) {
      throw new AppError("Sem permissao para confirmar este agendamento.", StatusCodes.FORBIDDEN);
    }

    if (!booking.attendanceCodeValidatedAt) {
      throw new AppError(
        "Código presencial ainda não foi validado pelo profissional. Valide o código de 6 dígitos antes de concluir.",
        StatusCodes.BAD_REQUEST
      );
    }

    const data: {
      clientConfirmedAt?: Date;
      providerConfirmedAt?: Date;
      status?: BookingStatus;
      completedAt?: Date;
    } = {};

    if (isClient && !booking.clientConfirmedAt) {
      data.clientConfirmedAt = now;
    }
    if (isProvider && !booking.providerConfirmedAt) {
      data.providerConfirmedAt = now;
    }

    const finalClientConfirmedAt = data.clientConfirmedAt ?? booking.clientConfirmedAt;
    const finalProviderConfirmedAt = data.providerConfirmedAt ?? booking.providerConfirmedAt;
    const bothConfirmed = Boolean(finalClientConfirmedAt && finalProviderConfirmedAt);
    if (bothConfirmed) {
      const payment = await prisma.payment.findUnique({
        where: { bookingId },
        select: { method: true, status: true }
      });

      if (payment?.method === PaymentMethod.PIX && payment.status !== PaymentStatus.CAPTURED) {
        throw new AppError(
          "Pagamento via PIX ainda não foi concluído. Finalize o pagamento para concluir o agendamento.",
          StatusCodes.BAD_REQUEST
        );
      }
    }

    if (bothConfirmed) {
      data.status = BookingStatus.COMPLETED;
      data.completedAt = now;
    }

    // Guard atômico ANTES de upsert — evita sobrescrever evidência em requests concorrentes.
    const confirmationField = isClient ? "clientConfirmedAt" : "providerConfirmedAt";
    const wasAlreadySet = booking[confirmationField] !== null;
    if (wasAlreadySet) {
      // Este request chegou após outro já ter confirmado — não há nada novo a fazer.
      return prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
        include: {
          client: { select: { id: true, name: true } },
          provider: { select: { userId: true, displayName: true } }
        }
      });
    }

    // Upsert da evidência apenas após passar o guard (evita sobrescrita desnecessária)
    const sanitizedProof = this.validateCompletionProof(completionProof);
    await this.upsertCompletionEvidence(bookingId, userId, sanitizedProof);

    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data,
      include: {
        client: {
          select: {
            id: true,
            name: true
          }
        },
        provider: {
          select: {
            userId: true,
            displayName: true
          }
        }
      }
    });

    if (bothConfirmed) {
      await paymentService.captureIfAuthorizedForBooking(bookingId);

      const {
        onWorkoutCompleted,
        onFirstBookingCompleted,
        onEvery10BookingsCompleted,
      } = await import("../../gamification/services/gamification-events.service");
      void onWorkoutCompleted(updated.clientId, bookingId, false);
      void onFirstBookingCompleted(updated.clientId);
      void onEvery10BookingsCompleted(updated.clientId);

      void notificationService
        .sendToUsers([updated.clientId, updated.provider.userId], {
        preferenceType: "BOOKINGS",
          title: "Serviço concluído",
          body: `Agendamento ${bookingId.slice(0, 8)} concluído com confirmacao das duas partes.`,
          data: {
            type: "BOOKING_COMPLETED",
            bookingId
          }
        })
        .catch((error) => {
          console.error("Booking push notification failed:", error);
        });
      return updated;
    }

    const counterpartUserId = isClient ? updated.provider.userId : updated.clientId;
    const actorLabel = isClient ? "Cliente" : "Profissional";
    void notificationService
      .sendToUsers([counterpartUserId], {
        preferenceType: "BOOKINGS",
        title: "Confirmacao pendente",
        body: `${actorLabel} confirmou a conclusao do agendamento ${bookingId.slice(0, 8)}.`,
        data: {
          type: "BOOKING_CONFIRMATION_PENDING",
          bookingId
        }
      })
      .catch((error) => {
        console.error("Booking push notification failed:", error);
      });

    return updated;
  }

  private validateCompletionProof(completionProof?: CompletionProofInput) {
    if (!completionProof) {
      throw new AppError(
        "Selfie de confirmacao obrigatória para concluir atendimento.",
        StatusCodes.BAD_REQUEST
      );
    }

    if (!allowedProofMimeTypes.has(completionProof.mimeType)) {
      throw new AppError("Formato da selfie não suportado.", StatusCodes.BAD_REQUEST);
    }

    const normalizedBase64 = completionProof.imageBase64
      .replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "")
      .replace(/\s+/g, "");

    if (!normalizedBase64 || !/^[A-Za-z0-9+/=]+$/.test(normalizedBase64)) {
      throw new AppError("Selfie em base64 inválida.", StatusCodes.BAD_REQUEST);
    }

    let decoded: Buffer;
    try {
      decoded = Buffer.from(normalizedBase64, "base64");
    } catch {
      throw new AppError("Não foi possível decodificar selfie enviada.", StatusCodes.BAD_REQUEST);
    }

    if (!decoded.length) {
      throw new AppError("Selfie vazia.", StatusCodes.BAD_REQUEST);
    }

    if (!checkImageMagicBytes(decoded, completionProof.mimeType)) {
      throw new AppError("Selfie com formato inválido.", StatusCodes.BAD_REQUEST);
    }

    const maxBytes = 2 * 1024 * 1024;
    if (decoded.byteLength > maxBytes) {
      throw new AppError(
        "Selfie acima do limite de 2MB. Reduza a qualidade e tente novamente.",
        StatusCodes.BAD_REQUEST
      );
    }

    return {
      imageBase64: normalizedBase64,
      mimeType: completionProof.mimeType,
      cameraFacing: completionProof.cameraFacing
    };
  }

  private async upsertCompletionEvidence(
    bookingId: string,
    userId: string,
    completionProof: CompletionProofInput
  ) {
    await prisma.completionEvidence.upsert({
      where: {
        bookingId_userId: {
          bookingId,
          userId
        }
      },
      update: {
        imageBase64: encryptSensitiveText(completionProof.imageBase64),
        mimeType: completionProof.mimeType,
        cameraFacing: completionProof.cameraFacing,
        capturedAt: new Date()
      },
      create: {
        bookingId,
        userId,
        imageBase64: encryptSensitiveText(completionProof.imageBase64),
        mimeType: completionProof.mimeType,
        cameraFacing: completionProof.cameraFacing,
        capturedAt: new Date()
      }
    });
  }

  private async notifyBookingStatusChange(
    booking: {
      id: string;
      status: BookingStatus;
      scheduledAt: Date;
      clientId: string;
      client: { name: string };
      provider: { userId: string; displayName: string };
    },
    status: BookingStatus,
    actorId: string
  ) {
    const actorLabel = actorId === booking.clientId ? "Cliente" : "Profissional";

    if (status === BookingStatus.CONFIRMED) {
      await notificationService.sendToUsers([booking.clientId, booking.provider.userId], {
        preferenceType: "BOOKINGS",
        title: "Agendamento confirmado",
        body: `${actorLabel} confirmou o horário de ${formatPtBrDate(booking.scheduledAt)}.`,
        data: {
          type: "BOOKING_CONFIRMED",
          bookingId: booking.id
        }
      });
      return;
    }

    if (status === BookingStatus.CANCELLED) {
      await notificationService.sendToUsers([booking.clientId, booking.provider.userId], {
        preferenceType: "BOOKINGS",
        title: "Agendamento cancelado",
        body: `${actorLabel} cancelou o agendamento de ${formatPtBrDate(booking.scheduledAt)}.`,
        data: {
          type: "BOOKING_CANCELLED",
          bookingId: booking.id
        }
      });
    }
  }

  private buildAttendanceQrToken(bookingId: string, code: string, expiresAt?: Date | null) {
    const exp = expiresAt
      ? Math.floor(expiresAt.getTime() / 1000)
      : Math.floor((Date.now() + env.BOOKING_ATTENDANCE_CODE_EXPIRY_HOURS * 60 * 60 * 1000) / 1000);

    const payload: AttendanceQrPayload = {
      bookingId,
      code,
      exp
    };
    const payloadEncoded = toBase64Url(JSON.stringify(payload));
    const signature = createHmac("sha256", env.JWT_SECRET).update(payloadEncoded).digest("base64url");

    return `${attendanceQrTokenPrefix}.${attendanceQrTokenVersion}.${payloadEncoded}.${signature}`;
  }

  private parseAttendanceQrToken(rawToken: string): AttendanceQrPayload {
    const token = rawToken.trim();
    const parts = token.split(".");
    if (parts.length !== 4) {
      throw new AppError("QR Code inválido.", StatusCodes.BAD_REQUEST);
    }

    const [prefix, version, payloadEncoded, signature] = parts;
    if (prefix !== attendanceQrTokenPrefix || version !== attendanceQrTokenVersion) {
      throw new AppError("QR Code inválido.", StatusCodes.BAD_REQUEST);
    }

    const expectedSignature = createHmac("sha256", env.JWT_SECRET)
      .update(payloadEncoded)
      .digest("base64url");

    const signatureBuffer = Buffer.from(signature, "utf8");
    const expectedBuffer = Buffer.from(expectedSignature, "utf8");
    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      throw new AppError("QR Code inválido.", StatusCodes.BAD_REQUEST);
    }

    let payload: AttendanceQrPayload;
    try {
      payload = JSON.parse(fromBase64Url(payloadEncoded)) as AttendanceQrPayload;
    } catch {
      throw new AppError("QR Code inválido.", StatusCodes.BAD_REQUEST);
    }

    if (!payload.bookingId || !/^\d{6}$/.test(payload.code) || typeof payload.exp !== "number") {
      throw new AppError("QR Code inválido.", StatusCodes.BAD_REQUEST);
    }

    const nowEpoch = Math.floor(Date.now() / 1000);
    if (payload.exp <= nowEpoch) {
      throw new AppError("QR Code expirado. Gere um novo código para esta aula.", StatusCodes.BAD_REQUEST);
    }

    return payload;
  }
}
