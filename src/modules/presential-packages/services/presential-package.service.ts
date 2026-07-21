import {
  BookingStatus,
  ConsultancyPaymentMethod,
  CrefValidationStatus,
  OfferBillingCycle,
  PresentialPackageMode,
  PresentialPackageStatus,
  ServiceOfferKind
} from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { Payment, CardToken } from "mercadopago";
import { env } from "../../../config/env";
import { prisma } from "../../../config/prisma";
import { mp } from "../../../config/mercadopago";
import { AppError } from "../../../shared/errors/app-error";
import { platformFeeAmount, providerSplitAmount } from "../../../shared/utils/platform-fee";
import { resolveProviderMpAccessToken } from "../../../shared/utils/mp-provider-account";
import { billingCycleDurationDays } from "../../../shared/utils/consultancy-validity";
import { NotificationService } from "../../notifications/services/notification.service";

const notificationService = new NotificationService();
const mpPaymentClient = new Payment(mp);
const mpCardTokenClient = new CardToken(mp);

// Depois de N ciclos seguidos sem conseguir cobrar (cartao recusado, ou Pix
// de renovacao expirado sem pagamento), o pacote cancela sozinho - ninguem
// fica com uma assinatura fantasma pendurada pra sempre.
const MAX_CONSECUTIVE_FAILED_CYCLES = 3;

export type WeeklyScheduleEntry = { weekday: number; time: string };

export type PurchasePresentialPackageInput = {
  offerId: string;
  categoryId: string;
  paymentMethod: ConsultancyPaymentMethod;
  weeklySchedule?: WeeklyScheduleEntry[];
};

function offerEffectivePriceCents(offer: {
  isPromotion: boolean;
  promotionPriceCents: number | null;
  promotionEndsAt: Date | null;
  priceCents: number;
}) {
  const now = new Date();
  const promotionActive =
    offer.isPromotion &&
    typeof offer.promotionPriceCents === "number" &&
    offer.promotionPriceCents > 0 &&
    offer.promotionPriceCents < offer.priceCents &&
    Boolean(offer.promotionEndsAt) &&
    offer.promotionEndsAt! > now;
  return promotionActive ? offer.promotionPriceCents! : offer.priceCents;
}

function validateWeeklySchedule(schedule: WeeklyScheduleEntry[]) {
  if (schedule.length === 0) {
    throw new AppError("Informe ao menos um horário semanal fixo.", StatusCodes.BAD_REQUEST);
  }
  for (const entry of schedule) {
    if (!Number.isInteger(entry.weekday) || entry.weekday < 0 || entry.weekday > 6) {
      throw new AppError("Dia da semana inválido no horário fixo.", StatusCodes.BAD_REQUEST);
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.time)) {
      throw new AppError("Horário inválido no horário fixo (use HH:MM).", StatusCodes.BAD_REQUEST);
    }
  }
}

function zonedDateKeyAndWeekday(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dateKey: `${map.year}-${map.month}-${map.day}`, weekday: weekdayMap[map.weekday] };
}

