import {
  BookingStatus,
  ConsultancyContractStatus,
  ConsultancyPaymentMethod,
  ConsultancyPaymentStatus,
  ConsultancyRequestStatus,
  CrefValidationStatus,
  OfferBillingCycle,
  PaymentMethod,
  PresentialPackageMode,
  PresentialPackageStatus,
  ServiceOfferKind
} from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import * as Sentry from "@sentry/node";
import { Payment, CardToken, PaymentRefund } from "mercadopago";
import { env } from "../../../config/env";
import { prisma } from "../../../config/prisma";
import { mp } from "../../../config/mercadopago";
import { AppError } from "../../../shared/errors/app-error";
import { platformFeeAmount, providerSplitAmount } from "../../../shared/utils/platform-fee";
import { resolveProviderMpAccessToken, requireProviderMpAccessToken } from "../../../shared/utils/mp-provider-account";
import { billingCycleDurationDays } from "../../../shared/utils/consultancy-validity";
import { NotificationService } from "../../notifications/services/notification.service";
import { DebtService } from "../../payments/services/debt.service";
import { haversineKm } from "../../../shared/utils/geo";
// PaymentService é importado dinamicamente onde é usado (não no topo do
// arquivo) porque payment.service.ts também importa PresentialPackageService
// — import estático dos dois lados cria dependência circular na inicialização
// dos módulos (mesmo problema já resolvido assim com gamification-events).

const notificationService = new NotificationService();
const debtService = new DebtService();
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
  acknowledgedImmediateExecution?: boolean;
  sessionLocation?: string;
  clientLatitude?: number;
  clientLongitude?: number;
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

// Frente C (liberdade de ofertas): mesma checagem de distancia que a sessao
// avulsa ja faz (booking.service.ts) - so aplica quando o local nao e um
// dos locais fixos do profissional (nesse caso o cliente e quem se desloca,
// nao precisa validar nada). Decidido uma vez na compra do pacote, aplicado
// a cada sessao gerada dali pra frente.
async function resolveSessionLocationForPackage(
  provider: {
    fixedLocations: unknown;
    serviceRadiusKm: number | null;
    latitude: number | null;
    longitude: number | null;
  },
  sessionLocation: string | undefined,
  clientLatitude: number | undefined,
  clientLongitude: number | undefined
) {
  if (!sessionLocation) {
    return { sessionLocation: null as string | null, clientLatitude: null as number | null, clientLongitude: null as number | null };
  }

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

  return {
    sessionLocation,
    clientLatitude: !isFixedLocation ? clientLatitude ?? null : null,
    clientLongitude: !isFixedLocation ? clientLongitude ?? null : null
  };
}

export class PresentialPackageService {

