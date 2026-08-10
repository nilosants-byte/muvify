import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import {
  BookingStatus,
  CrefValidationStatus,
  PaymentMethod,
  PaymentStatus,
  PresentialPackageMode,
  PresentialPackageStatus,
  Prisma
} from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env";
import { prisma } from "../../../config/prisma";
import { MP_CLIENT_TIMEOUT_MS } from "../../../config/mercadopago";
import { redis } from "../../../config/redis";
import { AppError } from "../../../shared/errors/app-error";
import { deleteByPattern } from "../../../shared/utils/cache";
import { assertEmailVerified } from "../../../shared/utils/email-verification";
import { decryptSensitiveText, encryptSensitiveText } from "../../../shared/utils/encryption";
import { haversineKm } from "../../../shared/utils/geo";
import { sessionOverlapsRange } from "../../../shared/utils/time-range";
import { assertOfferAllowsServiceLocation } from "../../../shared/utils/offer-service-mode";
import { toDateKeyInTimezone, toTimeInTimezone, toWeekdayInTimezone } from "../../../shared/utils/timezone";
import { toProviderPhotoUrl, toUserPhotoUrl } from "../../../shared/utils/photo-url";
import { getPrivateObject, putPrivateObject } from "../../../shared/services/storage.service";
import { restoreFlexibleCreditForBooking } from "../../../shared/utils/presential-package-credit";
import { assertOfferAcceptsPaymentMethod } from "../../../shared/utils/offer-payment-method";
import { NotificationService } from "../../notifications/services/notification.service";
import { PaymentService } from "../../payments/services/payment.service";
import { DebtService } from "../../payments/services/debt.service";
import { EmailService } from "../../../shared/services/email.service";
import { EmailQueueService } from "../../../shared/services/email-queue.service";

const emailService = new EmailService();
const emailQueueService = new EmailQueueService();
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

