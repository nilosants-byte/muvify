import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import {
  BookingStatus,
  CrefValidationStatus,
  PaymentMethod,
  PaymentStatus,
  PresentialPackageMode,
  PresentialPackageStatus
} from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env";
import { prisma } from "../../../config/prisma";
import { redis } from "../../../config/redis";
import { AppError } from "../../../shared/errors/app-error";
import { deleteByPattern } from "../../../shared/utils/cache";
import { decryptSensitiveText, encryptSensitiveText } from "../../../shared/utils/encryption";
import { haversineKm } from "../../../shared/utils/geo";
import { toProviderPhotoUrl, toUserPhotoUrl } from "../../../shared/utils/photo-url";
import { getPrivateObject, putPrivateObject } from "../../../shared/services/storage.service";
import { NotificationService } from "../../notifications/services/notification.service";
import { PaymentService } from "../../payments/services/payment.service";
import { DebtService } from "../../payments/services/debt.service";
import { EmailService } from "../../../shared/services/email.service";

const emailService = new EmailService();
const debtService = new DebtService();

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
const NO_SHOW_CONTEST_WINDOW_MS = 48 * 60 * 60 * 1000;
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
    sessionLocation?: string,
    clientLatitude?: number,
    clientLongitude?: number,
    packageId?: string,
    acknowledgedImmediateExecution?: boolean
  ) {
    const scheduleDate = new Date(scheduledAt);
    if (Number.isNaN(scheduleDate.getTime()) || scheduleDate <= new Date()) {
      throw new AppError("Data de agendamento inválida.");
    }

    // Raio-X de pagamentos, Rodada 3, Lote 5: a regra de cancelamento com
    // menos de 2h de antecedência pode "vencer" antes do prazo de
    // arrependimento de 7 dias do CDC (art. 49) terminar, quando o
    // agendamento é marcado pra menos de 7 dias — o atendimento acontece e
    // se completa antes do prazo legal de reflexão acabar. Mesmo carve-out
    // já usado na consultoria: exige consentimento expresso ao início
    // imediato do atendimento pra dispensar o prazo nesse caso específico.
    // Agendamento pra 7 dias ou mais nunca esbarra nisso.
    const daysUntilScheduled = (scheduleDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    if (daysUntilScheduled < 7 && acknowledgedImmediateExecution !== true) {
      throw new AppError(
        "Como este horário é em menos de 7 dias, é necessário confirmar a ciência sobre o início imediato do atendimento para agendar.",
        StatusCodes.BAD_REQUEST
      );
    }

    await debtService.assertNoOutstandingDebt(clientId);

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
          categoryLinks: true,
          user: { select: { suspendedAt: true } }
        }
      });

      if (!provider) {
        throw new AppError("Prestador não encontrado.", StatusCodes.NOT_FOUND);
      }
      // Raio-X de pagamentos, Rodada 4, Lote 3: suspensão precisa bloquear
      // novo negócio entrando pra essa conta, não só o próprio login dele.
      if (provider.user.suspendedAt) {
        throw new AppError(
          "Este profissional não está disponível para novos agendamentos no momento.",
          StatusCodes.BAD_REQUEST
        );
      }

      // Piso minimo do proprio app (o profissional so pode aumentar, nunca
      // diminuir) — evita agendamento em cima da hora sem o profissional ter
      // tempo de ver, se programar e se deslocar ate o local.
      const minNoticeHours = Math.max(24, provider.minBookingNoticeHours);
      const minNoticeMs = minNoticeHours * 60 * 60 * 1000;
      if (scheduleDate.getTime() - Date.now() < minNoticeMs) {
        throw new AppError(
          `Este profissional exige pelo menos ${minNoticeHours}h de antecedência para novos agendamentos.`,
          StatusCodes.BAD_REQUEST
        );
      }

      if (provider.crefValidationStatus !== CrefValidationStatus.APPROVED) {
        throw new AppError(
          "Este profissional ainda não está habilitado para novos agendamentos.",
          StatusCodes.BAD_REQUEST
        );
      }

      if (!provider.mpAccountId) {
        throw new AppError(
          "Este profissional ainda não configurou o recebimento de pagamentos.",
          StatusCodes.BAD_REQUEST
        );
      }

      if (provider.userId === clientId) {
        throw new AppError(
          "Voce nao pode agendar um atendimento consigo mesmo.",
          StatusCodes.UNPROCESSABLE_ENTITY
        );
      }

      // Frente D (liberdade de ofertas): pacote de sessões avulsas (modo
      // FLEXIBLE_CREDITS, redesenhado) - um número fechado de sessões com
      // validade, sem cobrança adiantada nenhuma. Cada sessão agendada aqui
      // é cobrada individualmente (reserva + captura, igual à sessão avulsa
      // comum) pelo preço por sessão já travado na compra do pacote - só
      // consome 1 vaga do total contratado. A categoria usada é sempre a do
      // pacote (definida na compra), não a que o cliente passar.
      let presentialPackage: { id: string; categoryId: string; sessionPriceCents: number } | null = null;
      if (packageId) {
        const pkg = await tx.presentialPackage.findUnique({
          where: { id: packageId },
          select: {
            id: true,
            clientId: true,
            providerId: true,
            categoryId: true,
            mode: true,
            status: true,
            creditsRemainingThisCycle: true,
            cycleAmountCents: true,
            validUntil: true
          }
        });
        if (!pkg || pkg.clientId !== clientId || pkg.providerId !== providerId) {
          throw new AppError("Pacote presencial não encontrado.", StatusCodes.NOT_FOUND);
        }
        if (pkg.mode !== PresentialPackageMode.FLEXIBLE_CREDITS) {
          throw new AppError(
            "Este pacote não usa agendamento avulso por crédito.",
            StatusCodes.BAD_REQUEST
          );
        }
        if (pkg.status !== PresentialPackageStatus.ACTIVE) {
          throw new AppError(
            "Este pacote não está ativo no momento - verifique se há alguma cobrança pendente.",
            StatusCodes.BAD_REQUEST
          );
        }
        if (pkg.creditsRemainingThisCycle <= 0) {
          throw new AppError("Você já usou todas as sessões deste pacote.", StatusCodes.BAD_REQUEST);
        }
        if (pkg.validUntil && scheduleDate > pkg.validUntil) {
          throw new AppError(
            "Este horário está fora da validade do pacote — escolha uma data anterior ao vencimento.",
            StatusCodes.BAD_REQUEST
          );
        }
        presentialPackage = { id: pkg.id, categoryId: pkg.categoryId, sessionPriceCents: pkg.cycleAmountCents };
      }

      const effectiveCategoryId = presentialPackage ? presentialPackage.categoryId : categoryId;

      const hasLinkedCategory = provider.categoryLinks.some((item) => item.categoryId === effectiveCategoryId);
      if (!hasLinkedCategory) {
        if (provider.categoryLinks.length > 0) {
          throw new AppError("Categoria não atendida por este profissional.");
        }

        const category = await tx.serviceCategory.findUnique({
          where: { id: effectiveCategoryId },
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

      // Distance check only applies to at-home visits — a booking at one of the
      // provider's own fixed locations (gym, studio) never needs it, since the
      // client is the one traveling there.
      if (sessionLocation) {
        const fixedLocations = Array.isArray(provider.fixedLocations)
          ? (provider.fixedLocations as unknown as Array<{ name: string }>)
          : [];
        const isFixedLocation = fixedLocations.some((loc) => loc.name === sessionLocation);

        if (!isFixedLocation && provider.serviceRadiusKm && provider.latitude != null && provider.longitude != null) {
          if (clientLatitude == null || clientLongitude == null) {
            throw new AppError(
              "Informe o endereço do atendimento a domicílio para confirmar se está dentro da área de cobertura do profissional.",
              StatusCodes.BAD_REQUEST
            );
          }
          const distanceKm = haversineKm(provider.latitude, provider.longitude, clientLatitude, clientLongitude);
          if (distanceKm > provider.serviceRadiusKm) {
            throw new AppError(
              `Este endereço está fora do raio de atendimento do profissional (${provider.serviceRadiusKm} km).`,
              StatusCodes.BAD_REQUEST
            );
          }
        }
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

      if (presentialPackage) {
        // Preço por sessão travado na compra do pacote (Frente D) - nada
        // foi cobrado adiantado, essa sessão segue o mesmo motor de
        // reserva+captura da sessão avulsa comum.
        bookingPriceCents = presentialPackage.sessionPriceCents;
      } else if (offerId) {
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

      // Raio-X de pagamentos, Rodada 4, Lote 4: até 24h pro profissional
      // confirmar, mas nunca além de 2h antes do horário marcado (mesmo
      // limite da regra de cancelamento) — pra sempre sobrar tempo real de
      // cancelar e reembolsar antes da sessão, mesmo em agendamentos com
      // pouca antecedência.
      const confirmationNow = new Date();
      const maxConfirmationDeadline = new Date(scheduleDate.getTime() - 2 * 60 * 60 * 1000);
      const defaultConfirmationDeadline = new Date(confirmationNow.getTime() + 24 * 60 * 60 * 1000);
      const confirmationDeadlineAt =
        defaultConfirmationDeadline < maxConfirmationDeadline
          ? defaultConfirmationDeadline
          : maxConfirmationDeadline;

      const booking = await tx.booking.create({
        data: {
          clientId,
          providerId,
          categoryId: effectiveCategoryId,
          packageId: presentialPackage?.id ?? null,
          scheduledAt: scheduleDate,
          priceCents: bookingPriceCents,
          notes,
          sessionLocation: sessionLocation ?? null,
          immediateExecutionAcknowledgedAt: acknowledgedImmediateExecution === true ? new Date() : null,
          confirmationDeadlineAt
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

      if (presentialPackage) {
        await tx.presentialPackage.update({
          where: { id: presentialPackage.id },
          data: { creditsRemainingThisCycle: { decrement: 1 } }
        });
      }
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
        },
        noShowReport: {
          select: {
            id: true,
            reportedUserId: true,
            reportedByUserId: true,
            status: true,
            contestDeadlineAt: true,
            contestedAt: true,
            resolvedAt: true
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

    if (due60.length > 0) {
      await prisma.booking.updateMany({
        where: { id: { in: due60.map((b) => b.id) }, reminder60SentAt: null },
        data: { reminder60SentAt: referenceDate },
      });
      for (const booking of due60) {
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

    if (due30.length > 0) {
      await prisma.booking.updateMany({
        where: { id: { in: due30.map((b) => b.id) }, reminder30SentAt: null },
        data: { reminder30SentAt: referenceDate },
      });
      for (const booking of due30) {
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

  // Raio-X de pagamentos, Rodada 4, Lote 4: avisa o profissional quando o
  // prazo de confirmação de um agendamento avulso está perto de vencer —
  // mesma lógica de "due dentro da janela" usada nos lembretes de vencimento
  // de consultoria, só que sem ponto fixo (o prazo varia por agendamento).
  async sendBookingConfirmationReminders(referenceDate = new Date()) {
    const reminderWindowMs = 2 * 60 * 60 * 1000;
    const dueSoon = await prisma.booking.findMany({
      where: {
        status: BookingStatus.PENDING,
        confirmationReminderSentAt: null,
        confirmationDeadlineAt: {
          gt: referenceDate,
          lte: new Date(referenceDate.getTime() + reminderWindowMs)
        }
      },
      select: { id: true, provider: { select: { userId: true } } }
    });

    if (dueSoon.length === 0) {
      return;
    }

    await prisma.booking.updateMany({
      where: { id: { in: dueSoon.map((b) => b.id) }, confirmationReminderSentAt: null },
      data: { confirmationReminderSentAt: referenceDate }
    });
    for (const booking of dueSoon) {
      void notificationService
        .sendToUsers([booking.provider.userId], {
          preferenceType: "BOOKINGS",
          title: "Confirme o agendamento",
          body: "Você tem um agendamento pendente de confirmação — o prazo está acabando.",
          data: { type: "BOOKING_CONFIRMATION_DUE_SOON", bookingId: booking.id }
        })
        .catch((e) => console.error("Booking confirmation reminder failed:", e));
    }
  }

  async autoExpireStaleBookings(referenceDate = new Date()) {
    // Raio-X de pagamentos, Rodada 4, Lote 4: PENDING que passou do prazo de
    // confirmação mas cujo horário da sessão ainda não chegou — cancela e
    // reembolsa antes que o cliente descubra em cima da hora que ninguém
    // confirmou. O bloco abaixo (scheduledAt já passado) cobre o resto.
    const expiredConfirmationDeadline = await prisma.booking.findMany({
      where: {
        status: BookingStatus.PENDING,
        confirmationDeadlineAt: { lte: referenceDate },
        scheduledAt: { gt: referenceDate }
      },
      select: {
        id: true,
        clientId: true,
        provider: { select: { userId: true } }
      }
    });

    const CONFIRMATION_DEADLINE_CONCURRENCY = 5;
    for (let i = 0; i < expiredConfirmationDeadline.length; i += CONFIRMATION_DEADLINE_CONCURRENCY) {
      await Promise.allSettled(
        expiredConfirmationDeadline.slice(i, i + CONFIRMATION_DEADLINE_CONCURRENCY).map(async (booking) => {
          const updated = await prisma.booking.updateMany({
            where: { id: booking.id, status: BookingStatus.PENDING },
            data: { status: BookingStatus.CANCELLED }
          });
          if (updated.count === 0) return;
          await paymentService.cancelPaymentForBooking(booking.id).catch((err) => {
            console.error("autoExpire confirmation deadline: cancel payment failed for booking", booking.id, err);
          });
          void notificationService
            .sendToUsers([booking.clientId, booking.provider.userId], {
              preferenceType: "BOOKINGS",
              title: "Agendamento cancelado: prazo de confirmação vencido",
              body: "O profissional não confirmou o agendamento dentro do prazo e o valor foi estornado.",
              data: { type: "BOOKING_CONFIRMATION_DEADLINE_EXPIRED", bookingId: booking.id }
            })
            .catch((error) => console.error("Booking confirmation deadline notification failed:", error));
        })
      );
    }

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
      // Cancelamento deixou de ser tudo-ou-nada: o profissional que cancela
      // sempre reembolsa o cliente (nao e culpa dele); o cliente que cancela
      // com pelo menos 2h de antecedencia tambem e reembolsado; cancelando
      // depois disso, o profissional fica com o valor (ja reservou o horario
      // e pode nao conseguir preenche-lo a tempo).
      const isProviderCancelling = booking.provider.userId === userId;
      const hoursUntilSession = (booking.scheduledAt.getTime() - Date.now()) / (60 * 60 * 1000);
      if (isProviderCancelling || hoursUntilSession >= 2) {
        await paymentService.cancelPaymentForBooking(bookingId);
      } else {
        await paymentService.captureIfAuthorizedForBookingOrDispute(
          bookingId,
          "Cliente cancelou com menos de 2h de antecedência (profissional deveria ficar com o valor) e a cobrança falhou."
        );
      }
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

      if (payment?.method === PaymentMethod.PIX) {
        if (payment.status !== PaymentStatus.CAPTURED) {
          throw new AppError(
            "Pagamento via PIX ainda não foi concluído. Finalize o pagamento para concluir o agendamento.",
            StatusCodes.BAD_REQUEST
          );
        }
      } else if (payment) {
        // Cartão: a cobrança definitiva acontece agora, ANTES de qualquer
        // gravação no banco — nunca deixamos o agendamento fechar como
        // concluído sem o dinheiro resolvido (mesmo espírito do Pix acima).
        // Se a captura falhar, a exceção sobe e nada é salvo — quem estava
        // confirmando pode tentar de novo depois de resolver o pagamento.
        if (payment.status !== PaymentStatus.AUTHORIZED && payment.status !== PaymentStatus.CAPTURED) {
          throw new AppError(
            "O pagamento deste agendamento ainda não foi autorizado. Peça para o cliente verificar o cartão antes de concluir.",
            StatusCodes.BAD_REQUEST
          );
        }
        await paymentService.captureIfAuthorizedForBooking(bookingId);
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
      // A captura (cartão) já foi feita mais acima, antes de qualquer
      // gravação — aqui só o que depende do agendamento já estar concluído.
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

  // Lets either party close out a CONFIRMED booking early (instead of waiting for the
  // 48h auto-expire in autoExpireStaleBookings) when the other side never showed up.
  // Only usable once the scheduled time has passed and the attendance code was never
  // validated — if it was validated, both people were physically present, so this
  // isn't a no-show situation. The reported party takes a strike, visible to admins
  // via the /admin/no-show-reports lookup; nothing here auto-bans anyone.
  async reportNoShow(reporterId: string, bookingId: string, reportReason?: string) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        provider: true,
        client: { select: { id: true, name: true } }
      }
    });

    if (!booking) {
      throw new AppError("Agendamento não encontrado.", StatusCodes.NOT_FOUND);
    }

    const isClient = booking.clientId === reporterId;
    const isProvider = booking.provider.userId === reporterId;
    if (!isClient && !isProvider) {
      throw new AppError("Sem permissao para reportar este agendamento.", StatusCodes.FORBIDDEN);
    }

    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new AppError("Apenas agendamentos confirmados podem ser reportados.", StatusCodes.BAD_REQUEST);
    }

    if (booking.scheduledAt > new Date()) {
      throw new AppError("O horário do agendamento ainda não passou.", StatusCodes.BAD_REQUEST);
    }

    if (booking.attendanceCodeValidatedAt) {
      throw new AppError(
        "A presença já foi confirmada neste agendamento — não é possível reportar falta.",
        StatusCodes.BAD_REQUEST
      );
    }

    const reportedUserId = isClient ? booking.provider.userId : booking.clientId;
    const contestDeadlineAt = new Date(Date.now() + NO_SHOW_CONTEST_WINDOW_MS);

    // O booking fecha na hora (a sessao nao vai mais acontecer), mas quem
    // esta certo so e decidido depois da janela de contestacao — nao mexe em
    // strike nem em dinheiro ainda (ver resolveExpiredNoShowReports).
    const { updated, alreadyReported } = await prisma.$transaction(async (tx) => {
      const existing = await tx.noShowReport.findUnique({ where: { bookingId } });
      if (existing) {
        return { updated: booking, alreadyReported: true };
      }

      await tx.noShowReport.create({
        data: {
          bookingId,
          reportedUserId,
          reportedByUserId: reporterId,
          contestDeadlineAt,
          reportReason: reportReason?.trim() || null
        }
      });
      const updatedBooking = await tx.booking.update({
        where: { id: bookingId },
        data: { status: BookingStatus.CANCELLED },
        include: {
          client: { select: { id: true, name: true } },
          provider: { select: { userId: true, displayName: true } }
        }
      });

      return { updated: updatedBooking, alreadyReported: false };
    });

    if (alreadyReported) {
      throw new AppError("Este agendamento já foi reportado.", StatusCodes.CONFLICT);
    }

    void notificationService
      .sendToUsers([booking.clientId, booking.provider.userId], {
        preferenceType: "BOOKINGS",
        title: "Agendamento encerrado por falta",
        body: `O agendamento de ${formatPtBrDate(booking.scheduledAt)} foi encerrado por falta de comparecimento. A parte reportada tem até 48h para contestar.`,
        data: { type: "BOOKING_NO_SHOW", bookingId }
      })
      .catch((error) => {
        console.error("No-show notification failed:", error);
      });

    return updated;
  }

  // A parte acusada tem ate contestDeadlineAt pra contestar o relato — depois
  // disso, so um admin resolve manualmente (fila de disputa, ainda nao
  // construida). Contestar so pausa a resolucao automatica, nao decide nada
  // sozinho.
  async contestNoShowReport(userId: string, bookingId: string, contestReason?: string) {
    const report = await prisma.noShowReport.findUnique({
      where: { bookingId },
      include: {
        booking: {
          select: {
            clientId: true,
            providerId: true,
            priceCents: true,
            provider: { select: { userId: true } },
            payment: { select: { mpPaymentId: true } }
          }
        }
      }
    });

    if (!report) {
      throw new AppError("Nenhum relato de falta encontrado para este agendamento.", StatusCodes.NOT_FOUND);
    }
    if (report.reportedUserId !== userId) {
      throw new AppError("Apenas a parte reportada pode contestar.", StatusCodes.FORBIDDEN);
    }
    if (report.status !== "PENDING") {
      throw new AppError("Este relato não está mais aberto para contestação.", StatusCodes.BAD_REQUEST);
    }
    if (report.contestDeadlineAt < new Date()) {
      throw new AppError("O prazo para contestar este relato já passou.", StatusCodes.BAD_REQUEST);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedReport = await tx.noShowReport.update({
        where: { bookingId },
        data: {
          status: "CONTESTED",
          contestedAt: new Date(),
          contestReason: contestReason?.trim() || null
        }
      });

      await tx.disputeCase.create({
        data: {
          type: "NO_SHOW_CONTESTED",
          clientId: report.booking.clientId,
          providerId: report.booking.providerId,
          amountCents: report.booking.priceCents,
          mpPaymentId: report.booking.payment?.mpPaymentId ?? null,
          bookingId,
          noShowReportId: report.id
        }
      });

      return updatedReport;
    });

    void notificationService
      .sendToUsers([report.reportedByUserId, report.reportedUserId], {
        preferenceType: "BOOKINGS",
        title: "Relato de falta contestado",
        body: "A parte reportada contestou o relato. O caso vai para análise de um administrador.",
        data: { type: "BOOKING_NO_SHOW_CONTESTED", bookingId }
      })
      .catch((error) => {
        console.error("No-show contest notification failed:", error);
      });

    return updated;
  }

  // Quando só uma das partes confirma a sessão, a cobrança é forçada depois de
  // AUTO_CAPTURE_CONFIRMATION_HOURS (ver payment.service.ts::autoCaptureSingleConfirmation)
  // pra proteger quem prestou o serviço de um silêncio da outra parte. Em troca,
  // quem nunca confirmou ganha uma segunda janela de 24h pra contestar essa
  // cobrança específica antes dela ficar definitiva de vez.
  private static readonly AUTO_CAPTURE_CONTEST_WINDOW_MS = 24 * 60 * 60 * 1000;

  async contestAutoCapturedCompletion(userId: string, bookingId: string, reason?: string) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        provider: { select: { userId: true } },
        payment: { select: { mpPaymentId: true } }
      }
    });

    if (!booking) {
      throw new AppError("Agendamento não encontrado.", StatusCodes.NOT_FOUND);
    }

    const isClient = booking.clientId === userId;
    const isProvider = booking.provider.userId === userId;
    if (!isClient && !isProvider) {
      throw new AppError("Você não tem permissão para contestar este agendamento.", StatusCodes.FORBIDDEN);
    }

    if (booking.status !== BookingStatus.COMPLETED || !booking.completedAt) {
      throw new AppError("Este agendamento ainda não foi concluído.", StatusCodes.BAD_REQUEST);
    }

    const clientNeverConfirmed = booking.clientConfirmedAt === null;
    const providerNeverConfirmed = booking.providerConfirmedAt === null;
    if (clientNeverConfirmed === providerNeverConfirmed) {
      // Ou as duas partes confirmaram (conclusão normal, nada a contestar aqui),
      // ou nenhuma confirmou (não deveria existir booking COMPLETED assim).
      throw new AppError(
        "Este agendamento não foi concluído por cobrança automática de confirmação única.",
        StatusCodes.BAD_REQUEST
      );
    }
    if ((clientNeverConfirmed && !isClient) || (providerNeverConfirmed && !isProvider)) {
      throw new AppError("Apenas quem não confirmou a sessão pode contestar.", StatusCodes.FORBIDDEN);
    }

    const deadline = new Date(
      booking.completedAt.getTime() + BookingService.AUTO_CAPTURE_CONTEST_WINDOW_MS
    );
    if (new Date() > deadline) {
      throw new AppError("O prazo de 24 horas para contestar esta cobrança já passou.", StatusCodes.BAD_REQUEST);
    }

    const existing = await prisma.disputeCase.findFirst({
      where: { bookingId, type: "AUTO_CAPTURE_CONTESTED" }
    });
    if (existing) {
      throw new AppError("Você já contestou esta cobrança.", StatusCodes.BAD_REQUEST);
    }

    const disputeCase = await prisma.disputeCase.create({
      data: {
        type: "AUTO_CAPTURE_CONTESTED",
        clientId: booking.clientId,
        providerId: booking.providerId,
        amountCents: booking.priceCents,
        mpPaymentId: booking.payment?.mpPaymentId ?? null,
        bookingId,
        contextNote: reason?.trim() || null
      }
    });

    void notificationService
      .sendToUsers([isClient ? booking.provider.userId : booking.clientId], {
        preferenceType: "BOOKINGS",
        title: "Cobrança automática contestada",
        body: "A cobrança feita por confirmação única de sessão foi contestada. O caso vai para análise de um administrador.",
        data: { type: "BOOKING_AUTO_CAPTURE_CONTESTED", bookingId }
      })
      .catch((error) => {
        console.error("Auto-capture contest notification failed:", error);
      });

    return disputeCase;
  }

  // Roda periodicamente (ver payment-jobs.ts) — resolve relatos cujo prazo de
  // contestacao venceu sem contestacao: aplica o strike e move o dinheiro na
  // direcao certa (quem faltou nao fica com o beneficio da duvida).
  async resolveExpiredNoShowReports(referenceDate = new Date()) {
    const dueReports = await prisma.noShowReport.findMany({
      where: { status: "PENDING", contestDeadlineAt: { lte: referenceDate } },
      include: { booking: { select: { clientId: true, provider: { select: { userId: true } } } } },
      take: 200
    });

    for (const report of dueReports) {
      const clientAtFault = report.reportedUserId === report.booking.clientId;
      try {
        if (clientAtFault) {
          await paymentService.captureIfAuthorizedForBookingOrDispute(
            report.bookingId,
            "Relato de falta não contestado (cliente faltou) e a cobrança do valor da sessão falhou."
          );
        } else {
          await paymentService.cancelPaymentForBooking(report.bookingId);
        }
        await prisma.$transaction([
          prisma.user.update({
            where: { id: report.reportedUserId },
            data: { noShowStrikes: { increment: 1 } }
          }),
          prisma.noShowReport.update({
            where: { id: report.id },
            data: { status: "RESOLVED", resolvedAt: referenceDate }
          })
        ]);
        void notificationService
          .sendToUsers([report.booking.clientId, report.booking.provider.userId], {
            preferenceType: "BOOKINGS",
            title: "Relato de falta resolvido",
            body: clientAtFault
              ? "O relato de falta não foi contestado. O valor da sessão foi mantido com o profissional."
              : "O relato de falta não foi contestado. O valor da sessão foi devolvido ao cliente.",
            data: { type: "BOOKING_NO_SHOW_RESOLVED", bookingId: report.bookingId }
          })
          .catch((error) => {
            console.error("No-show resolution notification failed:", error);
          });
      } catch (error) {
        console.error(`Failed to resolve no-show report ${report.id}:`, error);
      }
    }
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
    const encrypted = encryptSensitiveText(completionProof.imageBase64);
    const storageKey = `attendance-proofs/${bookingId}_${userId}.enc`;
    await putPrivateObject(storageKey, encrypted);

    await prisma.completionEvidence.upsert({
      where: {
        bookingId_userId: {
          bookingId,
          userId
        }
      },
      update: {
        imageBase64: null,
        storageKey,
        mimeType: completionProof.mimeType,
        cameraFacing: completionProof.cameraFacing,
        capturedAt: new Date()
      },
      create: {
        bookingId,
        userId,
        storageKey,
        mimeType: completionProof.mimeType,
        cameraFacing: completionProof.cameraFacing,
        capturedAt: new Date()
      }
    });
  }

  // Cliente ou profissional do próprio agendamento podem ver a comprovação enviada
  // por qualquer um dos dois — decripta sob demanda, nunca serve o objeto do R2 direto
  // (é um blob de texto cifrado, não uma imagem, então uma URL pública não adiantaria).
  async getCompletionProofImage(requesterId: string, bookingId: string, evidenceUserId: string) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { provider: { select: { userId: true } } }
    });

    if (!booking) {
      throw new AppError("Agendamento não encontrado.", StatusCodes.NOT_FOUND);
    }

    const isClient = booking.clientId === requesterId;
    const isProvider = booking.provider.userId === requesterId;
    if (!isClient && !isProvider) {
      throw new AppError("Sem permissão para visualizar esta comprovação.", StatusCodes.FORBIDDEN);
    }

    const evidence = await prisma.completionEvidence.findUnique({
      where: { bookingId_userId: { bookingId, userId: evidenceUserId } }
    });
    if (!evidence) {
      throw new AppError("Comprovação não encontrada.", StatusCodes.NOT_FOUND);
    }

    const encrypted = evidence.storageKey
      ? await getPrivateObject(evidence.storageKey)
      : evidence.imageBase64;
    if (!encrypted) {
      throw new AppError("Comprovação não encontrada.", StatusCodes.NOT_FOUND);
    }

    const base64 = decryptSensitiveText(encrypted);
    if (!base64) {
      throw new AppError("Falha ao processar comprovação.", StatusCodes.INTERNAL_SERVER_ERROR);
    }

    return { buffer: Buffer.from(base64, "base64"), mimeType: evidence.mimeType };
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