  async purchasePackage(clientId: string, input: PurchasePresentialPackageInput) {
    await debtService.assertNoOutstandingDebt(clientId);

    const offer = await prisma.providerServiceOffer.findFirst({
      where: { id: input.offerId, isActive: true },
      include: { provider: { include: { user: { select: { suspendedAt: true } } } } }
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
    if (offer.provider.user.suspendedAt) {
      throw new AppError("Este profissional não está disponível para novas compras no momento.", StatusCodes.BAD_REQUEST);
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

    // Horário fixo pago em cartão: valida o cartão do cliente já na compra
    // (falha rápido e com mensagem clara, em vez de deixar pra descobrir só
    // quando a primeira sessão tentar reservar o valor, dias depois).
    const isCardFixedRecurring =
      offer.presentialPackageMode === PresentialPackageMode.FIXED_RECURRING &&
      input.paymentMethod === ConsultancyPaymentMethod.CREDIT_CARD;
    const billingCardId = isCardFixedRecurring
      ? (await resolveClientCardForBilling(clientId)).mpCardId
      : null;

    const resolvedLocation = await resolveSessionLocationForPackage(
      offer.provider,
      input.sessionLocation,
      input.clientLatitude,
      input.clientLongitude
    );

    // Raio-X de pagamentos, Rodada 3, Lote 7: "já existe um pacote ativo?"
    // rodava fora de transação, sem trava — dois cliques quase simultâneos
    // passavam os dois pela checagem antes de qualquer um criar o pacote,
    // e cada clique gera seu próprio idempotencyKey (chargeCycle usa
    // pkg.id), então a MP cobrava as duas vezes de verdade. Mesmo idioma de
    // advisory lock já usado com segurança em booking.service.ts::create —
    // lock e liberação na mesma transação/conexão (nunca cruza chamadas
    // separadas, que é o padrão provado inseguro com o pool do Prisma).
    const lockKey = `presential-package:${clientId}:${offer.id}`;
    const pkg = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      const existingActive = await tx.presentialPackage.findFirst({
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

      return tx.presentialPackage.create({
        data: {
          providerId: offer.providerId,
          clientId,
          offerId: offer.id,
          categoryId: category.id,
          // Narrowing de "offer.presentialPackageMode não é null" (checado
          // no início da função) não atravessa o closure da transação —
          // TypeScript não retém isso pra acesso de propriedade aninhado.
          mode: offer.presentialPackageMode!,
          status: PresentialPackageStatus.PENDING_PAYMENT,
          paymentMethod: input.paymentMethod,
          cycleAmountCents,
          billingCycle: offer.billingCycle,
          sessionsPerCycle,
          weeklySchedule: weeklySchedule ?? undefined,
          sessionLocation: resolvedLocation.sessionLocation,
          clientLatitude: resolvedLocation.clientLatitude,
          clientLongitude: resolvedLocation.clientLongitude,
          hasFixedTerm: offer.presentialHasFixedTerm,
          totalCycles: offer.presentialHasFixedTerm ? offer.presentialTotalCycles : null,
          billingCardId
        }
      });
    });

    // Horário fixo em cartão: nenhuma cobrança de ciclo — cada sessão vira
    // sua própria reserva, no mesmo motor de pagamento da sessão avulsa (ver
    // activateCardFixedPeriod). Créditos flexíveis (Frente D): nenhuma
    // cobrança na compra, em cartão ou Pix — pacote fechado de sessões
    // avulsas, cada uma cobrada individualmente quando o aluno agenda (ver
    // activateFlexibleSessionPack e booking.service.ts), pelo mesmo motor
    // de pagamento avulso comum (que já aceita os dois métodos por sessão).
    const chargeResult = isCardFixedRecurring
      ? await this.activateCardFixedPeriod(pkg.id, { isFirstPeriod: true })
      : offer.presentialPackageMode === PresentialPackageMode.FLEXIBLE_CREDITS
        ? await this.activateFlexibleSessionPack(pkg.id)
        : await this.chargeCycle(pkg.id, { isFirstCycle: true });

    const updated = await prisma.presentialPackage.findUniqueOrThrow({
      where: { id: pkg.id },
      include: { offer: true }
    });

    return { package: updated, payment: chargeResult };
  }

  // Frente D (liberdade de ofertas): pacote de sessões avulsas (créditos
  // flexíveis redesenhado) - um bloco fechado de N sessões com validade,
  // sem nenhuma cobrança adiantada. O pacote já nasce ativo; cada sessão
  // que o aluno agendar (booking.service.ts, via packageId) é cobrada
  // individualmente na hora (mesmo motor da sessão avulsa comum) e consome
  // uma vaga do total contratado. Sem sessão agendada, sem cobrança - e
  // sem renovação: quando a validade vence ou as sessões acabam, encerra
  // sozinho (não é mais uma assinatura recorrente).
  private async activateFlexibleSessionPack(packageId: string) {
    const pkg = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: packageId } });
    const now = new Date();
    const validUntil = addCycles(now, pkg.billingCycle, pkg.totalCycles ?? 1);

    await prisma.presentialPackage.update({
      where: { id: packageId },
      data: {
        status: PresentialPackageStatus.ACTIVE,
        validFrom: now,
        validUntil,
        creditsRemainingThisCycle: pkg.sessionsPerCycle,
        nextBillingAt: null
      }
    });

    return { status: "READY" as const, sessionsAvailable: pkg.sessionsPerCycle };
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

    // Raio-X de pagamentos, Rodada 2, Lote 1: nunca cobra sem split
    // resolvido. Na 1a cobrança (compra interativa, cliente esperando na
    // tela) falha alto e claro antes de tentar. Numa renovação via cron
    // (sem cliente na tela), não faz sentido lançar — pula a tentativa de
    // cobrança sem split e trata como ciclo falho (mesmo caminho de
    // pagamento recusado), notificando o profissional pra reconectar em vez
    // do aviso genérico de "pagamento recusado".
    const providerAccessToken = opts.isFirstCycle
      ? await requireProviderMpAccessToken(pkg.providerId)
      : await resolveProviderMpAccessToken(pkg.providerId);
    const providerTokenMissing = !providerAccessToken;

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

    let mpPay: Awaited<ReturnType<Payment["create"]>> | null = null;

    if (!providerTokenMissing && pkg.paymentMethod === ConsultancyPaymentMethod.PIX) {
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
          ...{ accessToken: providerAccessToken as string }
        }
      });
    } else if (!providerTokenMissing) {
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
          ...{ accessToken: providerAccessToken as string }
        }
      });
      if (!pkg.billingCardId) {
        await prisma.presentialPackage.update({
          where: { id: pkg.id },
          data: { billingCardId: cardData.mpCardId }
        });
      }
    }

    const mpStatus = mpPay?.status ?? "provider_disconnected";
    const mpPayId = mpPay ? String(mpPay.id) : null;

    if (mpStatus === "approved" && mpPayId) {
      await this.activateCycle(pkg.id, cycleIndex, periodStart, periodEnd, mpPayId, pkg.cycleAmountCents);
      await notificationService.sendToUsers([pkg.provider.userId], {
        preferenceType: "PAYMENTS",
        title: opts.isFirstCycle ? "Novo pacote presencial vendido" : "Ciclo do pacote renovado",
        body: `${pkg.client.name} - ciclo ${cycleIndex} confirmado.`,
        data: { type: "PRESENTIAL_PACKAGE_CYCLE_CAPTURED", packageId: pkg.id, cycleIndex }
      });
      return { status: "CAPTURED" as const };
    }

    if (mpPay && pkg.paymentMethod === ConsultancyPaymentMethod.PIX && (mpStatus === "pending" || mpStatus === "in_process")) {
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
        lastBillingFailureReason: providerTokenMissing
          ? "Conexão do profissional com o Mercado Pago precisa ser reconectada."
          : `Pagamento recusado (${mpStatus}).`,
        cancelledAt: shouldCancel ? new Date() : null,
        nextBillingAt: shouldCancel ? pkg.nextBillingAt : new Date(Date.now() + CARD_RETRY_THROTTLE_MS)
      }
    });
    await notificationService.sendToUsers([pkg.client.id], {
      preferenceType: "PAYMENTS",
      title: shouldCancel ? "Pacote presencial cancelado" : "Não conseguimos cobrar seu cartão",
      body: shouldCancel
        ? "Seu pacote presencial foi cancelado após várias tentativas de cobrança sem sucesso."
        : providerTokenMissing
          ? "Aguardando o profissional resolver uma pendência com o Mercado Pago para renovar seu pacote."
          : "Atualize seu cartão para manter seus agendamentos ativos.",
      data: { type: "PRESENTIAL_PACKAGE_RENEWAL_FAILED", packageId: pkg.id, cycleIndex }
    });
    await notificationService.sendToUsers([pkg.provider.userId], {
      preferenceType: "PAYMENTS",
      title: shouldCancel
        ? "Pacote presencial cancelado"
        : providerTokenMissing
          ? "Reconecte sua conta Mercado Pago"
          : "Pagamento de aluno pendente",
      body: shouldCancel
        ? `O pacote de ${pkg.client.name} foi cancelado por falta de pagamento.`
        : providerTokenMissing
          ? `Não conseguimos cobrar o ciclo de ${pkg.client.name} porque sua conexão com o Mercado Pago precisa ser refeita. Acesse Recebimentos para reconectar.`
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
          // Reseta pra que o lembrete da próxima cobrança (Rodada 4, Lote 11)
          // dispare de novo no ciclo seguinte, e não só uma vez na vida do pacote.
          billingReminderSentAt: null,
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
              sessionLocation: pkg.sessionLocation,
              status: BookingStatus.CONFIRMED
            }
          });
        }
      }
    });
  }

  // Horário fixo pago em cartão: nenhuma cobrança de ciclo acontece aqui —
  // cada sessão do período vira um agendamento de verdade, com sua própria
  // reserva de valor (o mesmo motor de pré-autorização + captura que a
  // sessão avulsa já usa, via createPendingForBooking). O registro de ciclo
  // vira só um marcador de "sessões deste período já foram geradas", sem
  // nenhum valor de pagamento associado — não existe mais uma cobrança
  // única pra falhar ou pra reembolsar.
  private async activateCardFixedPeriod(packageId: string, opts: { isFirstPeriod: boolean }) {
    const pkg = await prisma.presentialPackage.findUniqueOrThrow({
      where: { id: packageId },
      include: { provider: true }
    });

    const cycleIndex = pkg.nextCycleIndex;
    const periodStart = opts.isFirstPeriod ? new Date() : pkg.nextBillingAt ?? new Date();
    const periodEnd = addCycles(periodStart, pkg.billingCycle, 1);
    const isFirstCycle = cycleIndex === 1;
    const validUntil =
      pkg.hasFixedTerm && pkg.totalCycles
        ? addCycles(isFirstCycle ? periodStart : pkg.validFrom ?? periodStart, pkg.billingCycle, pkg.totalCycles)
        : null;

    // Preço por sessão: o valor do "ciclo" dividido pelas sessões previstas
    // — cada sessão é cobrada de forma independente, então não existe mais
    // a obrigação de a soma bater exatamente com o valor anunciado do
    // ciclo (diferença de arredondamento é normal em preço por unidade).
    const perSessionPriceCents = Math.max(1, Math.round(pkg.cycleAmountCents / pkg.sessionsPerCycle));

    const { PaymentService } = await import("../../payments/services/payment.service");
    const paymentService = new PaymentService();

    let generatedCount = 0;

    await prisma.$transaction(async (tx) => {
      await tx.presentialPackageCycle.create({
        data: {
          packageId,
          cycleIndex,
          sessionsGranted: pkg.sessionsPerCycle,
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
          // Reseta pra que o lembrete da próxima cobrança (Rodada 4, Lote 11)
          // dispare de novo no ciclo seguinte, e não só uma vez na vida do pacote.
          billingReminderSentAt: null,
          consecutiveFailedCycles: 0,
          lastBillingFailureReason: null,
          validFrom: isFirstCycle ? periodStart : pkg.validFrom,
          validUntil
        }
      });

      const schedule = pkg.weeklySchedule as unknown as WeeklyScheduleEntry[];
      const minNoticeMs = Math.max(24, pkg.provider.minBookingNoticeHours) * 60 * 60 * 1000;
      const occurrences = computeCycleOccurrences(schedule, periodStart, periodEnd, minNoticeMs, env.APP_TIMEZONE);

      for (const scheduledAt of occurrences) {
        const conflict = await tx.booking.findFirst({
          where: {
            providerId: pkg.providerId,
            scheduledAt,
            status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] }
          }
        });
        if (conflict) continue;

        const booking = await tx.booking.create({
          data: {
            clientId: pkg.clientId,
            providerId: pkg.providerId,
            categoryId: pkg.categoryId,
            packageId: pkg.id,
            scheduledAt,
            priceCents: perSessionPriceCents,
            sessionLocation: pkg.sessionLocation,
            status: BookingStatus.CONFIRMED
          }
        });
        await paymentService.createPendingForBooking(
          tx,
          booking.id,
          perSessionPriceCents,
          "BRL",
          PaymentMethod.CREDIT_CARD,
          pkg.billingCardId
        );
        generatedCount += 1;
      }
    });

    await notificationService.sendToUsers([pkg.provider.userId], {
      preferenceType: "PAYMENTS",
      title: opts.isFirstPeriod ? "Novo pacote presencial vendido" : "Próximo período do pacote agendado",
      body: `${generatedCount} sessão(ões) agendada(s) — cada uma será cobrada individualmente perto da data.`,
      data: { type: "PRESENTIAL_PACKAGE_PERIOD_SCHEDULED", packageId: pkg.id, cycleIndex }
    }).catch((error) => console.error("Presential package period notification failed:", error));

    return { status: "SCHEDULED" as const, sessionsScheduled: generatedCount };
  }

  // Job periodico (payment-jobs.ts): cobra o proximo ciclo de cada pacote
  // cuja data de cobranca ja chegou. Nao reentra num pacote que ja tem uma
  // cobranca pendente em aberto (Pix aguardando pagamento) - essa so volta
  // a ser candidata depois que expireStalePendingPixCharges liberar.
  // Horario fixo pago em cartao NAO passa por aqui — ver
  // generateDueCardFixedPeriods — EXCETO a metade presencial de um combo
  // (consultancyContractId preenchido), que sempre usa chargeCycle desde a
  // 1a cobranca (purchaseCombo nao tem a mesma ramificacao isCardFixedRecurring
  // que purchasePackage tem). Raio-X Rodada 2, Lote 4: antes desse ajuste, os
  // dois filtros eram baseados só em mode+paymentMethod (idênticos pros dois
  // casos), então um combo trocava de motor de cobrança sozinho a partir do
  // 2º ciclo — cobrado de uma vez no 1º, por sessão a partir do 2º.
  async chargeDueCycles() {
    const now = new Date();
    const candidates = await prisma.presentialPackage.findMany({
      where: {
        status: { in: [PresentialPackageStatus.ACTIVE, PresentialPackageStatus.PAST_DUE] },
        nextBillingAt: { lte: now },
        pendingChargeMpPaymentId: null,
        // Raio-X de pagamentos, Rodada 5, Lote 2: profissional suspenso nao
        // pode continuar faturando com alunos ja contratados so porque o
        // pacote ja estava ativo antes da suspensao.
        provider: { user: { suspendedAt: null } },
        OR: [
          { NOT: { mode: PresentialPackageMode.FIXED_RECURRING, paymentMethod: ConsultancyPaymentMethod.CREDIT_CARD } },
          { consultancyContractId: { not: null } }
        ]
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
        Sentry.captureException(error, { tags: { area: "presential-package" }, extra: { packageId: candidate.id, phase: "charge_due_cycles" } });
      }
    }
  }

  // Job periodico (payment-jobs.ts): gera o proximo periodo de sessoes dos
  // pacotes de horario fixo pagos em cartao — sem cobrar nada aqui, cada
  // sessao gerada ja nasce com sua propria reserva (ver activateCardFixedPeriod).
  // consultancyContractId: null exclui a metade presencial de combo, que
  // segue sempre por chargeDueCycles/chargeCycle (ver comentário lá).
  async generateDueCardFixedPeriods() {
    const now = new Date();
    const candidates = await prisma.presentialPackage.findMany({
      where: {
        status: PresentialPackageStatus.ACTIVE,
        mode: PresentialPackageMode.FIXED_RECURRING,
        paymentMethod: ConsultancyPaymentMethod.CREDIT_CARD,
        consultancyContractId: null,
        nextBillingAt: { lte: now },
        provider: { user: { suspendedAt: null } }
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
        await this.activateCardFixedPeriod(candidate.id, { isFirstPeriod: false });
      } catch (error) {
        console.error(`[presential-package] generateDueCardFixedPeriods falhou para ${candidate.id}:`, error);
        Sentry.captureException(error, { tags: { area: "presential-package" }, extra: { packageId: candidate.id, phase: "generate_due_card_fixed_periods" } });
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

  // Pacote de sessoes avulsas (FLEXIBLE_CREDITS): avisa 3 dias antes da
  // validade acabar, e marca EXPIRED quando passa - sem isso, o pacote
  // ficava aparecendo como "ativo" pra sempre mesmo depois de vencido,
  // e o cliente so descobria na hora de tentar agendar (ver raio-x de
  // pagamentos, Lote 3). Mesmo padrao do lembrete de ficha de consultoria.
  async sendFlexibleSessionPackExpiryReminders(referenceDate = new Date()) {
    const soon = new Date(referenceDate.getTime() + 3 * 24 * 60 * 60 * 1000);

    const expiringSoon = await prisma.presentialPackage.findMany({
      where: {
        mode: PresentialPackageMode.FLEXIBLE_CREDITS,
        status: PresentialPackageStatus.ACTIVE,
        validUntil: { gte: referenceDate, lte: soon },
        expiryReminderSentAt: null
      }
    });
    for (const pkg of expiringSoon) {
      await notificationService.sendToUsers([pkg.clientId], {
        preferenceType: "PAYMENTS",
        title: "Seu pacote de sessões está vencendo",
        body: `Seu pacote com ${pkg.creditsRemainingThisCycle} sessão(ões) restante(s) vence em breve — agende antes que a validade acabe.`,
        data: { type: "PRESENTIAL_PACKAGE_EXPIRING", packageId: pkg.id }
      });
      await prisma.presentialPackage.update({
        where: { id: pkg.id },
        data: { expiryReminderSentAt: new Date() }
      });
    }

    const expired = await prisma.presentialPackage.findMany({
      where: {
        mode: PresentialPackageMode.FLEXIBLE_CREDITS,
        status: PresentialPackageStatus.ACTIVE,
        validUntil: { lt: referenceDate }
      }
    });
    for (const pkg of expired) {
      await prisma.presentialPackage.update({
        where: { id: pkg.id },
        data: { status: PresentialPackageStatus.EXPIRED }
      });
      await notificationService.sendToUsers([pkg.clientId], {
        preferenceType: "PAYMENTS",
        title: "Seu pacote de sessões venceu",
        body: pkg.creditsRemainingThisCycle > 0
          ? `Seu pacote venceu com ${pkg.creditsRemainingThisCycle} sessão(ões) ainda não usada(s).`
          : "Seu pacote de sessões venceu.",
        data: { type: "PRESENTIAL_PACKAGE_EXPIRED", packageId: pkg.id }
      });
    }
  }

  // Raio-X de pagamentos, Rodada 4, Lote 11: mesmo padrão do lembrete de
  // vencimento de créditos (acima) — aqui pra avisar antes da próxima
  // cobrança automática de um pacote recorrente (FIXED_RECURRING), que hoje
  // só acontecia sem aviso nenhum ao cliente.
  async sendPresentialPackageBillingReminders(referenceDate = new Date()) {
    const soon = new Date(referenceDate.getTime() + 3 * 24 * 60 * 60 * 1000);

    const dueSoon = await prisma.presentialPackage.findMany({
      where: {
        mode: PresentialPackageMode.FIXED_RECURRING,
        status: PresentialPackageStatus.ACTIVE,
        nextBillingAt: { gte: referenceDate, lte: soon },
        billingReminderSentAt: null
      }
    });
    for (const pkg of dueSoon) {
      await notificationService.sendToUsers([pkg.clientId], {
        preferenceType: "PAYMENTS",
        title: "Próxima cobrança do seu pacote está chegando",
        body: `Sua próxima cobrança de ${(pkg.cycleAmountCents / 100).toFixed(2).replace(".", ",")} será processada em breve.`,
        data: { type: "PRESENTIAL_PACKAGE_BILLING_DUE_SOON", packageId: pkg.id }
      });
      await prisma.presentialPackage.update({
        where: { id: pkg.id },
        data: { billingReminderSentAt: new Date() }
      });
    }
  }

  // Cancelar a assinatura e 100% local (nunca existe uma cobranca "em
  // aberto" na MP pra revogar - so paramos de gerar cobrancas futuras).
  // Sessoes ja geradas no ciclo atual (ja pago) continuam valendo - so o
  // proximo ciclo nao acontece. Se quem cancela e o profissional, nao e
  // culpa do cliente: reembolsa o ciclo mais recente (regra do desenho -
  // "profissional cancela, a qualquer momento -> reembolso total, sempre").
  async cancelPackage(userId: string, packageId: string, notify: boolean = true) {
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

    const isCardFixedRecurring =
      pkg.mode === PresentialPackageMode.FIXED_RECURRING && pkg.paymentMethod === ConsultancyPaymentMethod.CREDIT_CARD;
    // Créditos flexíveis (Frente D): mesmo caso do horário fixo em cartão —
    // cada sessão já é cobrada individualmente, nunca existe "ciclo pago
    // adiantado" pra reembolsar, só sessões futuras já agendadas (se houver)
    // pra liberar.
    const isFlexibleSessionPack = pkg.mode === PresentialPackageMode.FLEXIBLE_CREDITS;

    let refundFailed = false;
    let releasedFutureSessions = 0;
    if (isCardFixedRecurring || isFlexibleSessionPack) {
      // Nada foi pago adiantado — não existe "último ciclo" pra reembolsar.
      // Cancela as sessões futuras já geradas (cada uma libera sua própria
      // reserva ou estorna, se já tiver sido capturada). Mesma regra das 2h
      // já usada no cancelamento de sessão avulsa: se foi o profissional quem
      // cancelou o pacote, o cliente nunca perde dinheiro; se foi o cliente
      // quem cancelou e uma sessão específica está a menos de 2h, essa sessão
      // é cobrada normalmente (o profissional já reservou aquele horário) —
      // sem essa checagem, cancelar o pacote inteiro seria um jeito de
      // burlar a proteção que já existe pra sessão avulsa isolada.
      const { PaymentService } = await import("../../payments/services/payment.service");
      const paymentService = new PaymentService();
      const futureSessions = await prisma.booking.findMany({
        where: {
          packageId: pkg.id,
          status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
          scheduledAt: { gt: new Date() }
        },
        select: { id: true, scheduledAt: true }
      });
      for (const session of futureSessions) {
        const hoursUntilSession = (session.scheduledAt.getTime() - Date.now()) / (60 * 60 * 1000);
        if (isProvider || hoursUntilSession >= 2) {
          await paymentService.cancelPaymentForBooking(session.id);
        } else {
          await paymentService.captureIfAuthorizedForBookingOrDispute(
            session.id,
            "Cliente cancelou o pacote presencial com uma sessão a menos de 2h — profissional mantém o valor desta sessão."
          );
        }
        await prisma.booking.update({ where: { id: session.id }, data: { status: BookingStatus.CANCELLED } });
        releasedFutureSessions += 1;
      }
    } else if (isProvider) {
      const lastCycle = await prisma.presentialPackageCycle.findFirst({
        where: { packageId: pkg.id },
        orderBy: { cycleIndex: "desc" }
      });
      if (lastCycle?.mpPaymentId) {
        try {
          await mpRefundClient.create({ payment_id: lastCycle.mpPaymentId, body: {} });
        } catch (error) {
          console.error(`[presential-package] refund do ciclo ${lastCycle.id} falhou:`, error);
          Sentry.captureException(error, { tags: { area: "presential-package" }, extra: { cycleId: lastCycle.id, phase: "cycle_refund_failed" } });
          refundFailed = true;
          await prisma.disputeCase.create({
            data: {
              type: "REFUND_FAILED",
              clientId: pkg.clientId,
              providerId: pkg.providerId,
              amountCents: lastCycle.amountCents ?? 0,
              mpPaymentId: lastCycle.mpPaymentId,
              presentialPackageId: pkg.id,
              presentialPackageCycleId: lastCycle.id,
              contextNote: "Reembolso automático falhou ao cancelar pacote presencial (cancelamento pelo profissional)."
            }
          });
        }
      }
      // O ciclo já foi pago de uma vez (Pix) e as sessões da semana já tinham
      // sido geradas de graça a partir dele — se o profissional cancela no
      // meio do ciclo, essas sessões futuras não podem continuar
      // "confirmadas" como se nada tivesse mudado.
      await prisma.booking.updateMany({
        where: {
          packageId: pkg.id,
          status: BookingStatus.CONFIRMED,
          scheduledAt: { gt: new Date() }
        },
        data: { status: BookingStatus.CANCELLED }
      });
    }

    if (notify) {
      await notificationService.sendToUsers([pkg.clientId], {
        preferenceType: "PAYMENTS",
        title: "Pacote presencial cancelado",
        body: isCardFixedRecurring || isFlexibleSessionPack
          ? releasedFutureSessions > 0
            ? `Pacote cancelado — ${releasedFutureSessions} sessão(ões) futura(s) foram desmarcadas e nenhuma delas será cobrada.`
            : "Seu pacote presencial foi cancelado."
          : isProvider
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
    }

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
    // Raio-X de pagamentos, Rodada 2, Lote 5: purchaseCombo era o único
    // fluxo de compra sem essa checagem — um cliente com pendência
    // financeira em aberto (ex: reembolso que falhou e virou dívida)
    // conseguia comprar um combo normalmente, furando a trava anti-calote
    // que já existe em purchasePackage, booking avulso e consultoria.
    await debtService.assertNoOutstandingDebt(clientId);

    const offer = await prisma.providerServiceOffer.findFirst({
      where: { id: input.offerId, isActive: true },
      include: { provider: { include: { user: { select: { suspendedAt: true } } } } }
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
    if (offer.provider.user.suspendedAt) {
      throw new AppError("Este profissional não está disponível para novas compras no momento.", StatusCodes.BAD_REQUEST);
    }
    if (input.acknowledgedImmediateExecution !== true) {
      // Mesma base legal do fluxo de consultoria avulsa (art. 49 do CDC) — a
      // metade de consultoria do combo também exige consentimento expresso
      // ao início imediato do atendimento.
      throw new AppError(
        "É necessário confirmar a ciência sobre o início imediato do atendimento de consultoria para contratar o combo.",
        StatusCodes.BAD_REQUEST
      );
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

    const resolvedComboLocation = await resolveSessionLocationForPackage(
      offer.provider,
      input.sessionLocation,
      input.clientLatitude,
      input.clientLongitude
    );

    // Raio-X de pagamentos, Rodada 3, Lote 7: mesmo problema (e mesma
    // correção) de purchasePackage — "já existe um combo ativo?" rodava
    // fora de transação, sem trava, e dois cliques quase simultâneos
    // passavam os dois antes de qualquer um reservar a vaga. Aqui a
    // reserva precisa acontecer JÁ (criando o pacote presencial ainda sem
    // consultancyContractId, ligado depois) porque o resto do fluxo — criar
    // o contrato de consultoria e cobrar a parte de consultoria de verdade
    // no Mercado Pago — só deve rodar depois que a vaga estiver garantida.
    const lockKey = `presential-package:${clientId}:${offer.id}`;
    const pkg = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      const existingActive = await tx.presentialPackage.findFirst({
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

      return tx.presentialPackage.create({
        data: {
          providerId: offer.providerId,
          clientId,
          offerId: offer.id,
          categoryId: category.id,
          // Mesmo caso de purchasePackage: narrowing não atravessa o
          // closure da transação.
          mode: offer.presentialPackageMode!,
          status: PresentialPackageStatus.PENDING_PAYMENT,
          paymentMethod: input.paymentMethod,
          cycleAmountCents: offer.comboPresentialShareCents!,
          billingCycle: offer.billingCycle,
          sessionsPerCycle,
          weeklySchedule: weeklySchedule ?? undefined,
          sessionLocation: resolvedComboLocation.sessionLocation,
          clientLatitude: resolvedComboLocation.clientLatitude,
          clientLongitude: resolvedComboLocation.clientLongitude,
          hasFixedTerm: offer.presentialHasFixedTerm,
          totalCycles: offer.presentialHasFixedTerm ? offer.presentialTotalCycles : null
        }
      });
    });

    const now = new Date();
    const deliveryDeadlineAt = new Date(
      now.getTime() + env.CONSULTANCY_DELIVERY_DEADLINE_HOURS * 60 * 60 * 1000
    );

    // Raio-X de pagamentos, Rodada 4, Lote 1: se essa transação falhar
    // (conexão caiu, deadlock, etc.) depois que o pacote presencial já foi
    // reservado acima, o pacote ficava órfão em PENDING_PAYMENT — e o guard
    // de "já existe um pacote ativo" bloqueava qualquer nova tentativa de
    // compra sem o cliente saber que precisava cancelar esse registro
    // fantasma primeiro. Cancela automaticamente o pacote recém-reservado
    // (nada foi cobrado ainda nesse ponto) antes de relançar o erro, pra
    // uma segunda tentativa funcionar de cara.
    let contract: Awaited<ReturnType<typeof prisma.consultancyContract.create>>;
    try {
      contract = await prisma.$transaction(async (tx) => {
        const request = await tx.consultancyRequest.create({
          data: {
            providerId: offer.providerId,
            clientId,
            status: ConsultancyRequestStatus.RESPONDED,
            quotedOfferId: offer.id,
            // Combo pula direto pra RESPONDED (nao ha etapa de solicitacao
            // em aberto aguardando o profissional) - o prazo de resposta
            // nao se aplica aqui, so precisa de um valor nao-nulo.
            responseDeadlineAt: now,
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
            deliveryDeadlineAt,
            immediateExecutionAcknowledgedAt: now
          }
        });
      });
    } catch (error) {
      // notify: false — o cliente nunca recebeu confirmação de que esse
      // pacote tinha sido criado (o combo falhou antes de qualquer sucesso),
      // então notificar "cancelado" aqui só confundiria sobre algo que, do
      // ponto de vista dele, nunca existiu.
      await this.cancelPackage(clientId, pkg.id, false).catch((cancelError) =>
        console.error("Falha ao cancelar pacote órfão após erro na criação do contrato do combo:", cancelError)
      );
      const message = error instanceof Error ? error.message : "Falha ao criar o contrato de consultoria do combo.";
      throw new AppError(message, StatusCodes.BAD_REQUEST);
    }

    // Liga o pacote presencial (já reservado acima, antes de qualquer
    // cobrança) ao contrato de consultoria recém-criado.
    await prisma.presentialPackage.update({
      where: { id: pkg.id },
      data: { consultancyContractId: contract.id }
    });

    let consultancyPaymentResult:
      | { status: "CAPTURED" }
      | { status: "AUTHORIZED" }
      | { status: "PENDING"; pix: unknown };
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

    // Metade presencial: pacote já reservado e linkado ao contrato acima,
    // agora cobra o primeiro ciclo com o mesmo mecanismo de sempre
    // (chargeCycle). Se essa parte falhar, a consultoria (ja cobrada acima)
    // NAO e revertida automaticamente - devolvemos os dois resultados pro
    // chamador deixar claro pro cliente exatamente o que foi confirmado e
    // o que precisa ser tentado de novo, em vez de mascarar um sucesso
    // parcial como falha total.
    let presentialPaymentResult: { status: "CAPTURED" | "PENDING" | "FAILED" | "READY" } = { status: "FAILED" };
    try {
      presentialPaymentResult =
        offer.presentialPackageMode === PresentialPackageMode.FLEXIBLE_CREDITS
          ? await this.activateFlexibleSessionPack(pkg.id)
          : await this.chargeCycle(pkg.id, { isFirstCycle: true });
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
    const providerAccessToken = await requireProviderMpAccessToken(providerId);
    const provider = await prisma.providerProfile.findUniqueOrThrow({
      where: { id: providerId },
      select: { mpAccountId: true }
    });
    const split = provider.mpAccountId
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
          ...{ accessToken: providerAccessToken }
        }
      });
    } else {
      const cardData = await resolveClientCardForBilling(clientId);
      const tokenResult = await mpCardTokenClient.create({
        body: { customer_id: cardData.mpCustomerId, card_id: cardData.mpCardId }
      });
      // capture:false — mesma lógica da consultoria avulsa: reserva o valor,
      // só cobra de verdade quando a primeira ficha for entregue.
      mpPay = await mpPaymentClient.create({
        body: {
          transaction_amount: amountCents / 100,
          token: String(tokenResult.id),
          installments: 1,
          payer: { type: "customer", id: cardData.mpCustomerId, email: cardData.clientEmail },
          description: "Combo - consultoria online",
          capture: false,
          metadata,
          ...split
        },
        requestOptions: {
          idempotencyKey: `combo:${contractId}:consultancy:card`,
          ...{ accessToken: providerAccessToken }
        }
      });
    }

    const mpStatus = mpPay.status;
    const mpPayId = String(mpPay.id);

    if (mpStatus === "approved") {
      // MP capturou na hora mesmo com capture:false pedido (ex.: débito).
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

    if (mpStatus === "authorized") {
      await prisma.consultancyContract.update({
        where: { id: contractId },
        data: {
          mpPaymentId: mpPayId,
          paymentStatus: ConsultancyPaymentStatus.AUTHORIZED,
          status: ConsultancyContractStatus.ACTIVE
        }
      });
      return { status: "AUTHORIZED" as const };
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