// Frente 6 (segunda camada), Lote 9: o limite de tentativas do código de
// presença só era aplicado com Redis disponível — se o Redis caísse, a
// validação ficava sem limite nenhum de tentativas (só o profissional
// vinculado ao booking pode chamar essa rota, mas ainda assim). Fallback em
// memória do próprio processo (não compartilhado entre instâncias, mas
// muito melhor que nenhum limite) só usado quando o Redis não está pronto.
const inMemoryAttendanceAttempts = new Map<string, { count: number; resetAt: number }>();
function checkInMemoryAttendanceAttempts(key: string, maxAttempts: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = inMemoryAttendanceAttempts.get(key);
  if (!entry || entry.resetAt < now) {
    inMemoryAttendanceAttempts.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= maxAttempts;
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

    await assertEmailVerified(clientId);
    await debtService.assertNoOutstandingDebt(clientId);
    await debtService.assertProviderNoOutstandingDebt(providerId);

    // Frente 3 (Cadastro/onboarding), Lote 3: a consultoria online já
    // exigia anamnese completa no servidor antes de contratar; agendamento
    // presencial só bloqueava isso na UI do mobile - quem chamasse a API
    // direto conseguia agendar sem a ficha de saúde preenchida. Mesma regra,
    // mesma flag.
    if (env.REQUIRE_ANAMNESIS_FOR_CONTRACTS) {
      const anamnesis = await prisma.clientAnamnesis.findUnique({
        where: { clientId }
      });
      if (!anamnesis || anamnesis.status !== "COMPLETED") {
        throw new AppError(
          "Preencha a anamnese antes de agendar com um profissional.",
          StatusCodes.BAD_REQUEST
        );
      }
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

      // Frente 5 (segunda camada), Lote 2: buscada aqui (antes da checagem
      // de local) porque a restrição offerServiceMode da oferta precisa
      // ser validada junto com o local escolhido — antes era buscada só
      // mais abaixo, depois desse ponto, e essa restrição nunca era
      // checada em nenhum lugar.
      let offer: Awaited<ReturnType<typeof tx.providerServiceOffer.findFirst>> = null;
      if (!presentialPackage && offerId) {
        offer = await tx.providerServiceOffer.findFirst({
          where: { id: offerId, providerId, isActive: true }
        });
        if (!offer) {
          throw new AppError("Oferta selecionada não está disponível para este profissional.");
        }
      }

      // Distance check only applies to at-home visits — a booking at one of the
      // provider's own fixed locations (gym, studio) never needs it, since the
      // client is the one traveling there.
      const fixedLocations = Array.isArray(provider.fixedLocations)
        ? (provider.fixedLocations as unknown as Array<{ name: string }>)
        : [];
      const isFixedLocation = sessionLocation ? fixedLocations.some((loc) => loc.name === sessionLocation) : true;

      if (offer) {
        assertOfferAllowsServiceLocation(offer, isFixedLocation);
      }

      if (sessionLocation) {
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

      // Frente 5 (Descoberta, agendamento e agenda), Lote 3: comparar só
      // igualdade exata de instante permitia dois agendamentos que na
      // prática se sobrepõem (ex: 10:00 e 10:05, ambos dentro de uma
      // sessão de 60min) coexistirem sem erro nenhum. Como a duração é
      // única por profissional, a checagem de sobreposição de intervalo
      // se reduz a "existe algum agendamento cujo início cai dentro da
      // janela (novo início - duração, novo início + duração)" — os
      // limites são estritos de propósito, pra permitir sessões
      // encostadas (uma termina exatamente quando a outra começa).
      const sessionDurationMs = provider.sessionDurationMinutes * 60 * 1000;
      const conflict = await tx.booking.findFirst({
        where: {
          providerId,
          status: {
            in: [BookingStatus.PENDING, BookingStatus.CONFIRMED]
          },
          scheduledAt: {
            gt: new Date(scheduleDate.getTime() - sessionDurationMs),
            lt: new Date(scheduleDate.getTime() + sessionDurationMs)
          }
        }
      });
      if (conflict) {
        throw new AppError("Este horário conflita com outro agendamento já marcado.", StatusCodes.CONFLICT);
      }

      const manualBlocks = await tx.providerManualBlock.findMany({
        where: { providerId, date: scheduleDateKey },
        select: { startTime: true, endTime: true },
      });
      // Frente 4 (segunda camada), Lote 3: mesmo cuidado de duração já
      // aplicado ao conflito booking-vs-booking logo acima (Frente 5, Lote
      // 3) — antes só checava se o INÍCIO do agendamento caía dentro do
      // bloqueio, permitindo uma sessão de 60min que começa antes do
      // bloqueio mas invade os primeiros minutos dele.
      const blockedByManual = manualBlocks.some(
        (block) => sessionOverlapsRange(scheduleTime, provider.sessionDurationMinutes, block.startTime, block.endTime)
      );
      if (blockedByManual) {
        throw new AppError(
          "Este horário está bloqueado pelo profissional.",
          StatusCodes.CONFLICT
        );
      }

      // Frente 6 (segunda camada), Lote 4: getPublicSchedulePreview já
      // marca o horário de alunos presenciais cadastrados fora do app
      // (Financeiro, com horário fixo semanal) como ocupado, pra impedir
      // que a pré-visualização mostre um horário como livre quando na
      // verdade colide com um aluno que só o profissional enxerga — mas
      // essa proteção existia só ali, cosmética. A criação de agendamento
      // de verdade nunca checava isso, então dava pra marcar por cima via
      // API mesmo com a prévia mostrando ocupado (cache de até 60s, app
      // desatualizado, ou chamada direta).
      const offAppStudents = await tx.financialStudent.findMany({
        where: {
          providerId,
          isActive: true,
          type: { in: ["PRESENTIAL", "BOTH"] }
        },
        select: { weeklySchedule: true, startDate: true, recurrenceEndDate: true }
      });
      // Comparação por chave de data (YYYY-MM-DD no fuso do app), não por
      // Date bruto — mesmo cuidado já documentado em getPublicSchedulePreview
      // pra não esbarrar no bug clássico de fronteira UTC×America/Sao_Paulo.
      const blockedByOffAppStudent = offAppStudents.some((student) => {
        const startKey = toDateKeyInTimezone(student.startDate, env.APP_TIMEZONE);
        if (scheduleDateKey < startKey) return false;
        if (student.recurrenceEndDate) {
          const endKey = toDateKeyInTimezone(student.recurrenceEndDate, env.APP_TIMEZONE);
          if (scheduleDateKey > endKey) return false;
        }
        const schedule = Array.isArray(student.weeklySchedule)
          ? (student.weeklySchedule as unknown as Array<{ dayOfWeek: number; startTime: string; endTime: string }>)
          : [];
        return schedule.some(
          (slot) =>
            slot.dayOfWeek === scheduleWeekday &&
            sessionOverlapsRange(scheduleTime, provider.sessionDurationMinutes, slot.startTime, slot.endTime)
        );
      });
      if (blockedByOffAppStudent) {
        throw new AppError(
          "Este horário está ocupado por outro aluno do profissional.",
          StatusCodes.CONFLICT
        );
      }

      let bookingPriceCents = provider.priceCents;

      if (presentialPackage) {
        // Preço por sessão travado na compra do pacote (Frente D) - nada
        // foi cobrado adiantado, essa sessão segue o mesmo motor de
        // reserva+captura da sessão avulsa comum.
        bookingPriceCents = presentialPackage.sessionPriceCents;
      } else if (offer) {
        // Épico de Frentes, Frente 6 (Ofertas do profissional), Lote 3:
        // booking avulso vinculado a uma oferta nunca checava
        // acceptsPix/acceptsDebitCard/acceptsCreditCard — único dos 3
        // fluxos irmãos (consultoria, pacote presencial, booking avulso)
        // sem essa validação.
        assertOfferAcceptsPaymentMethod(offer, paymentMethod, "este agendamento");

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
          offerId: presentialPackage ? null : (offerId ?? null),
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
        // Frente 4 (Criação/entrega/evolução do treino), Lote 1: o lock de
        // transação é por profissional+horário, não por pacote - duas
        // requisições concorrentes pra horários diferentes do mesmo
        // profissional podiam ambas passar na checagem de saldo (linha
        // ~296) antes de qualquer uma decrementar. O decremento condicional
        // (só afeta a linha se ainda houver saldo) fecha essa corrida -
        // Postgres reavalia o WHERE contra o valor mais recente ao adquirir
        // o lock da linha, então a segunda transação a chegar aqui vê o
        // saldo já zerado e falha, em vez de decrementar pra negativo.
        const consumed = await tx.presentialPackage.updateMany({
          where: { id: presentialPackage.id, creditsRemainingThisCycle: { gt: 0 } },
          data: { creditsRemainingThisCycle: { decrement: 1 } }
        });
        if (consumed.count === 0) {
          throw new AppError("Você já usou todas as sessões deste pacote.", StatusCodes.BAD_REQUEST);
        }
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

    // Frente 2 (segunda camada), Lote 9: antes ia direto por
    // emailService.sendBookingConfirmationTo*, fire-and-forget com
    // ".catch(() => undefined)" — o único ponto do sistema onde uma falha
    // de e-mail não deixava rastro nenhum, nem local. Passa a usar a
    // mesma fila com retry automático já usada pelos outros e-mails.
    if (emailService.canSendEmail()) {
      const sharedInput = {
        scheduledAt: createdBooking.scheduledAt,
        categoryName: createdBooking.category.name,
        priceCents: createdBooking.priceCents,
      };
      await emailQueueService.enqueueBookingConfirmationClient({
        ...sharedInput,
        to: createdBooking.client.email,
        clientName: createdBooking.client.name,
        providerName: createdBooking.provider.displayName,
      }).catch((error) => console.error("Falha ao enfileirar e-mail de confirmação de agendamento (cliente):", error));
      await emailQueueService.enqueueBookingConfirmationProvider({
        ...sharedInput,
        to: createdBooking.provider.user.email,
        providerName: createdBooking.provider.displayName,
        clientName: createdBooking.client.name,
      }).catch((error) => console.error("Falha ao enfileirar e-mail de confirmação de agendamento (profissional):", error));
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

    const baseWhere = {
      OR: [
        { clientId: userId },
        {
          provider: {
            userId
          }
        }
      ]
    };

    const includeShape = {
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
          // Frente 5 (Descoberta, agendamento e agenda), Lote 7: nenhuma
          // tela avisava o profissional que a própria conta está com
          // CREF rejeitado/suspensa ao gerenciar um booking já existente
          // (checagem só existia na criação de booking novo).
          crefValidationStatus: true,
          user: {
            select: {
              id: true,
              name: true,
              phone: true,
              suspendedAt: true
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
    } as const;

    // Frente 5 (Descoberta, agendamento e agenda), Lote 2: sem filtro de
    // status, ordenação ascendente por scheduledAt + take fixo faziam essa
    // rota devolver sempre os agendamentos MAIS ANTIGOS de toda a vida da
    // conta assim que ultrapassava o limite de paginação — agendamentos
    // ativos (pendentes/confirmados, inclusive futuros) simplesmente
    // paravam de aparecer (aba "Próximos" vazia, notificação levando a
    // "agendamento não encontrado"). Os ativos agora sempre entram
    // inteiros (volume real por conta é sempre pequeno, não precisa
    // paginar), e só o histórico (concluído/cancelado) é paginado.
    const [activeBookings, historyBookings] = await Promise.all([
      prisma.booking.findMany({
        where: { ...baseWhere, status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] } },
        include: includeShape,
        orderBy: { scheduledAt: "asc" }
      }),
      prisma.booking.findMany({
        where: { ...baseWhere, status: { in: [BookingStatus.COMPLETED, BookingStatus.CANCELLED] } },
        skip,
        take,
        include: includeShape,
        orderBy: { scheduledAt: "desc" }
      })
    ]);

    const bookings = [...activeBookings, ...historyBookings];

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
    // Frente 2 (segunda camada), Lote 7: mesmo padrão de lotes de 5 já usado
    // em autoExpireStaleBookings (mesmo arquivo) — sem isso, um pico de
    // sessões entrando na janela de liberação de código ao mesmo tempo
    // (horário comercial) disparava conexões simultâneas ao banco sem
    // nenhum teto, diferente do padrão já adotado nas funções vizinhas.
    const RELEASE_CONCURRENCY = 5;
    for (let i = 0; i < dueBookings.length; i += RELEASE_CONCURRENCY) {
      await Promise.allSettled(
        dueBookings.slice(i, i + RELEASE_CONCURRENCY).map(async (booking) => {
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
  }

  async sendSessionReminders(referenceDate = new Date()) {
    const oneHourMs = 60 * 60 * 1000;
    const thirtyMinMs = 30 * 60 * 1000;

    // Épico de Frentes, Frente 9, Lote 13: a janela fixa de ±5min ao redor
    // do ponto exato (ex: exatamente 60min antes) não tinha nenhum
    // mecanismo de recuperação - se o job atrasasse mais que isso (deploy,
    // crash, RUN_REMINDER_JOBS desligado e religado), a sessão passava pela
    // janela sem nenhum lembrete ser enviado, silenciosamente. Substituído
    // por um modelo de cruzamento de limiar: due60 pega qualquer sessão que
    // já entrou na janela "dentro de 1h" mas ainda não entrou em "dentro de
    // 30min" (evita mandar "em 1 hora" quando já é bem menos que isso);
    // due30 pega o resto até o início da sessão. Isso é auto-recuperável
    // pra qualquer atraso do job até o próximo limiar, sem precisar de
    // nenhum estado extra de "última execução".
    const due60 = await prisma.booking.findMany({
      where: {
        status: BookingStatus.CONFIRMED,
        reminder60SentAt: null,
        scheduledAt: {
          gt: new Date(referenceDate.getTime() + thirtyMinMs),
          lte: new Date(referenceDate.getTime() + oneHourMs),
        },
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

    const due30 = await prisma.booking.findMany({
      where: {
        status: BookingStatus.CONFIRMED,
        reminder30SentAt: null,
        scheduledAt: {
          gt: referenceDate,
          lte: new Date(referenceDate.getTime() + thirtyMinMs),
        },
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

  // Épico de Frentes, Frente 9, Lote 15 (decisão do usuário: construir):
  // não existia lembrete de "avalie sua sessão" - cliente só avaliava se
  // lembrasse sozinho. Dispara 24h depois da sessão concluída, uma única
  // vez, se ainda não avaliada. Mesmo molde de sendBookingConfirmationReminders
  // (mark-before-notify via updateMany condicional).
  async sendReviewReminders(referenceDate = new Date()) {
    const reviewReminderDelayMs = 24 * 60 * 60 * 1000;
    const dueBookings = await prisma.booking.findMany({
      where: {
        status: BookingStatus.COMPLETED,
        completedAt: { lte: new Date(referenceDate.getTime() - reviewReminderDelayMs) },
        reviewReminderSentAt: null,
        review: null
      },
      select: { id: true, clientId: true, provider: { select: { displayName: true } } }
    });

    if (dueBookings.length === 0) {
      return;
    }

    await prisma.booking.updateMany({
      where: { id: { in: dueBookings.map((b) => b.id) }, reviewReminderSentAt: null },
      data: { reviewReminderSentAt: referenceDate }
    });
    for (const booking of dueBookings) {
      void notificationService
        .sendToUsers([booking.clientId], {
          preferenceType: "BOOKINGS",
          title: "Como foi sua sessão?",
          body: `Conte pra gente como foi o atendimento com ${booking.provider.displayName} — sua avaliação ajuda outros alunos a escolher.`,
          data: { type: "REVIEW_REMINDER", bookingId: booking.id }
        })
        .catch((e) => console.error("Review reminder failed:", e));
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
          await restoreFlexibleCreditForBooking(prisma, booking.id).catch((err) => {
            console.error("autoExpire confirmation deadline: restore credit failed for booking", booking.id, err);
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
          await restoreFlexibleCreditForBooking(prisma, booking.id).catch((err) => {
            console.error("autoExpire pending: restore credit failed for booking", booking.id, err);
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
        providerId: true,
        attendanceCodeValidatedAt: true,
        clientConfirmedAt: true,
        providerConfirmedAt: true,
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

          // Frente 4 (Criação/entrega/evolução do treino), Lote 2: rede de
          // segurança - se os dois lados já confirmaram e o código de
          // presença foi validado, a sessão claramente aconteceu; ela só
          // ficou travada em CONFIRMED por causa da corrida de dupla-
          // confirmação (corrigida em confirmCompletion, mas dados
          // anteriores ao fix podem ter ficado presos assim). Cancelar e
          // estornar automaticamente aqui seria exatamente o erro que o
          // achado da auditoria apontou - abre um caso pra revisão manual
          // em vez disso, mantendo a reserva do cartão intacta.
          if (booking.attendanceCodeValidatedAt && booking.clientConfirmedAt && booking.providerConfirmedAt) {
            const payment = await prisma.payment.findUnique({ where: { bookingId: booking.id } });
            if (payment) {
              await prisma.disputeCase.create({
                data: {
                  type: "CONFIRMATION_DEADLOCK",
                  clientId: booking.clientId,
                  providerId: booking.providerId,
                  amountCents: payment.amountCents,
                  mpPaymentId: payment.mpPaymentId,
                  bookingId: booking.id,
                  contextNote:
                    "Sessão com código de presença validado e as duas partes confirmadas, mas travada em CONFIRMED (corrida de dupla-confirmação) - encerrada automaticamente 48h após o horário marcado sem decisão sobre o pagamento. Reserva do cartão mantida até revisão manual."
                }
              });
            }
            void notificationService
              .sendToUsers([booking.clientId, booking.provider.userId], {
                preferenceType: "BOOKINGS",
                title: "Agendamento encaminhado para revisão",
                body: "A sessão foi confirmada pelas duas partes, mas ficou pendente por uma falha técnica. O caso foi encaminhado para revisão manual.",
                data: { type: "BOOKING_CONFIRMATION_DEADLOCK", bookingId: booking.id }
              })
              .catch((error) => console.error("Booking confirmation-deadlock notification failed:", error));
            return;
          }

          // Raio-X de pagamentos, Rodada 5, Lote 4 (auditoria adversarial):
          // se o código de presença nunca foi validado, o cliente pode ter
          // simplesmente recusado cooperar pra evitar pagar — reembolsar
          // automaticamente e sem registro nenhum é exatamente o que esse
          // cliente esperaria. Em vez de devolver o dinheiro sozinho, abre
          // um caso pra um admin revisar (mesmo padrão de NO_SHOW_CONTESTED)
          // e mantém a reserva no cartão intacta até a decisão manual.
          if (!booking.attendanceCodeValidatedAt) {
            const payment = await prisma.payment.findUnique({ where: { bookingId: booking.id } });
            if (payment) {
              await prisma.disputeCase.create({
                data: {
                  type: "NO_SHOW_CONTESTED",
                  clientId: booking.clientId,
                  providerId: booking.providerId,
                  amountCents: payment.amountCents,
                  mpPaymentId: payment.mpPaymentId,
                  bookingId: booking.id,
                  contextNote:
                    "Sessão encerrada automaticamente 48h após o horário marcado sem que o código de presença tivesse sido validado — nenhuma das partes confirmou a conclusão. Reserva do cartão mantida até revisão manual."
                }
              });
            }
            void notificationService
              .sendToUsers([booking.clientId, booking.provider.userId], {
                preferenceType: "BOOKINGS",
                title: "Agendamento encerrado sem confirmação",
                body: "O código de presença não foi validado nesta sessão. O caso foi encaminhado para revisão manual antes de qualquer decisão sobre o pagamento.",
                data: { type: "BOOKING_ATTENDANCE_NOT_VALIDATED", bookingId: booking.id }
              })
              .catch((error) => console.error("Booking attendance-not-validated notification failed:", error));
            return;
          }

          await paymentService.cancelPaymentForBooking(booking.id).catch((err) => {
            console.error("autoExpire: cancel payment failed for booking", booking.id, err);
          });
          await restoreFlexibleCreditForBooking(prisma, booking.id).catch((err) => {
            console.error("autoExpire: restore credit failed for booking", booking.id, err);
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

    // Raio-X Muvify, Frente 1 (Autorização/IDOR), Lote 2: 404 em vez de
    // 403 — não diferencia "não existe" de "existe mas não é seu" pra
    // quem tenta um bookingId de terceiro, alinhado ao padrão já usado em
    // consultancy/presential-packages.
    if (booking.clientId !== userId) {
      throw new AppError("Agendamento não encontrado.", StatusCodes.NOT_FOUND);
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

    // Frente 6 (segunda camada), Lote 1: uma vez que a presença já foi
    // validada, o código nunca mais deve ser regenerado — reabrir esta
    // tela (ação corriqueira, ex: no dia seguinte) apagava
    // attendanceCodeValidatedAt silenciosamente, destravando retroativamente
    // um relato de falta indevido e a auto-expiração tratando a sessão como
    // "presença nunca validada".
    let refreshedBooking = booking;
    const alreadyValidated = Boolean(booking.attendanceCodeValidatedAt);
    const isExpired =
      Boolean(booking.attendanceCodeExpiresAt) && booking.attendanceCodeExpiresAt! < now;
    if (!alreadyValidated && (!booking.attendanceCode || isExpired)) {
      const code = generateAttendanceCode();
      // Bug irmão: calcular a partir de scheduledAt (fixo) fazia o código
      // "regenerado" nascer com a mesma data de expiração que acabou de
      // vencer — nunca mais era possível gerar um código válido depois da
      // janela original. Agora conta a partir do instante da regeneração.
      const expiresAt = new Date(
        now.getTime() + env.BOOKING_ATTENDANCE_CODE_EXPIRY_HOURS * 60 * 60 * 1000
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

    // Raio-X Muvify, Frente 1 (Autorização/IDOR), Lote 2: 404 em vez de
    // 403, mesma razão de getAttendanceCode acima.
    if (booking.provider.userId !== userId) {
      throw new AppError("Agendamento não encontrado.", StatusCodes.NOT_FOUND);
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
    } else {
      const withinLimit = checkInMemoryAttendanceAttempts(
        attemptKey,
        ATTENDANCE_MAX_ATTEMPTS,
        ATTENDANCE_WINDOW_SECONDS * 1000
      );
      if (!withinLimit) {
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

    // Frente 6 (segunda camada), Lote 1: com o código nunca mais sendo
    // regenerado após validado (ver getAttendanceCode acima),
    // attendanceCodeExpiresAt fica congelado no valor original — uma
    // reverificação redundante (ex: o profissional toca em validar de
    // novo por engano) já validada não deveria falhar com "expirado".
    if (booking.attendanceCodeValidatedAt) {
      return {
        bookingId: booking.id,
        validated: true,
        validatedAt: booking.attendanceCodeValidatedAt.toISOString()
      };
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

    // Frente 6 (segunda camada), Lote 9: só o job periódico
    // (autoExpireStaleBookings) reforçava o prazo de confirmação — nada
    // impedia o profissional de confirmar depois do prazo já vencido,
    // contanto que o job ainda não tivesse rodado (janela de segundos a
    // minutos, maior ainda sob instabilidade de banco, quando o job usa
    // backoff exponencial).
    if (
      status === BookingStatus.CONFIRMED &&
      booking.confirmationDeadlineAt &&
      booking.confirmationDeadlineAt < new Date()
    ) {
      throw new AppError(
        "O prazo para confirmar este agendamento já venceu — ele será cancelado automaticamente.",
        StatusCodes.BAD_REQUEST
      );
    }

    // Frente 6 (segunda camada), Lote 8: cancelar uma sessão cujo horário
    // já passou sem a presença ter sido validada tratava os dois lados de
    // forma inconsistente — cliente que se auto-cancelava tarde era
    // cobrado na hora, sem os 48h de contestação que "reportar falta" dá; e
    // o profissional podia usar o mesmo botão genérico de cancelar depois
    // que o cliente já tinha faltado, devolvendo o dinheiro sem querer, sem
    // aviso. Passado o horário sem presença validada, o caminho correto
    // pros dois lados é reportar falta (reportNoShow), nunca um cancelamento
    // simples.
    if (
      status === BookingStatus.CANCELLED &&
      booking.scheduledAt <= new Date() &&
      !booking.attendanceCodeValidatedAt
    ) {
      throw new AppError(
        "O horário deste agendamento já passou sem a presença confirmada — use \"Reportar falta\" em vez de cancelar.",
        StatusCodes.BAD_REQUEST
      );
    }

    // Frente 6 (segunda camada), Lote 3: escrita incondicional — duas
    // chamadas de updateStatus quase simultâneas pro mesmo booking (duplo
    // toque em cancelar, ou uma corrida com confirmCompletion escrevendo
    // COMPLETED por cima) passavam pela checagem de transição acima (lida
    // antes de qualquer commit) e as duas executavam os efeitos colaterais
    // — no caso de CANCELLED, isso duplicava o crédito devolvido de um
    // pacote de sessões avulsas. Mesmo padrão de "claim" atômico já usado
    // em Payment.mutationLockedAt/DisputeCase.resolvingLockedAt.
    const claimed = await prisma.booking.updateMany({
      where: { id: bookingId, status: booking.status },
      data: { status }
    });
    if (claimed.count === 0) {
      throw new AppError(
        "Este agendamento já foi alterado por outra ação. Recarregue para ver o status atual.",
        StatusCodes.CONFLICT
      );
    }

    const updated = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
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
        await restoreFlexibleCreditForBooking(prisma, bookingId);
      } else {
        await paymentService.captureIfAuthorizedForBookingOrDispute(
          bookingId,
          "Cliente cancelou com menos de 2h de antecedência (profissional deveria ficar com o valor) e a cobrança falhou."
        );
      }
    }

    // Frente 6 (segunda camada), Lote 14: a prévia pública de agenda
    // (getPublicSchedulePreview) só era invalidada na criação de
    // agendamento — cancelar um agendamento libera o horário de verdade,
    // mas a prévia continuava mostrando ocupado até o TTL de 60s expirar
    // sozinho.
    void deleteByPattern(`schedule:${updated.providerId}:*`).catch(() => undefined);

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
    // Raio-X Muvify, Frente 1 (Autorização/IDOR), Lote 2: 404 em vez de 403.
    if (!isClient && !isProvider) {
      throw new AppError("Agendamento não encontrado.", StatusCodes.NOT_FOUND);
    }

    if (!booking.attendanceCodeValidatedAt) {
      throw new AppError(
        "Código presencial ainda não foi validado pelo profissional. Valide o código de 6 dígitos antes de concluir.",
        StatusCodes.BAD_REQUEST
      );
    }

    // Raio-X de pagamentos, Rodada 5, Lote 4 (auditoria adversarial): nada
    // impedia concluir a sessão antes do horário marcado sequer começar —
    // duas contas em conluio (ou a mesma pessoa) podiam liberar o código,
    // validar e confirmar tudo antes do horário, capturando o pagamento e
    // gamificação sem nenhum serviço prestado.
    if (now < booking.scheduledAt) {
      throw new AppError(
        "Não é possível concluir o agendamento antes do horário marcado.",
        StatusCodes.BAD_REQUEST
      );
    }

    const confirmationField = isClient ? "clientConfirmedAt" : "providerConfirmedAt";
    const CONFIRM_INCLUDE = {
      client: { select: { id: true, name: true } },
      provider: { select: { userId: true, displayName: true } }
    } as const;

    // Frente 4 (Criação/entrega/evolução do treino), Lote 2: cliente e
    // profissional confirmando quase ao mesmo tempo liam o campo de
    // confirmação um do outro ainda nulo, então nenhuma das duas
    // requisições calculava bothConfirmed=true — a sessão travava em
    // CONFIRMED pra sempre (a captura por confirmação única só cobre o
    // caso de exatamente um campo preenchido; 48h depois o job de
    // expiração cancelava e estornava sem abrir disputa nenhuma, mesmo com
    // o código de presença validado). O lock por bookingId serializa as
    // duas confirmações — quem chega depois sempre lê o estado já
    // atualizado por quem chegou antes, então exatamente uma das duas
    // sempre detecta bothConfirmed=true corretamente.
    const lockKey = `booking-confirm:${bookingId}`;
    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

        const fresh = await tx.booking.findUniqueOrThrow({
          where: { id: bookingId },
          select: { status: true, clientConfirmedAt: true, providerConfirmedAt: true }
        });

        if (fresh.status === BookingStatus.COMPLETED) {
          const current = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: CONFIRM_INCLUDE });
          return { updated: current, justCompleted: false, stillWaiting: false };
        }

        // Frente 6 (segunda camada), Lote 3: só o caso "já concluído" era
        // tratado — se o booking tivesse sido cancelado nesse meio-tempo
        // (ex: o cliente cancelando quase ao mesmo tempo em que o
        // profissional confirma a conclusão), o fluxo seguia normalmente e
        // capturava o pagamento + marcava COMPLETED por cima do
        // cancelamento que acabou de acontecer.
        if (fresh.status === BookingStatus.CANCELLED) {
          throw new AppError(
            "Este agendamento foi cancelado antes de ser possível confirmar a conclusão.",
            StatusCodes.CONFLICT
          );
        }

        const alreadyConfirmedByMe = Boolean(fresh[confirmationField]);
        const data: {
          clientConfirmedAt?: Date;
          providerConfirmedAt?: Date;
          status?: BookingStatus;
          completedAt?: Date;
        } = {};
        if (!alreadyConfirmedByMe) {
          data[confirmationField] = now;
        }

        const finalClientConfirmedAt = data.clientConfirmedAt ?? fresh.clientConfirmedAt;
        const finalProviderConfirmedAt = data.providerConfirmedAt ?? fresh.providerConfirmedAt;
        const bothConfirmed = Boolean(finalClientConfirmedAt && finalProviderConfirmedAt);

        if (alreadyConfirmedByMe && !bothConfirmed) {
          // Já confirmei antes e o outro lado ainda não — nada novo a fazer.
          const current = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: CONFIRM_INCLUDE });
          return { updated: current, justCompleted: false, stillWaiting: true };
        }

        if (bothConfirmed) {
          const payment = await tx.payment.findUnique({
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
          data.status = BookingStatus.COMPLETED;
          data.completedAt = now;
        }

        if (!alreadyConfirmedByMe) {
          const sanitizedProof = this.validateCompletionProof(completionProof);
          await this.upsertCompletionEvidence(bookingId, userId, sanitizedProof);
        }

        const updatedBooking = await tx.booking.update({
          where: { id: bookingId },
          data,
          include: CONFIRM_INCLUDE
        });

        return { updated: updatedBooking, justCompleted: bothConfirmed, stillWaiting: false };
      },
      // Épico de Frentes, Frente 12, Lote 2: a captura de pagamento (linha
      // acima) pode levar até MP_CLIENT_TIMEOUT_MS inteiro, e ainda sobra
      // trabalho depois dela (evidência de conclusão, update final do
      // booking) - um timeout de transação igual ao da própria chamada à MP
      // não deixava margem nenhuma. Se a transação estourasse bem nesse
      // ponto, o pagamento já capturado (commitado numa conexão própria,
      // fora desta transação) ficava dessincronizado do booking (que
      // revertia por inteiro) - autorrecuperável numa nova tentativa
      // (capturePaymentForBooking é idempotente), mas gerava um erro evitável
      // no meio do fluxo. Margem generosa para evidência + updates finais.
      { timeout: MP_CLIENT_TIMEOUT_MS + 15000, maxWait: 15000 }
    );

    const { updated, justCompleted, stillWaiting } = result;

    if (!justCompleted && !stillWaiting) {
      // Já estava concluído (por essa mesma corrida ou por outro caminho) —
      // devolve como está, sem repetir notificação/gamificação.
      return updated;
    }

    if (justCompleted) {
      // A captura (cartão) já foi feita mais acima, antes de qualquer
      // gravação — aqui só o que depende do agendamento já estar concluído.
      const {
        onWorkoutCompleted,
        onFirstBookingCompleted,
        onEvery10BookingsCompleted,
      } = await import("../../gamification/services/gamification-events.service");
      void onWorkoutCompleted(updated.clientId, bookingId);
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
    // Raio-X Muvify, Frente 1 (Autorização/IDOR), Lote 2: 404 em vez de 403.
    if (!isClient && !isProvider) {
      throw new AppError("Agendamento não encontrado.", StatusCodes.NOT_FOUND);
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

      // O pre-check acima nao protege sozinho contra duas requisicoes
      // concorrentes (isolation READ COMMITTED deixa ambas passarem por
      // ele antes de qualquer commit) — sem esse catch, a perdedora da
      // corrida vazava o erro cru de unique constraint do Prisma em vez
      // da mensagem amigavel que o app espera pra detectar estado obsoleto.
      try {
        await tx.noShowReport.create({
          data: {
            bookingId,
            reportedUserId,
            reportedByUserId: reporterId,
            contestDeadlineAt,
            reportReason: reportReason?.trim() || null
          }
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          return { updated: booking, alreadyReported: true };
        }
        throw err;
      }

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
    // Raio-X Muvify, Frente 1 (Autorização/IDOR), Lote 2: 404 em vez de 403.
    if (!isClient && !isProvider) {
      throw new AppError("Agendamento não encontrado.", StatusCodes.NOT_FOUND);
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
          await restoreFlexibleCreditForBooking(prisma, report.bookingId);
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

  // Frente 5 (Descoberta, agendamento e agenda), Lote 2: suspender ou
  // excluir a conta do profissional já cancelava pacotes presenciais e
  // contratos de consultoria ativos (admin.service.ts::suspendUser,
  // user.service.ts::deleteMe), mas nunca agendamentos avulsos (sem
  // packageId) em PENDING/CONFIRMED — cliente que já tinha pago ficava sem
  // nenhuma resolução proativa, só descoberto ~48h depois via disputa
  // manual de admin. Mesmo espírito de "profissional some, cliente nunca
  // perde dinheiro" já usado no cancelamento normal feito pelo profissional
  // (updateStatus, isProviderCancelling sempre reembolsa).
  async cancelActiveStandaloneBookingsForProviderRemoval(providerId: string) {
    const bookings = await prisma.booking.findMany({
      where: {
        providerId,
        packageId: null,
        status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] }
      },
      include: {
        client: { select: { id: true, name: true } },
        provider: { select: { userId: true, displayName: true } }
      }
    });

    for (const booking of bookings) {
      await prisma.booking.update({ where: { id: booking.id }, data: { status: BookingStatus.CANCELLED } });
      await paymentService.cancelPaymentForBooking(booking.id).catch((error) =>
        console.error(`Falha ao estornar agendamento ${booking.id} na remoção do profissional ${providerId}:`, error)
      );
      // Frente 6 (Ofertas do profissional), achado incidental de teste:
      // era fire-and-forget (`void`, sem await) — corrida real entre o
      // retorno desta função e a escrita da notificação, que passava a
      // maior parte do tempo mas não sempre. Mesmo padrão await+catch já
      // usado acima pra cancelPaymentForBooking.
      await notificationService
        .sendToUsers([booking.clientId], {
          preferenceType: "BOOKINGS",
          title: "Agendamento cancelado",
          body: `Seu agendamento de ${formatPtBrDate(booking.scheduledAt)} com ${booking.provider.displayName} foi cancelado porque o profissional não está mais disponível. O valor pago será totalmente reembolsado.`,
          data: { type: "BOOKING_CANCELLED_PROVIDER_UNAVAILABLE", bookingId: booking.id }
        })
        .catch((error) =>
          console.error(`Falha ao notificar cliente sobre cancelamento do agendamento ${booking.id}:`, error)
        );
    }

    return bookings.length;
  }
}
