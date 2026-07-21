import {
  BookingStatus,
  ConsultancyContractStatus,
  ConsultancyPaymentMethod,
  ConsultancyPaymentStatus,
  ConsultancyRequestStatus,
  CrefValidationStatus,
  OfferBillingCycle,
  PresentialPackageMode,
  PresentialPackageStatus,
  ServiceOfferKind
} from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { Payment, CardToken, PaymentRefund } from "mercadopago";
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
const mpRefundClient = new PaymentRefund(mp);

// Depois de N ciclos seguidos sem conseguir cobrar (cartao recusado, ou Pix
// de renovacao expirado sem pagamento), o pacote cancela sozinho - ninguem
// fica com uma assinatura fantasma pendurada pra sempre.
const MAX_CONSECUTIVE_FAILED_CYCLES = 3;

// Depois de uma cobranca de renovacao recusada, so tenta de novo no
// proximo dia - evita martelar o cartao do cliente a cada rodada do cron
// e da tempo real pra ele notar o aviso e trocar o cartao.
const CARD_RETRY_THROTTLE_MS = 24 * 60 * 60 * 1000;

// Cobranca Pix de renovacao expira em 24h sem pagamento manual - o cron
// (Fase 2.3) fecha esse ciclo como falho e libera uma cobranca nova.
const PIX_RENEWAL_EXPIRATION_MS = 24 * 60 * 60 * 1000;

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
          idempotencyKey: `presential-package:${pkg.id}:cycle:${cycleIndex}:attempt:${pkg.consecutiveFailedCycles}`,
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
          idempotencyKey: `presential-package:${pkg.id}:cycle:${cycleIndex}:attempt:${pkg.consecutiveFailedCycles}`,
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
          // nextBillingAt guarda o periodStart deste ciclo pendente (o
          // cliente pode pagar o Pix horas depois) - o webhook usa esse
          // valor pra ativar o ciclo na janela certa quando confirmar.
          nextBillingAt: periodStart,
          pendingChargeMpPaymentId: mpPayId,
          pendingChargePixQrCodeUrl: pixPayload?.qrCodeUrl ?? null,
          pendingChargePixCopyPasteCode: pixPayload?.copyAndPasteCode ?? null,
          pendingChargePixExpiresAt: new Date(Date.now() + PIX_RENEWAL_EXPIRATION_MS)
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
        cancelledAt: shouldCancel ? new Date() : null,
        nextBillingAt: shouldCancel ? pkg.nextBillingAt : new Date(Date.now() + CARD_RETRY_THROTTLE_MS)
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

  // Job periodico (payment-jobs.ts): cobra o proximo ciclo de cada pacote
  // cuja data de cobranca ja chegou. Nao reentra num pacote que ja tem uma
  // cobranca pendente em aberto (Pix aguardando pagamento) - essa so volta
  // a ser candidata depois que expireStalePendingPixCharges liberar.
  async chargeDueCycles() {
    const now = new Date();
    const candidates = await prisma.presentialPackage.findMany({
      where: {
        status: { in: [PresentialPackageStatus.ACTIVE, PresentialPackageStatus.PAST_DUE] },
        nextBillingAt: { lte: now },
        pendingChargeMpPaymentId: null
      },
      select: { id: true, hasFixedTerm: true, totalCycles: true, nextCycleIndex: true }
    });

    for (const candidate of candidates) {
      try {
        if (candidate.hasFixedTerm && candidate.totalCycles && candidate.nextCycleIndex > candidate.totalCycles) {
          await prisma.presentialPackage.update({
            where: { id: candidate.id },
            data: { status: PresentialPackageStatus.EXPIRED }
          });
          continue;
        }
        await this.chargeCycle(candidate.id, { isFirstCycle: false });
      } catch (error) {
        console.error(`[presential-package] chargeDueCycles falhou para ${candidate.id}:`, error);
      }
    }
  }

  // Job periodico: fecha cobrancas Pix de renovacao que expiraram sem
  // pagamento manual (o cliente nao pagou o QR/copia-e-cola a tempo) -
  // conta como ciclo falho (mesma regra de cancelamento apos N falhas) e
  // libera o pacote pra uma cobranca Pix nova no proximo tick do cron.
  async expireStalePendingPixCharges() {
    const now = new Date();
    const stale = await prisma.presentialPackage.findMany({
      where: {
        status: PresentialPackageStatus.PAST_DUE,
        pendingChargeMpPaymentId: { not: null },
        pendingChargePixExpiresAt: { lt: now }
      },
      include: { client: true, provider: true }
    });

    for (const pkg of stale) {
      try {
        const failedCount = pkg.consecutiveFailedCycles + 1;
        const shouldCancel = failedCount >= MAX_CONSECUTIVE_FAILED_CYCLES;
        await prisma.presentialPackage.update({
          where: { id: pkg.id },
          data: {
            status: shouldCancel ? PresentialPackageStatus.CANCELLED : PresentialPackageStatus.PAST_DUE,
            consecutiveFailedCycles: failedCount,
            lastBillingFailureReason: "Pix de renovação expirou sem pagamento.",
            cancelledAt: shouldCancel ? new Date() : null,
            pendingChargeMpPaymentId: null,
            pendingChargePixQrCodeUrl: null,
            pendingChargePixCopyPasteCode: null,
            pendingChargePixExpiresAt: null
          }
        });
        await notificationService.sendToUsers([pkg.client.id], {
          preferenceType: "PAYMENTS",
          title: shouldCancel ? "Pacote presencial cancelado" : "Pix de renovação expirou",
          body: shouldCancel
            ? "Seu pacote presencial foi cancelado após várias renovações sem pagamento."
            : "O Pix da renovação expirou sem pagamento. Uma nova cobrança será gerada em breve.",
          data: { type: "PRESENTIAL_PACKAGE_RENEWAL_PIX_EXPIRED", packageId: pkg.id }
        });
        await notificationService.sendToUsers([pkg.provider.userId], {
          preferenceType: "PAYMENTS",
          title: shouldCancel ? "Pacote presencial cancelado" : "Renovação de aluno pendente",
          body: shouldCancel
            ? `O pacote de ${pkg.client.name} foi cancelado por falta de pagamento.`
            : `${pkg.client.name} não pagou o Pix de renovação a tempo.`,
          data: { type: "PRESENTIAL_PACKAGE_RENEWAL_PIX_EXPIRED", packageId: pkg.id }
        });
      } catch (error) {
        console.error(`[presential-package] expireStalePendingPixCharges falhou para ${pkg.id}:`, error);
      }
    }
  }

  // Chamado pelo webhook do Mercado Pago quando um Pix pendente (renovacao
  // ou primeiro ciclo) e confirmado de forma assincrona - cartao nunca
  // passa por aqui, porque a resposta do cartao ja e sincrona em
  // chargeCycle. Retorna false se o pagamento nao pertence a nenhum
  // pacote (o webhook trata isso como "nao e desse dominio").
  async confirmPendingPixCycle(mpPaymentId: string) {
    const pkg = await prisma.presentialPackage.findFirst({
      where: { pendingChargeMpPaymentId: mpPaymentId },
      select: {
        id: true,
        nextCycleIndex: true,
        nextBillingAt: true,
        billingCycle: true,
        cycleAmountCents: true,
        client: { select: { id: true, name: true } },
        provider: { select: { userId: true } }
      }
    });
    if (!pkg || !pkg.nextBillingAt) return false;

    const periodStart = pkg.nextBillingAt;
    const periodEnd = addCycles(periodStart, pkg.billingCycle, 1);
    await this.activateCycle(pkg.id, pkg.nextCycleIndex, periodStart, periodEnd, mpPaymentId, pkg.cycleAmountCents);

    await notificationService.sendToUsers([pkg.client.id], {
      preferenceType: "PAYMENTS",
      title: "Pagamento do pacote confirmado",
      body: "Seu Pix foi confirmado e as sessões deste ciclo já estão liberadas.",
      data: { type: "PRESENTIAL_PACKAGE_CYCLE_CAPTURED", packageId: pkg.id }
    });
    await notificationService.sendToUsers([pkg.provider.userId], {
      preferenceType: "PAYMENTS",
      title: "Pix de aluno confirmado",
      body: `Pagamento de ${pkg.client.name} confirmado - ciclo liberado.`,
      data: { type: "PRESENTIAL_PACKAGE_CYCLE_CAPTURED", packageId: pkg.id }
    });
    return true;
  }

  // Cancelar a assinatura e 100% local (nunca existe uma cobranca "em
  // aberto" na MP pra revogar - so paramos de gerar cobrancas futuras).
  // Sessoes ja geradas no ciclo atual (ja pago) continuam valendo - so o
  // proximo ciclo nao acontece. Se quem cancela e o profissional, nao e
  // culpa do cliente: reembolsa o ciclo mais recente (regra do desenho -
  // "profissional cancela, a qualquer momento -> reembolso total, sempre").
  async cancelPackage(userId: string, packageId: string) {
    const pkg = await prisma.presentialPackage.findUnique({
      where: { id: packageId },
      include: { client: true, provider: { include: { user: true } } }
    });
    if (!pkg) {
      throw new AppError("Pacote não encontrado.", StatusCodes.NOT_FOUND);
    }

    const isClient = pkg.clientId === userId;
    const isProvider = pkg.provider.userId === userId;
    if (!isClient && !isProvider) {
      throw new AppError("Você não tem permissão para cancelar este pacote.", StatusCodes.FORBIDDEN);
    }

    if (
      pkg.status === PresentialPackageStatus.CANCELLED ||
      pkg.status === PresentialPackageStatus.EXPIRED
    ) {
      throw new AppError("Este pacote já não está mais ativo.", StatusCodes.BAD_REQUEST);
    }

    await prisma.presentialPackage.update({
      where: { id: pkg.id },
      data: {
        status: PresentialPackageStatus.CANCELLED,
        cancelledAt: new Date(),
        nextBillingAt: null,
        pendingChargeMpPaymentId: null,
        pendingChargePixQrCodeUrl: null,
        pendingChargePixCopyPasteCode: null,
        pendingChargePixExpiresAt: null
      }
    });

    let refundFailed = false;
    if (isProvider) {
      const lastCycle = await prisma.presentialPackageCycle.findFirst({
        where: { packageId: pkg.id },
        orderBy: { cycleIndex: "desc" }
      });
      if (lastCycle?.mpPaymentId) {
        try {
          await mpRefundClient.create({ payment_id: lastCycle.mpPaymentId, body: {} });
        } catch (error) {
          console.error(`[presential-package] refund do ciclo ${lastCycle.id} falhou:`, error);
          refundFailed = true;
          await prisma.disputeCase.create({
            data: {
              type: "REFUND_FAILED",
              clientId: pkg.clientId,
              providerId: pkg.providerId,
              amountCents: lastCycle.amountCents,
              mpPaymentId: lastCycle.mpPaymentId,
              presentialPackageId: pkg.id,
              presentialPackageCycleId: lastCycle.id,
              contextNote: "Reembolso automático falhou ao cancelar pacote presencial (cancelamento pelo profissional)."
            }
          });
        }
      }
    }

    await notificationService.sendToUsers([pkg.clientId], {
      preferenceType: "PAYMENTS",
      title: "Pacote presencial cancelado",
      body: isProvider
        ? refundFailed
          ? "O profissional cancelou seu pacote presencial. Houve uma falha ao processar o reembolso do ciclo mais recente — nossa equipe já foi avisada e vai resolver manualmente."
          : "O profissional cancelou seu pacote presencial. O ciclo mais recente foi reembolsado."
        : "Seu pacote presencial foi cancelado. As sessões já pagas neste ciclo continuam valendo.",
      data: { type: "PRESENTIAL_PACKAGE_CANCELLED", packageId: pkg.id }
    });
    await notificationService.sendToUsers([pkg.provider.userId], {
      preferenceType: "PAYMENTS",
      title: "Pacote presencial cancelado",
      body: isClient
        ? `${pkg.client.name} cancelou o pacote presencial.`
        : "Você cancelou o pacote presencial do aluno.",
      data: { type: "PRESENTIAL_PACKAGE_CANCELLED", packageId: pkg.id }
    });

    return prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
  }

  async listMyPackages(clientId: string) {
    return prisma.presentialPackage.findMany({
      where: { clientId },
      include: {
        offer: true,
        provider: { select: { displayName: true, photoUrl: true } }
      },
      orderBy: { createdAt: "desc" }
    });
  }

  async listProviderPackages(userId: string) {
    const provider = await prisma.providerProfile.findFirst({ where: { userId } });
    if (!provider) {
      throw new AppError("Perfil profissional não encontrado.", StatusCodes.NOT_FOUND);
    }
    return prisma.presentialPackage.findMany({
      where: { providerId: provider.id },
      include: {
        offer: true,
        client: { select: { name: true, photoUrl: true } }
      },
      orderBy: { createdAt: "desc" }
    });
  }

  async getPackageById(userId: string, packageId: string) {
    const pkg = await prisma.presentialPackage.findUnique({
      where: { id: packageId },
      include: {
        offer: true,
        provider: { include: { user: { select: { id: true } } } },
        client: { select: { id: true, name: true, photoUrl: true } },
        cycles: { orderBy: { cycleIndex: "desc" } }
      }
    });
    if (!pkg) {
      throw new AppError("Pacote não encontrado.", StatusCodes.NOT_FOUND);
    }
    if (pkg.clientId !== userId && pkg.provider.user.id !== userId) {
      throw new AppError("Você não tem permissão para ver este pacote.", StatusCodes.FORBIDDEN);
    }
    return pkg;
  }

  // Combo = ConsultancyContract (pagamento unico, mesmo mecanismo de
  // sempre) + PresentialPackage (cobranca por ciclo, mesmo mecanismo de
  // sempre) criados juntos e linkados - mas cada lado cancela independente
  // (ver cancelPackage / ConsultancyService, cada um cuida do seu). O
  // profissional declara o valor de cada metade na criacao da oferta
  // (comboPresentialShareCents/comboConsultancyShareCents), entao aqui nao
  // ha ambiguidade de quanto cobrar de cada lado.
  //
  // Nao reaproveita ConsultancyService.decideRequest porque aquele sempre
  // cobra o preco cheio da oferta - o combo precisa cobrar so a fatia da
  // consultoria. Em vez disso, cria a ConsultancyRequest/Contract direto
  // (ja "respondida e aceita" - nao ha negociacao pra combo comprado
  // direto) e cobra com a mesma logica de split ja usada em todo o resto.
  async purchaseCombo(clientId: string, input: PurchasePresentialPackageInput) {
    const offer = await prisma.providerServiceOffer.findFirst({
      where: { id: input.offerId, isActive: true },
      include: { provider: true }
    });
    if (!offer) {
      throw new AppError("Oferta não encontrada ou indisponível.", StatusCodes.NOT_FOUND);
    }
    if (offer.kind !== ServiceOfferKind.COMBO || !offer.presentialPackageMode) {
      throw new AppError("Esta oferta não é um combo presencial + consultoria.", StatusCodes.BAD_REQUEST);
    }
    if (!offer.comboPresentialShareCents || !offer.comboConsultancyShareCents) {
      throw new AppError(
        "Esta oferta combo não tem os valores de cada parte configurados.",
        StatusCodes.BAD_REQUEST
      );
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
        "Combo não aceita débito - use cartão de crédito ou Pix.",
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
        throw new AppError(
          "Informe o horário semanal fixo para o lado presencial do combo.",
          StatusCodes.BAD_REQUEST
        );
      }
      validateWeeklySchedule(input.weeklySchedule);
      weeklySchedule = input.weeklySchedule;
    }

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
        "Você já possui um combo ativo (ou pendente) para esta oferta.",
        StatusCodes.CONFLICT
      );
    }

    const now = new Date();
    const deliveryDeadlineAt = new Date(
      now.getTime() + env.CONSULTANCY_DELIVERY_DEADLINE_DAYS * 24 * 60 * 60 * 1000
    );

    const contract = await prisma.$transaction(async (tx) => {
      const request = await tx.consultancyRequest.create({
        data: {
          providerId: offer.providerId,
          clientId,
          status: ConsultancyRequestStatus.RESPONDED,
          quotedOfferId: offer.id,
          respondedAt: now
        }
      });
      return tx.consultancyContract.create({
        data: {
          requestId: request.id,
          providerId: offer.providerId,
          clientId,
          offerId: offer.id,
          status: ConsultancyContractStatus.PENDING_PAYMENT,
          paymentMethod: input.paymentMethod,
          paymentInstallments: 1,
          paymentStatus: ConsultancyPaymentStatus.PENDING,
          paymentAmountCents: offer.comboConsultancyShareCents!,
          providerAmountCents: providerSplitAmount(offer.comboConsultancyShareCents!),
          platformAmountCents: platformFeeAmount(offer.comboConsultancyShareCents!),
          deliveryDeadlineAt
        }
      });
    });

    let consultancyPaymentResult: { status: "CAPTURED" } | { status: "PENDING"; pix: unknown };
    try {
      consultancyPaymentResult = await this.chargeComboConsultancy(
        contract.id,
        offer.providerId,
        clientId,
        input.paymentMethod,
        offer.comboConsultancyShareCents!
      );
    } catch (error) {
      await prisma.consultancyContract.update({
        where: { id: contract.id },
        data: { paymentStatus: ConsultancyPaymentStatus.FAILED }
      });
      const message =
        error instanceof Error ? error.message : "Falha ao processar pagamento da consultoria do combo.";
      throw new AppError(message, StatusCodes.BAD_REQUEST);
    }

    // Metade presencial: pacote linkado ao contrato, cobra o primeiro ciclo
    // com o mesmo mecanismo de sempre (chargeCycle). Se essa parte falhar,
    // a consultoria (ja cobrada acima) NAO e revertida automaticamente -
    // devolvemos os dois resultados pro chamador deixar claro pro cliente
    // exatamente o que foi confirmado e o que precisa ser tentado de novo,
    // em vez de mascarar um sucesso parcial como falha total.
    const pkg = await prisma.presentialPackage.create({
      data: {
        providerId: offer.providerId,
        clientId,
        offerId: offer.id,
        categoryId: category.id,
        consultancyContractId: contract.id,
        mode: offer.presentialPackageMode,
        status: PresentialPackageStatus.PENDING_PAYMENT,
        paymentMethod: input.paymentMethod,
        cycleAmountCents: offer.comboPresentialShareCents!,
        billingCycle: offer.billingCycle,
        sessionsPerCycle,
        weeklySchedule: weeklySchedule ?? undefined,
        hasFixedTerm: offer.presentialHasFixedTerm,
        totalCycles: offer.presentialHasFixedTerm ? offer.presentialTotalCycles : null
      }
    });

    let presentialPaymentResult: { status: "CAPTURED" | "PENDING" | "FAILED" } = { status: "FAILED" };
    try {
      presentialPaymentResult = await this.chargeCycle(pkg.id, { isFirstCycle: true });
    } catch {
      presentialPaymentResult = { status: "FAILED" };
    }

    const updatedContract = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    const updatedPackage = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });

    return {
      contract: updatedContract,
      package: updatedPackage,
      consultancyPayment: consultancyPaymentResult,
      presentialPayment: presentialPaymentResult
    };
  }

  private async chargeComboConsultancy(
    contractId: string,
    providerId: string,
    clientId: string,
    paymentMethod: ConsultancyPaymentMethod,
    amountCents: number
  ) {
    const providerAccessToken = await resolveProviderMpAccessToken(providerId);
    const provider = await prisma.providerProfile.findUniqueOrThrow({
      where: { id: providerId },
      select: { mpAccountId: true }
    });
    const split =
      providerAccessToken && provider.mpAccountId
        ? {
            collector: { id: Number(provider.mpAccountId) },
            marketplace_fee: platformFeeAmount(amountCents) / 100
          }
        : {};
    const metadata = { domain: "COMBO_CONSULTANCY", contractId };

    let mpPay: Awaited<ReturnType<Payment["create"]>>;

    if (paymentMethod === ConsultancyPaymentMethod.PIX) {
      const client = await prisma.user.findUniqueOrThrow({
        where: { id: clientId },
        select: { email: true, name: true }
      });
      const nameParts = client.name.split(" ");
      const pixExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      mpPay = await mpPaymentClient.create({
        body: {
          transaction_amount: amountCents / 100,
          payment_method_id: "pix",
          date_of_expiration: pixExpiresAt,
          payer: {
            email: client.email,
            first_name: nameParts[0],
            last_name: nameParts.slice(1).join(" ") || undefined
          },
          description: "Combo - consultoria online",
          metadata,
          ...split
        },
        requestOptions: {
          idempotencyKey: `combo:${contractId}:consultancy:pix`,
          ...(providerAccessToken ? { accessToken: providerAccessToken } : {})
        }
      });
    } else {
      const cardData = await resolveClientCardForBilling(clientId);
      const tokenResult = await mpCardTokenClient.create({
        body: { customer_id: cardData.mpCustomerId, card_id: cardData.mpCardId }
      });
      mpPay = await mpPaymentClient.create({
        body: {
          transaction_amount: amountCents / 100,
          token: String(tokenResult.id),
          installments: 1,
          payer: { type: "customer", id: cardData.mpCustomerId, email: cardData.clientEmail },
          description: "Combo - consultoria online",
          metadata,
          ...split
        },
        requestOptions: {
          idempotencyKey: `combo:${contractId}:consultancy:card`,
          ...(providerAccessToken ? { accessToken: providerAccessToken } : {})
        }
      });
    }

    const mpStatus = mpPay.status;
    const mpPayId = String(mpPay.id);

    if (mpStatus === "approved") {
      await prisma.consultancyContract.update({
        where: { id: contractId },
        data: {
          mpPaymentId: mpPayId,
          paymentStatus: ConsultancyPaymentStatus.CAPTURED,
          paymentCapturedAt: new Date(),
          status: ConsultancyContractStatus.ACTIVE
        }
      });
      return { status: "CAPTURED" as const };
    }

    if (paymentMethod === ConsultancyPaymentMethod.PIX && (mpStatus === "pending" || mpStatus === "in_process")) {
      const pixPayload = extractMpPixData(mpPay);
      await prisma.consultancyContract.update({
        where: { id: contractId },
        data: { mpPaymentId: mpPayId, paymentStatus: ConsultancyPaymentStatus.PENDING }
      });
      return { status: "PENDING" as const, pix: pixPayload };
    }

    throw new AppError("Pagamento da consultoria (combo) não foi aprovado.", StatusCodes.BAD_REQUEST);
  }
}