function zonedDateTimeToUtc(dateKey: string, time: string, timeZone: string): Date {
  const naive = new Date(`${dateKey}T${time}:00`);
  const tzDate = new Date(naive.toLocaleString("en-US", { timeZone }));
  const utcDate = new Date(naive.toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetMs = utcDate.getTime() - tzDate.getTime();
  return new Date(naive.getTime() + offsetMs);
}

// Ocorrencias reais (no fuso do app) de cada dia/horario do horario fixo
// dentro do periodo do ciclo - gerado so quando o ciclo e capturado (nunca
// antecipado), entao nunca existe sessao "na agenda" sem cobranca por tras.
function computeCycleOccurrences(
  weeklySchedule: WeeklyScheduleEntry[],
  periodStart: Date,
  periodEnd: Date,
  minNoticeMs: number,
  timeZone: string
): Date[] {
  const occurrences: Date[] = [];
  const earliestAllowed = Date.now() + minNoticeMs;
  const cursor = new Date(periodStart);
  while (cursor < periodEnd) {
    const { dateKey, weekday } = zonedDateKeyAndWeekday(cursor, timeZone);
    for (const entry of weeklySchedule) {
      if (entry.weekday !== weekday) continue;
      const occurrence = zonedDateTimeToUtc(dateKey, entry.time, timeZone);
      if (occurrence >= periodStart && occurrence < periodEnd && occurrence.getTime() >= earliestAllowed) {
        occurrences.push(occurrence);
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return occurrences.sort((a, b) => a.getTime() - b.getTime());
}

function addCycles(start: Date, cycle: OfferBillingCycle, count: number): Date {
  const result = new Date(start);
  result.setDate(result.getDate() + billingCycleDurationDays(cycle) * count);
  return result;
}

function extractMpPixData(payment: Awaited<ReturnType<Payment["create"]>>) {
  const poi = payment.point_of_interaction as Record<string, unknown> | null | undefined;
  if (!poi) return null;
  const txData = poi["transaction_data"] as Record<string, unknown> | null | undefined;
  if (!txData) return null;
  return {
    qrCodeUrl: (txData["qr_code_base64"] as string | null) ?? null,
    copyAndPasteCode: (txData["qr_code"] as string | null) ?? null,
    hostedInstructionsUrl: (txData["ticket_url"] as string | null) ?? null
  };
}

async function resolveClientCardForBilling(clientId: string) {
  const client = await prisma.user.findUnique({
    where: { id: clientId },
    include: {
      customerPaymentMethods: {
        where: { isActive: true, funding: "CREDIT" },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
      }
    }
  });
  if (!client?.mpCustomerId) {
    throw new AppError("Cliente sem cadastro de pagamento configurado.", StatusCodes.BAD_REQUEST);
  }
  const selected = client.customerPaymentMethods[0];
  if (!selected) {
    throw new AppError("Nenhum cartão de crédito ativo encontrado para pagamento.", StatusCodes.BAD_REQUEST);
  }
  return {
    mpCustomerId: client.mpCustomerId,
    mpCardId: selected.mpCardId,
    clientEmail: client.email,
    clientName: client.name
  };
}

export class PresentialPackageService {
  async purchasePackage(clientId: string, input: PurchasePresentialPackageInput) {
    const offer = await prisma.providerServiceOffer.findFirst({
      where: { id: input.offerId, isActive: true },
      include: { provider: true }
    });
    if (!offer) {
      throw new AppError("Oferta não encontrada ou indisponível.", StatusCodes.NOT_FOUND);
    }
    if (offer.kind !== ServiceOfferKind.PRESENTIAL || !offer.presentialPackageMode) {
      throw new AppError("Esta oferta não é um pacote presencial.", StatusCodes.BAD_REQUEST);
    }
    if (offer.provider.userId === clientId) {
      throw new AppError("Você não pode comprar seu próprio pacote.", StatusCodes.UNPROCESSABLE_ENTITY);
    }
    if (!offer.provider.mpAccountId) {
      throw new AppError(
        "Este profissional ainda não configurou o recebimento de pagamentos.",
        StatusCodes.BAD_REQUEST
      );
    }
    if (offer.provider.crefValidationStatus !== CrefValidationStatus.APPROVED) {
      throw new AppError(
        "Este profissional ainda não está habilitado para novos agendamentos.",
        StatusCodes.BAD_REQUEST
      );
    }

    if (input.paymentMethod === ConsultancyPaymentMethod.DEBIT_CARD) {
      throw new AppError(
        "Pacotes presenciais não aceitam débito - use cartão de crédito ou Pix.",
        StatusCodes.BAD_REQUEST
      );
    }
    if (input.paymentMethod === ConsultancyPaymentMethod.PIX && !offer.acceptsPix) {
      throw new AppError("Este profissional não aceita Pix para este pacote.", StatusCodes.BAD_REQUEST);
    }
    if (input.paymentMethod === ConsultancyPaymentMethod.CREDIT_CARD && !offer.acceptsCreditCard) {
      throw new AppError(
        "Este profissional não aceita cartão de crédito para este pacote.",
        StatusCodes.BAD_REQUEST
      );
    }

    const category = await prisma.serviceCategory.findUnique({ where: { id: input.categoryId } });
    if (!category) {
      throw new AppError("Categoria inválida.", StatusCodes.BAD_REQUEST);
    }

    let weeklySchedule: WeeklyScheduleEntry[] | null = null;
    if (offer.presentialPackageMode === PresentialPackageMode.FIXED_RECURRING) {
      if (!input.weeklySchedule || input.weeklySchedule.length === 0) {
        throw new AppError("Informe o horário semanal fixo para este pacote.", StatusCodes.BAD_REQUEST);
      }
      validateWeeklySchedule(input.weeklySchedule);
      weeklySchedule = input.weeklySchedule;
    }

    const cycleAmountCents = offerEffectivePriceCents(offer);
    const sessionsPerCycle = offer.presentialSessionsPerCycle ?? 0;
    if (sessionsPerCycle <= 0) {
      throw new AppError("Oferta sem quantidade de sessões por ciclo configurada.", StatusCodes.BAD_REQUEST);
    }

    const existingActive = await prisma.presentialPackage.findFirst({
      where: {
        clientId,
        offerId: offer.id,
        status: {
          in: [
            PresentialPackageStatus.PENDING_PAYMENT,
            PresentialPackageStatus.ACTIVE,
            PresentialPackageStatus.PAST_DUE
          ]
        }
      }
    });
    if (existingActive) {
      throw new AppError(
        "Você já possui um pacote ativo (ou pendente) para esta oferta.",
        StatusCodes.CONFLICT
      );
    }

    const pkg = await prisma.presentialPackage.create({
      data: {
        providerId: offer.providerId,
        clientId,
        offerId: offer.id,
        categoryId: category.id,
        mode: offer.presentialPackageMode,
        status: PresentialPackageStatus.PENDING_PAYMENT,
        paymentMethod: input.paymentMethod,
        cycleAmountCents,
        billingCycle: offer.billingCycle,
        sessionsPerCycle,
        weeklySchedule: weeklySchedule ?? undefined,
        hasFixedTerm: offer.presentialHasFixedTerm,
        totalCycles: offer.presentialHasFixedTerm ? offer.presentialTotalCycles : null
      }
    });

    const chargeResult = await this.chargeCycle(pkg.id, { isFirstCycle: true });

    const updated = await prisma.presentialPackage.findUniqueOrThrow({
      where: { id: pkg.id },
      include: { offer: true }
    });

    return { package: updated, payment: chargeResult };
  }

  // Cobra um ciclo (a primeira, na compra, ou uma renovacao, via cron) -
  // mesmo mecanismo de split ja usado em booking/consultoria, so que
  // disparado periodicamente em vez de uma vez so. Nunca lanca em caso de
  // recusa/pendencia - o chamador confere o status devolvido, porque
  // recusa de renovacao nao e uma excecao no fluxo, e sim um estado normal
  // (PAST_DUE) que o cron/webhook resolvem depois.
  async chargeCycle(packageId: string, opts: { isFirstCycle: boolean }) {
    const pkg = await prisma.presentialPackage.findUniqueOrThrow({
      where: { id: packageId },
      include: { provider: true, client: true }
    });

    const cycleIndex = pkg.nextCycleIndex;
    const periodStart = opts.isFirstCycle ? new Date() : pkg.nextBillingAt ?? new Date();
    const periodEnd = addCycles(periodStart, pkg.billingCycle, 1);

    const providerAccessToken = await resolveProviderMpAccessToken(pkg.providerId);
    const split =
      providerAccessToken && pkg.provider.mpAccountId
        ? {
            collector: { id: Number(pkg.provider.mpAccountId) },
            marketplace_fee: platformFeeAmount(pkg.cycleAmountCents) / 100
          }
        : {};

    const metadata = {
      domain: "PRESENTIAL_PACKAGE",
      packageId: pkg.id,
      cycleIndex: String(cycleIndex)
    };

    let mpPay: Awaited<ReturnType<Payment["create"]>>;

    if (pkg.paymentMethod === ConsultancyPaymentMethod.PIX) {
      const pixExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const nameParts = pkg.client.name.split(" ");
      mpPay = await mpPaymentClient.create({
        body: {
          transaction_amount: pkg.cycleAmountCents / 100,
          payment_method_id: "pix",
          date_of_expiration: pixExpiresAt,
          payer: {
            email: pkg.client.email,
            first_name: nameParts[0],
            last_name: nameParts.slice(1).join(" ") || undefined
          },
          description: `Pacote presencial - ciclo ${cycleIndex}`,
          metadata,
          ...split
        },
        requestOptions: {
          idempotencyKey: `presential-package:${pkg.id}:cycle:${cycleIndex}`,
          ...(providerAccessToken ? { accessToken: providerAccessToken } : {})
        }
      });
    } else {
      const cardData = await resolveClientCardForBilling(pkg.clientId);
      const tokenResult = await mpCardTokenClient.create({
        body: { customer_id: cardData.mpCustomerId, card_id: cardData.mpCardId }
      });
      mpPay = await mpPaymentClient.create({
        body: {
          transaction_amount: pkg.cycleAmountCents / 100,
          token: String(tokenResult.id),
          installments: 1,
          payer: { type: "customer", id: cardData.mpCustomerId, email: cardData.clientEmail },
          description: `Pacote presencial - ciclo ${cycleIndex}`,
          metadata,
          ...split
        },
        requestOptions: {
          idempotencyKey: `presential-package:${pkg.id}:cycle:${cycleIndex}`,
          ...(providerAccessToken ? { accessToken: providerAccessToken } : {})
        }
      });
      if (!pkg.billingCardId) {
        await prisma.presentialPackage.update({
          where: { id: pkg.id },
          data: { billingCardId: cardData.mpCardId }
        });
      }
    }

    const mpStatus = mpPay.status;
    const mpPayId = String(mpPay.id);

    if (mpStatus === "approved") {
      await this.activateCycle(pkg.id, cycleIndex, periodStart, periodEnd, mpPayId, pkg.cycleAmountCents);
      await notificationService.sendToUsers([pkg.provider.userId], {
        preferenceType: "PAYMENTS",
        title: opts.isFirstCycle ? "Novo pacote presencial vendido" : "Ciclo do pacote renovado",
        body: `${pkg.client.name} - ciclo ${cycleIndex} confirmado.`,
        data: { type: "PRESENTIAL_PACKAGE_CYCLE_CAPTURED", packageId: pkg.id, cycleIndex }
      });
      return { status: "CAPTURED" as const };
    }

    if (pkg.paymentMethod === ConsultancyPaymentMethod.PIX && (mpStatus === "pending" || mpStatus === "in_process")) {
      const pixPayload = extractMpPixData(mpPay);
      await prisma.presentialPackage.update({
        where: { id: pkg.id },
        data: {
          status: PresentialPackageStatus.PAST_DUE,
          pendingChargeMpPaymentId: mpPayId,
          pendingChargePixQrCodeUrl: pixPayload?.qrCodeUrl ?? null,
          pendingChargePixCopyPasteCode: pixPayload?.copyAndPasteCode ?? null,
          pendingChargePixExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });
      if (!opts.isFirstCycle) {
        await notificationService.sendToUsers([pkg.client.id], {
          preferenceType: "PAYMENTS",
          title: "Renove seu pacote presencial",
          body: "Pague o Pix para manter seus agendamentos ativos.",
          data: { type: "PRESENTIAL_PACKAGE_RENEWAL_PIX_PENDING", packageId: pkg.id, cycleIndex }
        });
      }
      return { status: "PENDING" as const, method: "PIX" as const, pix: pixPayload };
    }

    if (opts.isFirstCycle) {
      throw new AppError("Pagamento do pacote não foi aprovado. Tente novamente.", StatusCodes.BAD_REQUEST);
    }

    const failedCount = pkg.consecutiveFailedCycles + 1;
    const shouldCancel = failedCount >= MAX_CONSECUTIVE_FAILED_CYCLES;
    await prisma.presentialPackage.update({
      where: { id: pkg.id },
      data: {
        status: shouldCancel ? PresentialPackageStatus.CANCELLED : PresentialPackageStatus.PAST_DUE,
        consecutiveFailedCycles: failedCount,
        lastBillingFailureReason: `Pagamento recusado (${mpStatus}).`,
        cancelledAt: shouldCancel ? new Date() : null
      }
    });
    await notificationService.sendToUsers([pkg.client.id], {
      preferenceType: "PAYMENTS",
      title: shouldCancel ? "Pacote presencial cancelado" : "Não conseguimos cobrar seu cartão",
      body: shouldCancel
        ? "Seu pacote presencial foi cancelado após várias tentativas de cobrança sem sucesso."
        : "Atualize seu cartão para manter seus agendamentos ativos.",
      data: { type: "PRESENTIAL_PACKAGE_RENEWAL_FAILED", packageId: pkg.id, cycleIndex }
    });
    await notificationService.sendToUsers([pkg.provider.userId], {
      preferenceType: "PAYMENTS",
      title: shouldCancel ? "Pacote presencial cancelado" : "Pagamento de aluno pendente",
      body: shouldCancel
        ? `O pacote de ${pkg.client.name} foi cancelado por falta de pagamento.`
        : `${pkg.client.name} está com pagamento pendente - agendamentos futuros pausados até normalizar.`,
      data: { type: "PRESENTIAL_PACKAGE_RENEWAL_FAILED", packageId: pkg.id, cycleIndex }
    });

    return { status: "FAILED" as const };
  }

  // Grava o ciclo pago (fonte de receita real pro Financeiro) e libera as
  // sessoes/creditos correspondentes - so acontece depois da cobranca
  // confirmada, nunca antes, entao nunca existe sessao paga que na verdade
  // nao foi cobrada.
  private async activateCycle(
    packageId: string,
    cycleIndex: number,
    periodStart: Date,
    periodEnd: Date,
    mpPaymentId: string,
    amountCents: number
  ) {
    const pkg = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: packageId } });
    const isFirstCycle = cycleIndex === 1;
    const validUntil =
      pkg.hasFixedTerm && pkg.totalCycles
        ? addCycles(isFirstCycle ? periodStart : pkg.validFrom ?? periodStart, pkg.billingCycle, pkg.totalCycles)
        : null;

    await prisma.$transaction(async (tx) => {
      await tx.presentialPackageCycle.create({
        data: {
          packageId,
          cycleIndex,
          amountCents,
          providerAmountCents: providerSplitAmount(amountCents),
          platformAmountCents: platformFeeAmount(amountCents),
          sessionsGranted: pkg.sessionsPerCycle,
          mpPaymentId,
          periodStart,
          periodEnd
        }
      });

      await tx.presentialPackage.update({
        where: { id: packageId },
        data: {
          status: PresentialPackageStatus.ACTIVE,
          nextCycleIndex: cycleIndex + 1,
          nextBillingAt: periodEnd,
          consecutiveFailedCycles: 0,
          lastBillingFailureReason: null,
          pendingChargeMpPaymentId: null,
          pendingChargePixQrCodeUrl: null,
          pendingChargePixCopyPasteCode: null,
          pendingChargePixExpiresAt: null,
          validFrom: isFirstCycle ? periodStart : pkg.validFrom,
          validUntil,
          creditsRemainingThisCycle:
            pkg.mode === PresentialPackageMode.FLEXIBLE_CREDITS ? pkg.sessionsPerCycle : 0
        }
      });

      if (pkg.mode === PresentialPackageMode.FIXED_RECURRING && pkg.weeklySchedule) {
        const schedule = pkg.weeklySchedule as unknown as WeeklyScheduleEntry[];
        const provider = await tx.providerProfile.findUniqueOrThrow({ where: { id: pkg.providerId } });
        const minNoticeMs = Math.max(24, provider.minBookingNoticeHours) * 60 * 60 * 1000;
        const occurrences = computeCycleOccurrences(
          schedule,
          periodStart,
          periodEnd,
          minNoticeMs,
          env.APP_TIMEZONE
        );

        for (const scheduledAt of occurrences) {
          const conflict = await tx.booking.findFirst({
            where: {
              providerId: pkg.providerId,
              scheduledAt,
              status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] }
            }
          });
          if (conflict) continue;

          await tx.booking.create({
            data: {
              clientId: pkg.clientId,
              providerId: pkg.providerId,
              categoryId: pkg.categoryId,
              packageId: pkg.id,
              scheduledAt,
              priceCents: 0,
              status: BookingStatus.CONFIRMED
            }
          });
        }
      }
    });
  }
}
