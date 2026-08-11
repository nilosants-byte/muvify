import {
  ConsultancyContractStatus,
  CrefValidationStatus,
  ConsultancyPaymentMethod,
  ConsultancyPaymentStatus,
  ConsultancyRequestStatus,
  OfferBillingCycle,
  Prisma,
  PresentialPackageMode,
  ProviderServiceMode,
  ServiceOfferKind,
  UserRole
} from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import * as Sentry from "@sentry/node";
import { env } from "../../../config/env";
import { prisma } from "../../../config/prisma";
import { assertEmailVerified } from "../../../shared/utils/email-verification";
import { assertAnamnesisCompleted } from "../../../shared/utils/anamnesis-required";
import { mp } from "../../../config/mercadopago";
import { AppError } from "../../../shared/errors/app-error";
import { platformFeeAmount, providerSplitAmount } from "../../../shared/utils/platform-fee";
import { toProviderPhotoUrl } from "../../../shared/utils/photo-url";
import { requireProviderMpAccessToken } from "../../../shared/utils/mp-provider-account";
import { consultancyValidUntil } from "../../../shared/utils/consultancy-validity";
import { NotificationService } from "../../notifications/services/notification.service";
import { DebtService } from "../../payments/services/debt.service";
import { Payment, CardToken, PaymentRefund } from "mercadopago";
import { PUBLIC_PROVIDER_SELECT } from "../../providers/services/provider.service";

function startOfTodayInSaoPaulo(): Date {
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  return new Date(`${dateKey}T00:00:00-03:00`);
}

const BASE_PRICE_UPDATE_COOLDOWN_DAYS = 30;
const BASE_PRICE_UPDATE_COOLDOWN_MS =
  BASE_PRICE_UPDATE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

// Épico de Frentes, Frente 6 (Ofertas do profissional), Lote 1: telas do
// cliente reusavam `include` no contrato/provider, vazando
// mpAccessToken/mpRefreshToken do profissional e o split financeiro
// interno (providerAmountCents/platformAmountCents/mpPaymentId/mpRefundId)
// do próprio contrato — mesma classe de bug já corrigida em favorites na
// Frente 5 Lote 1, mas que passou batida aqui.
const CLIENT_SAFE_CONTRACT_SELECT = {
  id: true,
  requestId: true,
  providerId: true,
  clientId: true,
  offerId: true,
  status: true,
  paymentMethod: true,
  paymentInstallments: true,
  paymentStatus: true,
  paymentAmountCents: true,
  paymentCapturedAt: true,
  paymentCanceledAt: true,
  deliveryDeadlineAt: true,
  immediateExecutionAcknowledgedAt: true,
  deliveredAt: true,
  refundedAt: true,
  refundReason: true,
  // Frente 6, Lote 2: snapshot congelado no momento da compra — não é
  // sensível, e é isso que consultancyValidUntil() deve ler (nunca mais
  // contract.offer.billingCycle ao vivo).
  billingCycle: true,
  kind: true,
  fichaValidityDays: true,
  createdAt: true,
  updatedAt: true
} as const;

const onlineOfferKinds: ServiceOfferKind[] = [
  ServiceOfferKind.ONLINE_CONSULTANCY,
  ServiceOfferKind.ONLINE_CONSULTANCY_SPECIALIZED,
  ServiceOfferKind.COMBO
];

type OfferInput = {
  kind: ServiceOfferKind;
  title: string;
  billingCycle: OfferBillingCycle;
  daysPerWeek?: number | null;
  comboPresentialDaysPerWeek?: number | null;
  comboOnlineDaysPerWeek?: number | null;
  priceCents: number;
  isPromotion?: boolean;
  promotionPriceCents?: number | null;
  promotionEndsAt?: string | Date | null;
  promotionLabel?: string | null;
  acceptsPix?: boolean;
  acceptsDebitCard?: boolean;
  acceptsCreditCard?: boolean;
  isActive?: boolean;
  presentialPackageMode?: PresentialPackageMode | null;
  presentialHasFixedTerm?: boolean;
  presentialTotalCycles?: number | null;
  presentialSessionsPerCycle?: number | null;
  comboPresentialShareCents?: number | null;
  comboConsultancyShareCents?: number | null;
  fichaValidityDays?: number | null;
  offerServiceMode?: ProviderServiceMode | null;
};

type ExerciseInput = {
  sortOrder?: number;
  exerciseId?: string;
  name: string;
  repetitionsSets: string;
  load: string;
  restSeconds?: number;
  restLabel?: string;
  demoVideoUrl?: string;
};

const notificationService = new NotificationService();
const debtService = new DebtService();

function providerAmountFrom(priceCents: number) {
  return providerSplitAmount(priceCents);
}

function platformAmountFrom(priceCents: number) {
  return platformFeeAmount(priceCents);
}

function itemKindLabel(kind: ServiceOfferKind) {
  if (kind === ServiceOfferKind.PRESENTIAL) return "Aulas presenciais";
  if (kind === ServiceOfferKind.ONLINE_CONSULTANCY) return "Consultoria on-line";
  if (kind === ServiceOfferKind.COMBO) return "Combo - Presencial + Consultoria on-line";
  return "Consultoria on-line especializada";
}

function billingCycleLabel(cycle: OfferBillingCycle) {
  if (cycle === OfferBillingCycle.DAILY) return "diario";
  if (cycle === OfferBillingCycle.WEEKLY) return "semanal";
  if (cycle === OfferBillingCycle.MONTHLY) return "mensal";
  if (cycle === OfferBillingCycle.QUARTERLY) return "trimestral";
  if (cycle === OfferBillingCycle.SEMIANNUAL) return "semestral";
  return "anual";
}

function mapConsultancyMethodToFunding(method: ConsultancyPaymentMethod) {
  if (method === ConsultancyPaymentMethod.CREDIT_CARD) {
    return "CREDIT";
  }
  if (method === ConsultancyPaymentMethod.DEBIT_CARD) {
    return "DEBIT";
  }
  return null;
}

const mpPaymentClient = new Payment(mp);
const mpCardTokenClient = new CardToken(mp);
const mpRefundClient = new PaymentRefund(mp);

const MP_STATUS_APPROVED = "approved";
const MP_STATUS_PENDING = "pending";
const MP_STATUS_IN_PROCESS = "in_process";
const CREF_APPROVAL_REQUIRED_MESSAGE =
  "Esta funcionalidade ficará disponível quando seu CREF for aprovado.";

function extractMpPixData(payment: Awaited<ReturnType<Payment["get"]>>) {
  const poi = payment.point_of_interaction as Record<string, unknown> | null | undefined;
  if (!poi) return null;
  const txData = poi["transaction_data"] as Record<string, unknown> | null | undefined;
  if (!txData) return null;
  return {
    qrCodeUrl: (txData["qr_code_base64"] as string | null) ?? null,
    copyAndPasteCode: (txData["qr_code"] as string | null) ?? null,
    hostedInstructionsUrl: (txData["ticket_url"] as string | null) ?? null,
    expiresAt: null
  };
}

export class ConsultancyService {
  private parseDateOrThrow(
    value: string | Date | null | undefined,
    fieldLabel: string
  ): Date | null | undefined {
    if (typeof value === "undefined") return undefined;
    if (value === null) return null;

    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new AppError(`${fieldLabel} inválida.`, StatusCodes.BAD_REQUEST);
    }

    return parsed;
  }

  private isOfferPromotionActive(offer: {
    isPromotion: boolean;
    promotionPriceCents: number | null;
    promotionEndsAt: Date | null;
    priceCents: number;
  }) {
    if (!offer.isPromotion) return false;
    if (!offer.promotionPriceCents || !offer.promotionEndsAt) return false;
    if (offer.promotionPriceCents >= offer.priceCents) return false;
    return offer.promotionEndsAt.getTime() > Date.now();
  }

  private offerEffectivePriceCents(offer: {
    isPromotion: boolean;
    promotionPriceCents: number | null;
    promotionEndsAt: Date | null;
    priceCents: number;
  }) {
    if (this.isOfferPromotionActive(offer)) {
      return offer.promotionPriceCents!;
    }

    return offer.priceCents;
  }

  private hasFrontAndBackCrefDocuments(profile: {
    credentialDocuments?: Prisma.JsonValue;
  }) {
    if (!Array.isArray(profile.credentialDocuments)) return false;
    const front = profile.credentialDocuments[0] as { uri?: unknown } | undefined;
    const back = profile.credentialDocuments[1] as { uri?: unknown } | undefined;
    const frontUri = typeof front?.uri === "string" ? front.uri.trim() : "";
    const backUri = typeof back?.uri === "string" ? back.uri.trim() : "";
    return Boolean(frontUri) && Boolean(backUri);
  }

  private ensureProviderCrefApproved(
    profile: {
      crefValidationStatus?: CrefValidationStatus | null;
    },
    errorMessage: string
  ) {
    if (profile.crefValidationStatus !== CrefValidationStatus.APPROVED) {
      throw new AppError(errorMessage, StatusCodes.BAD_REQUEST);
    }
  }

  private async resolveClientPaymentData(
    clientId: string,
    paymentMethod: ConsultancyPaymentMethod
  ) {
    const client = await prisma.user.findUnique({
      where: { id: clientId },
      include: {
        customerPaymentMethods: {
          where: { isActive: true },
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
        }
      }
    });

    if (!client || !client.mpCustomerId) {
      throw new AppError("Cliente sem cadastro de pagamento configurado.", StatusCodes.BAD_REQUEST);
    }

    if (paymentMethod === ConsultancyPaymentMethod.PIX) {
      return { mpCustomerId: client.mpCustomerId, mpCardId: null as string | null, clientEmail: client.email, clientName: client.name };
    }

    const requiredFunding = mapConsultancyMethodToFunding(paymentMethod);
    const preferred = client.customerPaymentMethods.find(
      (item) =>
        item.mpCardId === client.mpDefaultCardId &&
        (!requiredFunding || item.funding === requiredFunding || item.funding === null)
    );
    const fallback = client.customerPaymentMethods.find(
      (item) => !requiredFunding || item.funding === requiredFunding || item.funding === null
    );
    const selected = preferred ?? fallback;

    if (!selected) {
      throw new AppError(
        paymentMethod === ConsultancyPaymentMethod.DEBIT_CARD
          ? "Nenhum cartao de debito ativo encontrado para pagamento."
          : "Nenhum cartao de credito ativo encontrado para pagamento.",
        StatusCodes.BAD_REQUEST
      );
    }

    return { mpCustomerId: client.mpCustomerId, mpCardId: selected.mpCardId, clientEmail: client.email, clientName: client.name };
  }

  private async createConsultancyMpPayment(input: {
    requestId: string;
    contractId: string;
    providerId: string;
    clientId: string;
    paymentMethod: ConsultancyPaymentMethod;
    amountCents: number;
  }) {
    const paymentData = await this.resolveClientPaymentData(input.clientId, input.paymentMethod);
    const nameParts = paymentData.clientName.split(" ");

    const provider = await prisma.providerProfile.findUnique({
      where: { id: input.providerId },
      select: { mpAccountId: true }
    });
    const providerAccessToken = await requireProviderMpAccessToken(input.providerId);
    const split = provider?.mpAccountId
      ? {
          collector: { id: Number(provider.mpAccountId) },
          marketplace_fee: platformFeeAmount(input.amountCents) / 100
        }
      : {};

    const metadata = {
      domain: "CONSULTANCY",
      requestId: input.requestId,
      contractId: input.contractId,
      clientId: input.clientId,
      consultancyPaymentMethod: input.paymentMethod
    };

    if (input.paymentMethod === ConsultancyPaymentMethod.PIX) {
      const pixExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      return mpPaymentClient.create({
        body: {
          transaction_amount: input.amountCents / 100,
          payment_method_id: "pix",
          date_of_expiration: pixExpiresAt,
          payer: {
            email: paymentData.clientEmail,
            first_name: nameParts[0],
            last_name: nameParts.slice(1).join(" ") || undefined
          },
          description: `Consultoria #${input.requestId}`,
          metadata,
          ...split
        },
        requestOptions: {
          idempotencyKey: `consultancy:${input.requestId}:pix`,
          ...{ accessToken: providerAccessToken }
        }
      });
    }

    if (!paymentData.mpCardId || !paymentData.mpCustomerId) {
      throw new AppError("Método de pagamento do cliente não configurado.", StatusCodes.BAD_REQUEST);
    }

    // Server-side tokenize saved card for off-session charge
    const tokenResult = await mpCardTokenClient.create({
      body: { customer_id: paymentData.mpCustomerId, card_id: paymentData.mpCardId }
    });

    // capture:false — o valor fica reservado no cartão, sem cobrar ainda. A
    // cobrança de verdade só acontece quando o profissional entrega a primeira
    // ficha (ver deliverContract); se ele não entregar em 48h, a reserva é
    // liberada sem nunca ter sido cobrada (ver autoRefundExpiredContracts).
    // Raio-X de pagamentos, Rodada 2, Lote 3: cobrança sempre em 1x — cobrar
    // por unidade entregue (ficha por ficha) já divide o valor no tempo com
    // mais segurança que parcelamento em cartão; ver decisão no plano.
    return mpPaymentClient.create({
      body: {
        transaction_amount: input.amountCents / 100,
        token: String(tokenResult.id),
        installments: 1,
        payer: {
          type: "customer",
          id: paymentData.mpCustomerId,
          email: paymentData.clientEmail
        },
        description: `Consultoria #${input.requestId}`,
        capture: false,
        metadata,
        ...split
      },
      requestOptions: {
        idempotencyKey: `consultancy:${input.requestId}:card`,
        ...{ accessToken: providerAccessToken }
      }
    });
  }

  // Frente B (liberdade de ofertas): cobra a renovacao de uma ficha (2a
  // entrega em diante) - cobranca de verdade, na hora, sem reserva previa
  // (a entrega e a cobranca sao o mesmo evento). Pix nao suporta cobranca
  // sincrona no momento da entrega (precisaria de QR code + confirmacao
  // assincrona por webhook) - por isso so cartao (credito ou debito) e
  // aceito pra renovacao de ficha; Pix continua funcionando normalmente
  // so pra primeira cobranca do contrato.
  private async chargeFichaRenewal(input: {
    contractId: string;
    providerId: string;
    clientId: string;
    paymentMethod: ConsultancyPaymentMethod;
    amountCents: number;
    renewalIndex: number;
  }) {
    if (input.paymentMethod === ConsultancyPaymentMethod.PIX) {
      throw new AppError(
        "Consultoria paga via Pix não suporta renovação automática de ficha. Peça ao aluno para cadastrar um cartão antes de entregar uma nova ficha.",
        StatusCodes.BAD_REQUEST
      );
    }

    const paymentData = await this.resolveClientPaymentData(input.clientId, input.paymentMethod);
    if (!paymentData.mpCardId || !paymentData.mpCustomerId) {
      throw new AppError("Método de pagamento do cliente não configurado.", StatusCodes.BAD_REQUEST);
    }

    const provider = await prisma.providerProfile.findUnique({
      where: { id: input.providerId },
      select: { mpAccountId: true }
    });
    // Raio-X de pagamentos, Rodada 2, Lote 1: requireProviderMpAccessToken
    // agora cobre esse caso centralizadamente (token invalidado ou nunca
    // resolvido) — antes só o subcaso de token já explicitamente invalidado
    // tinha essa guarda aqui, deixando o caso mais amplo cair no fallback
    // sem split.
    const providerAccessToken = await requireProviderMpAccessToken(input.providerId);
    const split = provider?.mpAccountId
      ? {
          collector: { id: Number(provider.mpAccountId) },
          marketplace_fee: platformFeeAmount(input.amountCents) / 100
        }
      : {};

    const tokenResult = await mpCardTokenClient.create({
      body: { customer_id: paymentData.mpCustomerId, card_id: paymentData.mpCardId }
    });

    const mpPay = await mpPaymentClient.create({
      body: {
        transaction_amount: input.amountCents / 100,
        token: String(tokenResult.id),
        installments: 1,
        payer: { type: "customer", id: paymentData.mpCustomerId, email: paymentData.clientEmail },
        description: `Consultoria #${input.contractId} - renovação de ficha`,
        metadata: { domain: "CONSULTANCY_FICHA_RENEWAL", contractId: input.contractId },
        ...split
      },
      requestOptions: {
        idempotencyKey: `consultancy:${input.contractId}:ficha-renewal:${input.renewalIndex}`,
        ...{ accessToken: providerAccessToken }
      }
    });

    if (mpPay.status !== "approved") {
      throw new AppError(
        `Não foi possível cobrar a renovação da ficha (status: ${mpPay.status}/${mpPay.status_detail}). Peça ao aluno para revisar o método de pagamento e tente novamente.`,
        StatusCodes.BAD_REQUEST
      );
    }

    return mpPay;
  }

  private assertPromotionConfig(params: {
    basePriceCents: number;
    isPromotion: boolean;
    promotionPriceCents: number | null;
    promotionEndsAt: Date | null;
  }) {
    if (!params.isPromotion) return;

    if (!params.promotionPriceCents || !params.promotionEndsAt) {
      throw new AppError(
        "Para ativar promoção, informe valor promocional e data final da promocao.",
        StatusCodes.BAD_REQUEST
      );
    }

    if (params.promotionPriceCents >= params.basePriceCents) {
      throw new AppError(
        "Valor promocional deve ser menor que o valor base do serviço.",
        StatusCodes.BAD_REQUEST
      );
    }

    if (params.promotionEndsAt.getTime() <= Date.now()) {
      throw new AppError(
        "A data final da promoção deve ser futura.",
        StatusCodes.BAD_REQUEST
      );
    }
  }

  private serializeOffer<
    T extends {
      kind: ServiceOfferKind;
      priceCents: number;
      isPromotion: boolean;
      promotionPriceCents: number | null;
      promotionEndsAt: Date | null;
      basePriceUpdatedAt: Date;
      billingCycle: OfferBillingCycle;
      acceptsPix: boolean;
      acceptsDebitCard: boolean;
      acceptsCreditCard: boolean;
    }
  >(offer: T) {
    const isPromotionActive = this.isOfferPromotionActive(offer);
    const effectivePriceCents = this.offerEffectivePriceCents(offer);
    const basePriceChangeLockedUntil = new Date(
      offer.basePriceUpdatedAt.getTime() + BASE_PRICE_UPDATE_COOLDOWN_MS
    );

    return {
      ...offer,
      isPromotionActive,
      effectivePriceCents,
      kindDescription:
        offer.kind === ServiceOfferKind.COMBO
          ? "Presencial + Consultoria on-line"
          : null,
      paymentConfig: {
        acceptsPix: offer.acceptsPix,
        acceptsDebitCard: offer.acceptsDebitCard,
        acceptsCreditCard: offer.acceptsCreditCard
      },
      basePriceChangeLockedUntil
    };
  }

  private async providerProfileByUserId(userId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma;
    const profile = await client.providerProfile.findFirst({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            role: true
          }
        }
      }
    });

    if (!profile) {
      throw new AppError("Perfil profissional não encontrado.", StatusCodes.NOT_FOUND);
    }

    if (profile.user.role !== UserRole.PROVIDER) {
      throw new AppError(
        "Usuário autenticado não possui perfil de profissional.",
        StatusCodes.FORBIDDEN
      );
    }

    return profile;
  }

  private ensureProviderCanSaveOffer(profile: {
    crefNumber: string | null;
    credentialDocuments?: Prisma.JsonValue;
    crefValidationStatus?: CrefValidationStatus | null;
  }) {
    // CREF aprovado pelo admin — status é a fonte de verdade, não precisamos re-checar documentos
    if (profile.crefValidationStatus === CrefValidationStatus.APPROVED) {
      return;
    }

    // Documentos ainda não enviados — orientar o profissional
    if (!profile.crefNumber?.trim() || !this.hasFrontAndBackCrefDocuments(profile)) {
      throw new AppError(
        `Anexe frente e verso do CREF para envio. ${CREF_APPROVAL_REQUIRED_MESSAGE}`,
        StatusCodes.BAD_REQUEST
      );
    }

    // Documentos enviados mas CREF ainda não foi aprovado (IN_REVIEW ou REJECTED)
    throw new AppError(
      `Seu CREF ainda não foi aprovado. ${CREF_APPROVAL_REQUIRED_MESSAGE}`,
      StatusCodes.BAD_REQUEST
    );
  }

  private validateOfferInput(
    input: OfferInput,
    currentKind?: ServiceOfferKind,
    profileServiceMode?: ProviderServiceMode
  ) {
    const kind = input.kind ?? currentKind;
    if (!kind) {
      throw new AppError("Tipo de oferta inválido.", StatusCodes.BAD_REQUEST);
    }

    if (
      kind !== ServiceOfferKind.PRESENTIAL &&
      typeof input.daysPerWeek !== "undefined" &&
      input.daysPerWeek !== null
    ) {
      throw new AppError(
        "Campo dias por semana e permitido apenas para ofertas presenciais.",
        StatusCodes.BAD_REQUEST
      );
    }

    if (kind === ServiceOfferKind.PRESENTIAL && input.daysPerWeek && input.daysPerWeek > 7) {
      throw new AppError("Dias por semana deve estar entre 1 e 7.", StatusCodes.BAD_REQUEST);
    }

    if (
      kind !== ServiceOfferKind.COMBO &&
      (typeof input.comboPresentialDaysPerWeek !== "undefined" ||
        typeof input.comboOnlineDaysPerWeek !== "undefined") &&
      (input.comboPresentialDaysPerWeek !== null || input.comboOnlineDaysPerWeek !== null)
    ) {
      throw new AppError(
        "Campos do combo sao permitidos apenas para ofertas do tipo Combo.",
        StatusCodes.BAD_REQUEST
      );
    }

    if (kind === ServiceOfferKind.COMBO) {
      if (
        !input.comboPresentialDaysPerWeek ||
        input.comboPresentialDaysPerWeek < 1 ||
        input.comboPresentialDaysPerWeek > 7
      ) {
        throw new AppError(
          "No Combo, os dias presenciais por semana devem estar entre 1 e 7.",
          StatusCodes.BAD_REQUEST
        );
      }

      if (
        !input.comboOnlineDaysPerWeek ||
        input.comboOnlineDaysPerWeek < 1 ||
        input.comboOnlineDaysPerWeek > 7
      ) {
        throw new AppError(
          "No Combo, os dias de consultoria on-line por semana devem estar entre 1 e 7.",
          StatusCodes.BAD_REQUEST
        );
      }
    }

    const acceptsPix = input.acceptsPix ?? true;
    const acceptsDebitCard = input.acceptsDebitCard ?? true;
    const acceptsCreditCard = input.acceptsCreditCard ?? true;

    if (!acceptsPix && !acceptsDebitCard && !acceptsCreditCard) {
      throw new AppError(
        "Selecione ao menos um método de pagamento aceito para a oferta.",
        StatusCodes.BAD_REQUEST
      );
    }

    // Pacote presencial (assinatura cobrada em ciclos) - so PRESENTIAL/COMBO
    if (
      input.presentialPackageMode &&
      kind !== ServiceOfferKind.PRESENTIAL &&
      kind !== ServiceOfferKind.COMBO
    ) {
      throw new AppError(
        "Pacote presencial (assinatura por ciclo) é permitido apenas em ofertas presenciais ou combo.",
        StatusCodes.BAD_REQUEST
      );
    }

    if (input.presentialPackageMode) {
      if (!input.presentialSessionsPerCycle || input.presentialSessionsPerCycle < 1) {
        throw new AppError(
          input.presentialPackageMode === "FLEXIBLE_CREDITS"
            ? "Informe quantas sessões o pacote inclui no total."
            : "Informe quantas sessões (ou créditos) o pacote libera por ciclo.",
          StatusCodes.BAD_REQUEST
        );
      }
      if (input.presentialHasFixedTerm && (!input.presentialTotalCycles || input.presentialTotalCycles < 1)) {
        throw new AppError(
          "Informe o número total de ciclos para um pacote com vigência determinada.",
          StatusCodes.BAD_REQUEST
        );
      }
      // Frente D (liberdade de ofertas): pacote de sessões avulsas (créditos
      // flexíveis redesenhado) é um bloco fechado — sempre precisa de uma
      // validade (não existe mais "renova sozinho até cancelar" nesse
      // formato, isso era o modelo antigo de assinatura recorrente).
      if (input.presentialPackageMode === "FLEXIBLE_CREDITS" && !input.presentialHasFixedTerm) {
        throw new AppError(
          "Pacotes de sessões avulsas precisam de uma validade — informe por quanto tempo o pacote vale.",
          StatusCodes.BAD_REQUEST
        );
      }
    }

    if (
      kind !== ServiceOfferKind.COMBO &&
      (typeof input.comboPresentialShareCents !== "undefined" ||
        typeof input.comboConsultancyShareCents !== "undefined") &&
      (input.comboPresentialShareCents !== null || input.comboConsultancyShareCents !== null)
    ) {
      throw new AppError(
        "Valores de cada parte do combo são permitidos apenas para ofertas do tipo Combo.",
        StatusCodes.BAD_REQUEST
      );
    }

    if (kind === ServiceOfferKind.COMBO) {
      // Épico de Frentes, Frente 6 (Ofertas do profissional), Lote 4: essa
      // checagem só disparava SE um dos dois valores já tivesse vindo
      // preenchido — omitir os dois (ou o presentialPackageMode) deixava
      // criar um COMBO incompleto, que ainda aparecia na vitrine de
      // Destaques mas nunca conseguia ser comprado (purchaseCombo rejeita
      // por falta desses mesmos campos). Agora é sempre exigido pro kind.
      if (!input.presentialPackageMode) {
        throw new AppError(
          "Informe o modo do pacote presencial (parte presencial do combo).",
          StatusCodes.BAD_REQUEST
        );
      }
      if (!input.comboPresentialShareCents || !input.comboConsultancyShareCents) {
        throw new AppError(
          "Informe o valor de cada metade do combo (presencial e consultoria).",
          StatusCodes.BAD_REQUEST
        );
      }
      if (input.comboPresentialShareCents + input.comboConsultancyShareCents !== input.priceCents) {
        throw new AppError(
          "A soma das duas metades do combo deve ser igual ao valor total da oferta.",
          StatusCodes.BAD_REQUEST
        );
      }

      // Frente 5 (segunda camada), Lote 1: purchaseCombo sempre cobra
      // comboPresentialShareCents + comboConsultancyShareCents (que a
      // checagem acima trava para somar exatamente priceCents, o valor
      // BASE) — não existe como ratear um preço promocional entre as duas
      // partes fixas sem reabrir essa trava. Um combo com promoção ativa
      // aparecia com desconto na vitrine mas cobrava o valor cheio no
      // checkout. Bloqueado até existir um jeito seguro de dividir o
      // desconto entre as duas partes.
      if (input.isPromotion) {
        throw new AppError(
          "Promoção não está disponível para ofertas do tipo Combo (o desconto não pode ser dividido entre a parte presencial e a de consultoria).",
          StatusCodes.BAD_REQUEST
        );
      }
    }

    if (
      kind === ServiceOfferKind.PRESENTIAL &&
      typeof input.fichaValidityDays !== "undefined" &&
      input.fichaValidityDays !== null
    ) {
      throw new AppError(
        "Validade de ficha é permitida apenas para ofertas com consultoria (consultoria, especializada ou combo).",
        StatusCodes.BAD_REQUEST
      );
    }

    // Frente C (liberdade de ofertas): local de atendimento por oferta - so
    // pode restringir (nunca expandir) o que o perfil do profissional ja
    // permite. Se o perfil so tem atendimento em local fixo, nenhuma oferta
    // pode oferecer atendimento a domicilio, e vice-versa.
    if (
      input.offerServiceMode &&
      kind !== ServiceOfferKind.PRESENTIAL &&
      kind !== ServiceOfferKind.COMBO
    ) {
      throw new AppError(
        "Local de atendimento por oferta é permitido apenas em ofertas presenciais ou combo.",
        StatusCodes.BAD_REQUEST
      );
    }

    if (input.offerServiceMode && profileServiceMode && profileServiceMode !== ProviderServiceMode.BOTH) {
      if (input.offerServiceMode !== profileServiceMode) {
        throw new AppError(
          profileServiceMode === ProviderServiceMode.PRESENTIAL_ONLY
            ? "Seu perfil só atende em local fixo — habilite atendimento a domicílio no seu perfil antes de oferecer isso numa oferta."
            : "Seu perfil só atende a domicílio — habilite atendimento em local fixo no seu perfil antes de oferecer isso numa oferta.",
          StatusCodes.BAD_REQUEST
        );
      }
    }
  }

  private async normalizePlanExercises(
    providerId: string,
    exercises: ExerciseInput[],
    tx: Prisma.TransactionClient | typeof prisma = prisma
  ) {
    const exerciseIds = Array.from(
      new Set(
        exercises
          .map((exercise) => exercise.exerciseId)
          .filter((value): value is string => Boolean(value))
      )
    );

    const linkedExercises = new Map<string, { id: string; name: string }>();
    if (exerciseIds.length > 0) {
      const found = await tx.exercise.findMany({
        where: {
          id: { in: exerciseIds },
          OR: [{ isPrebuilt: true }, { providerId }]
        },
        select: {
          id: true,
          name: true
        }
      });

      if (found.length !== exerciseIds.length) {
        throw new AppError(
          "Um ou mais exercícios selecionados não pertencem à sua biblioteca.",
          StatusCodes.BAD_REQUEST
        );
      }

      found.forEach((exercise) => linkedExercises.set(exercise.id, exercise));
    }

    return exercises.map((exercise, index) => {
      const linked = exercise.exerciseId
        ? linkedExercises.get(exercise.exerciseId)
        : null;

      return {
        sortOrder: exercise.sortOrder ?? index,
        exerciseId: linked?.id ?? null,
        name: linked?.name ?? exercise.name,
        repetitionsSets: exercise.repetitionsSets,
        load: exercise.load,
        restSeconds: exercise.restSeconds,
        restLabel: exercise.restLabel,
        demoVideoUrl: exercise.demoVideoUrl
      };
    });
  }

  async listPromotions() {
    const now = new Date();
    const offers = await prisma.providerServiceOffer.findMany({
      where: {
        isActive: true,
        provider: {
          is: {
            crefValidationStatus: CrefValidationStatus.APPROVED,
            // Frente 5 (Descoberta, agendamento e agenda), Lote 5: vitrine
            // de "Destaques"/Promoções não filtrava suspenso, diferente da
            // busca principal — profissional suspenso continuava sendo
            // "recomendado" na home.
            user: { suspendedAt: null }
          }
        },
        OR: [
          {
            isPromotion: true,
            promotionPriceCents: {
              not: null
            },
            promotionEndsAt: {
              gt: now
            }
          },
          {
            kind: ServiceOfferKind.COMBO
          }
        ]
      },
      include: {
        provider: {
          include: {
            user: {
              select: {
                id: true,
                name: true
              }
            },
            categoryLinks: {
              include: {
                category: {
                  select: { name: true }
                }
              }
            }
          }
        }
      },
      orderBy: [{ updatedAt: "desc" }]
    });

    return offers
      .filter((offer) => offer.kind === ServiceOfferKind.COMBO || this.isOfferPromotionActive(offer))
      .map((offer) => ({
      offerId: offer.id,
      providerId: offer.providerId,
      providerName: offer.provider.displayName,
      providerPhotoUrl: toProviderPhotoUrl(
        offer.provider.id,
        offer.provider.photoUrl,
        offer.provider.updatedAt
      ),
      specialty:
        offer.provider.categoryLinks[0]?.category?.name ?? "Especialidade não informada",
      itemInPromotion:
        offer.promotionLabel ??
        `${itemKindLabel(offer.kind)} (${billingCycleLabel(offer.billingCycle)})`,
      promotionalPriceCents: this.offerEffectivePriceCents(offer),
      basePriceCents: offer.priceCents,
      promotionEndsAt: this.isOfferPromotionActive(offer) ? offer.promotionEndsAt : null,
      kind: offer.kind,
      billingCycle: offer.billingCycle,
      daysPerWeek: offer.daysPerWeek,
      comboPresentialDaysPerWeek: offer.comboPresentialDaysPerWeek,
      comboOnlineDaysPerWeek: offer.comboOnlineDaysPerWeek,
      paymentConfig: {
        acceptsPix: offer.acceptsPix,
        acceptsDebitCard: offer.acceptsDebitCard,
        acceptsCreditCard: offer.acceptsCreditCard
      }
      }));
  }

  async getProviderCatalog(providerId: string) {
    const provider = await prisma.providerProfile.findUnique({
      where: { id: providerId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            suspendedAt: true
          }
        },
        categoryLinks: {
          include: {
            category: {
              select: { id: true, name: true }
            }
          }
        },
        onlineConsultancySetting: true,
        serviceOffers: {
          where: { isActive: true },
          orderBy: [{ isPromotion: "desc" }, { updatedAt: "desc" }]
        },
        trainingPlans: {
          where: {
            isPrebuilt: true,
            isActive: true
          },
          orderBy: { updatedAt: "desc" },
          include: {
            _count: {
              select: {
                exercises: true
              }
            }
          }
        }
      }
    });

    // Épico de Frentes, Frente 6 (Ofertas do profissional), Lote 5: só
    // checava CREF — profissional suspenso continuava aparecendo aqui
    // como "contratável" (diferente de listPromotions, que já filtra os
    // dois). Suspensão só barrava no último passo (decideRequest).
    if (!provider || provider.crefValidationStatus !== CrefValidationStatus.APPROVED || provider.user.suspendedAt) {
      throw new AppError("Profissional não encontrado.", StatusCodes.NOT_FOUND);
    }

    return {
      provider: {
        id: provider.id,
        displayName: provider.displayName,
        photoUrl: toProviderPhotoUrl(provider.id, provider.photoUrl, provider.updatedAt),
        specialties: provider.categoryLinks.map((item) => item.category?.name).filter(Boolean)
      },
      onlineConsultancyEnabled: provider.onlineConsultancySetting?.enabled ?? false,
      offers: provider.serviceOffers.map((offer) => this.serializeOffer(offer)),
      prebuiltPlanPreviews: provider.trainingPlans.map((plan) => ({
        id: plan.id,
        title: plan.title,
        description: plan.description,
        exerciseCount: plan._count.exercises
      }))
    };
  }

  async upsertOnlineSetting(userId: string, input: { enabled: boolean }) {
    const provider = await this.providerProfileByUserId(userId);

    if (input.enabled) {
      this.ensureProviderCrefApproved(
        provider,
        `Seu CREF ainda não foi aprovado. ${CREF_APPROVAL_REQUIRED_MESSAGE}`
      );

      if (!provider.mpAccountId) {
        throw new AppError(
          "Conecte sua conta Mercado Pago antes de habilitar a consultoria on-line.",
          StatusCodes.BAD_REQUEST
        );
      }

      const [hasOnlineOffer, hasPrebuiltPlanWithExercise] = await Promise.all([
        prisma.providerServiceOffer.count({
          where: {
            providerId: provider.id,
            isActive: true,
            kind: {
              in: onlineOfferKinds
            }
          }
        }),
        prisma.trainingPlan.findFirst({
          where: {
            providerId: provider.id,
            isPrebuilt: true,
            isActive: true,
            exercises: {
              some: {}
            }
          },
          select: { id: true }
        })
      ]);

      if (!hasOnlineOffer) {
        throw new AppError(
          "Para habilitar consultoria on-line, configure ao menos uma oferta de consultoria.",
          StatusCodes.BAD_REQUEST
        );
      }

      if (!hasPrebuiltPlanWithExercise) {
        throw new AppError(
          "Para habilitar consultoria on-line, crie ao menos um treino pre-pronto com exercicios.",
          StatusCodes.BAD_REQUEST
        );
      }
    }

    return prisma.onlineConsultancySetting.upsert({
      where: {
        providerId: provider.id
      },
      update: {
        enabled: input.enabled
      },
      create: {
        providerId: provider.id,
        enabled: input.enabled
      }
    });
  }

  async getOnlineSetting(userId: string) {
    const provider = await this.providerProfileByUserId(userId);
    const setting = await prisma.onlineConsultancySetting.findUnique({
      where: {
        providerId: provider.id
      }
    });

    if (setting) {
      return setting;
    }

    return {
      id: null,
      providerId: provider.id,
      enabled: false
    };
  }

  async listProviderOffersByUser(userId: string) {
    const provider = await this.providerProfileByUserId(userId);
    const offers = await prisma.providerServiceOffer.findMany({
      where: { providerId: provider.id },
      orderBy: [{ isPromotion: "desc" }, { updatedAt: "desc" }]
    });
    return offers.map((offer) => this.serializeOffer(offer));
  }

  async createProviderOffer(userId: string, input: OfferInput) {
    const provider = await this.providerProfileByUserId(userId);
    this.ensureProviderCanSaveOffer(provider);
    this.validateOfferInput(input, undefined, provider.serviceMode);
    const now = new Date();
    const isPromotion = Boolean(input.isPromotion);
    const promotionEndsAt =
      this.parseDateOrThrow(input.promotionEndsAt, "Data final da promoção") ?? null;
    const promotionPriceCents = isPromotion ? input.promotionPriceCents ?? null : null;

    this.assertPromotionConfig({
      basePriceCents: input.priceCents,
      isPromotion,
      promotionPriceCents,
      promotionEndsAt
    });

    const acceptsPix = input.acceptsPix ?? true;
    const acceptsDebitCard = input.acceptsDebitCard ?? true;
    const acceptsCreditCard = input.acceptsCreditCard ?? true;

    const created = await prisma.providerServiceOffer.create({
      data: {
        providerId: provider.id,
        kind: input.kind,
        title: input.kind === ServiceOfferKind.COMBO ? "Combo" : input.title,
        billingCycle: input.billingCycle,
        daysPerWeek: input.daysPerWeek ?? null,
        comboPresentialDaysPerWeek:
          input.kind === ServiceOfferKind.COMBO
            ? input.comboPresentialDaysPerWeek ?? null
            : null,
        comboOnlineDaysPerWeek:
          input.kind === ServiceOfferKind.COMBO
            ? input.comboOnlineDaysPerWeek ?? null
            : null,
        priceCents: input.priceCents,
        basePriceUpdatedAt: now,
        isPromotion,
        promotionPriceCents,
        promotionEndsAt,
        promotionLabel: isPromotion ? input.promotionLabel ?? null : null,
        acceptsPix,
        acceptsDebitCard,
        acceptsCreditCard,
        isActive: input.isActive ?? true,
        presentialPackageMode:
          input.kind === ServiceOfferKind.PRESENTIAL || input.kind === ServiceOfferKind.COMBO
            ? input.presentialPackageMode ?? null
            : null,
        presentialHasFixedTerm: Boolean(input.presentialHasFixedTerm),
        presentialTotalCycles: input.presentialHasFixedTerm ? input.presentialTotalCycles ?? null : null,
        presentialSessionsPerCycle: input.presentialSessionsPerCycle ?? null,
        comboPresentialShareCents:
          input.kind === ServiceOfferKind.COMBO ? input.comboPresentialShareCents ?? null : null,
        comboConsultancyShareCents:
          input.kind === ServiceOfferKind.COMBO ? input.comboConsultancyShareCents ?? null : null,
        fichaValidityDays: input.kind !== ServiceOfferKind.PRESENTIAL ? input.fichaValidityDays ?? null : null,
        offerServiceMode:
          input.kind === ServiceOfferKind.PRESENTIAL || input.kind === ServiceOfferKind.COMBO
            ? input.offerServiceMode ?? null
            : null
      }
    });

    return this.serializeOffer(created);
  }

  async updateProviderOffer(userId: string, offerId: string, input: Partial<OfferInput>) {
    const provider = await this.providerProfileByUserId(userId);
    this.ensureProviderCanSaveOffer(provider);

    const offer = await prisma.providerServiceOffer.findUnique({
      where: { id: offerId }
    });

    if (!offer || offer.providerId !== provider.id) {
      throw new AppError("Oferta não encontrada.", StatusCodes.NOT_FOUND);
    }

    const nextKind = input.kind ?? offer.kind;

    // Frente 5 (segunda camada), Lote 7: deleteProviderOffer recusa excluir
    // uma oferta com venda histórica (contrato/pacote/agendamento), mas
    // trocar o `kind` na edição não tinha a mesma proteção — a oferta
    // mudava de identidade completamente (presencial ↔ consultoria ↔
    // combo) enquanto ainda tinha histórico vinculado a ela.
    if (nextKind !== offer.kind) {
      const [hasContract, hasPackage, hasBooking] = await Promise.all([
        prisma.consultancyContract.findFirst({ where: { offerId }, select: { id: true } }),
        prisma.presentialPackage.findFirst({ where: { offerId }, select: { id: true } }),
        prisma.booking.findFirst({ where: { offerId }, select: { id: true } })
      ]);
      if (hasContract || hasPackage || hasBooking) {
        throw new AppError(
          "Esta oferta já tem vendas registradas e não pode trocar de tipo — crie uma nova oferta em vez de alterar o tipo desta.",
          StatusCodes.CONFLICT
        );
      }
    }

    const nextPriceCents = input.priceCents ?? offer.priceCents;
    const nextIsPromotion =
      typeof input.isPromotion === "boolean" ? input.isPromotion : offer.isPromotion;
    const parsedPromotionEndsAt = this.parseDateOrThrow(
      input.promotionEndsAt,
      "Data final da promoção"
    );
    const nextPromotionEndsAt =
      typeof parsedPromotionEndsAt === "undefined"
        ? offer.promotionEndsAt
        : parsedPromotionEndsAt;
    const nextPromotionPriceCents =
      typeof input.promotionPriceCents === "undefined"
        ? offer.promotionPriceCents
        : input.promotionPriceCents;
    const nextAcceptsPix =
      typeof input.acceptsPix === "boolean" ? input.acceptsPix : offer.acceptsPix;
    const nextAcceptsDebitCard =
      typeof input.acceptsDebitCard === "boolean"
        ? input.acceptsDebitCard
        : offer.acceptsDebitCard;
    const nextAcceptsCreditCard =
      typeof input.acceptsCreditCard === "boolean"
        ? input.acceptsCreditCard
        : offer.acceptsCreditCard;
    const nextPresentialPackageMode =
      typeof input.presentialPackageMode === "undefined"
        ? offer.presentialPackageMode
        : input.presentialPackageMode;
    const nextPresentialHasFixedTerm =
      typeof input.presentialHasFixedTerm === "boolean"
        ? input.presentialHasFixedTerm
        : offer.presentialHasFixedTerm;
    const nextPresentialTotalCycles =
      typeof input.presentialTotalCycles === "undefined"
        ? offer.presentialTotalCycles
        : input.presentialTotalCycles;
    const nextPresentialSessionsPerCycle =
      typeof input.presentialSessionsPerCycle === "undefined"
        ? offer.presentialSessionsPerCycle
        : input.presentialSessionsPerCycle;
    const nextComboPresentialShareCents =
      typeof input.comboPresentialShareCents === "undefined"
        ? offer.comboPresentialShareCents
        : input.comboPresentialShareCents;
    const nextComboConsultancyShareCents =
      typeof input.comboConsultancyShareCents === "undefined"
        ? offer.comboConsultancyShareCents
        : input.comboConsultancyShareCents;
    const nextFichaValidityDays =
      typeof input.fichaValidityDays === "undefined" ? offer.fichaValidityDays : input.fichaValidityDays;
    const nextOfferServiceMode =
      typeof input.offerServiceMode === "undefined" ? offer.offerServiceMode : input.offerServiceMode;

    this.validateOfferInput(
      {
        kind: nextKind,
        title: input.title ?? offer.title,
        billingCycle: input.billingCycle ?? offer.billingCycle,
        daysPerWeek: input.daysPerWeek ?? offer.daysPerWeek,
        comboPresentialDaysPerWeek:
          input.comboPresentialDaysPerWeek ?? offer.comboPresentialDaysPerWeek,
        comboOnlineDaysPerWeek:
          input.comboOnlineDaysPerWeek ?? offer.comboOnlineDaysPerWeek,
        priceCents: nextPriceCents,
        isPromotion: nextIsPromotion,
        promotionPriceCents: nextPromotionPriceCents,
        promotionEndsAt: nextPromotionEndsAt,
        promotionLabel: input.promotionLabel ?? offer.promotionLabel,
        acceptsPix: nextAcceptsPix,
        acceptsDebitCard: nextAcceptsDebitCard,
        acceptsCreditCard: nextAcceptsCreditCard,
        isActive: input.isActive ?? offer.isActive,
        presentialPackageMode: nextPresentialPackageMode,
        presentialHasFixedTerm: nextPresentialHasFixedTerm,
        presentialTotalCycles: nextPresentialTotalCycles,
        presentialSessionsPerCycle: nextPresentialSessionsPerCycle,
        comboPresentialShareCents: nextComboPresentialShareCents,
        comboConsultancyShareCents: nextComboConsultancyShareCents,
        fichaValidityDays: nextFichaValidityDays,
        offerServiceMode: nextOfferServiceMode
      },
      offer.kind,
      provider.serviceMode
    );

    const now = new Date();
    const isPriceChanging =
      typeof input.priceCents !== "undefined" && input.priceCents !== offer.priceCents;
    const shouldRevalidatePromotion =
      nextIsPromotion &&
      (typeof input.isPromotion !== "undefined" ||
        typeof input.promotionPriceCents !== "undefined" ||
        typeof parsedPromotionEndsAt !== "undefined" ||
        isPriceChanging);

    if (shouldRevalidatePromotion) {
      this.assertPromotionConfig({
        basePriceCents: nextPriceCents,
        isPromotion: nextIsPromotion,
        promotionPriceCents: nextPromotionPriceCents ?? null,
        promotionEndsAt: nextPromotionEndsAt ?? null
      });
    }

    const nextAllowedBasePriceChangeAt = new Date(
      offer.basePriceUpdatedAt.getTime() + BASE_PRICE_UPDATE_COOLDOWN_MS
    );

    // Épico de Frentes, Frente 6 (Ofertas do profissional), Lote 10: a
    // checagem antiga só olhava o `offer` lido no início da função (fora de
    // qualquer transação) - duas edições de preço quase simultâneas na
    // mesma oferta liam o mesmo basePriceUpdatedAt "antigo", passavam as
    // duas pela checagem, e as duas escreviam (a segunda simplesmente
    // sobrescrevia a primeira), furando o cooldown de 30 dias. Trocado por
    // um updateMany condicional (mesmo idioma já usado em
    // renewalDeliveryLockedAt) que só efetiva a escrita se o
    // basePriceUpdatedAt ainda permitir a troca NO MOMENTO da escrita.
    const updateData = {
        title:
          nextKind === ServiceOfferKind.COMBO
            ? "Combo"
            : typeof input.title === "undefined"
              ? undefined
              : input.title,
        kind: input.kind,
        billingCycle: input.billingCycle,
        daysPerWeek:
          nextKind === ServiceOfferKind.PRESENTIAL
            ? typeof input.daysPerWeek === "undefined"
              ? undefined
              : input.daysPerWeek ?? null
            : null,
        comboPresentialDaysPerWeek:
          nextKind === ServiceOfferKind.COMBO
            ? typeof input.comboPresentialDaysPerWeek === "undefined"
              ? undefined
              : input.comboPresentialDaysPerWeek ?? null
            : null,
        comboOnlineDaysPerWeek:
          nextKind === ServiceOfferKind.COMBO
            ? typeof input.comboOnlineDaysPerWeek === "undefined"
              ? undefined
              : input.comboOnlineDaysPerWeek ?? null
            : null,
        priceCents: input.priceCents,
        basePriceUpdatedAt: isPriceChanging ? now : undefined,
        isPromotion: input.isPromotion,
        promotionPriceCents:
          nextIsPromotion === false
            ? null
            : typeof input.promotionPriceCents === "undefined"
              ? undefined
              : input.promotionPriceCents,
        promotionEndsAt:
          nextIsPromotion === false
            ? null
            : typeof parsedPromotionEndsAt === "undefined"
              ? undefined
              : parsedPromotionEndsAt,
        promotionLabel:
          nextIsPromotion === false
            ? null
            : typeof input.promotionLabel === "undefined"
              ? undefined
              : input.promotionLabel,
        acceptsPix: input.acceptsPix,
        acceptsDebitCard: input.acceptsDebitCard,
        acceptsCreditCard: input.acceptsCreditCard,
        isActive: input.isActive,
        presentialPackageMode:
          nextKind === ServiceOfferKind.PRESENTIAL || nextKind === ServiceOfferKind.COMBO
            ? nextPresentialPackageMode
            : null,
        presentialHasFixedTerm: nextPresentialHasFixedTerm,
        presentialTotalCycles: nextPresentialHasFixedTerm ? nextPresentialTotalCycles : null,
        presentialSessionsPerCycle: nextPresentialSessionsPerCycle,
        comboPresentialShareCents: nextKind === ServiceOfferKind.COMBO ? nextComboPresentialShareCents : null,
        comboConsultancyShareCents: nextKind === ServiceOfferKind.COMBO ? nextComboConsultancyShareCents : null,
        fichaValidityDays: nextKind !== ServiceOfferKind.PRESENTIAL ? nextFichaValidityDays : null,
        offerServiceMode:
          nextKind === ServiceOfferKind.PRESENTIAL || nextKind === ServiceOfferKind.COMBO
            ? nextOfferServiceMode
            : null
    };

    let updated: Awaited<ReturnType<typeof prisma.providerServiceOffer.update>>;
    if (isPriceChanging) {
      const claimed = await prisma.providerServiceOffer.updateMany({
        where: { id: offerId, basePriceUpdatedAt: { lte: new Date(now.getTime() - BASE_PRICE_UPDATE_COOLDOWN_MS) } },
        data: updateData
      });
      if (claimed.count === 0) {
        // Frente 5 (segunda camada), Lote 5: mensagem ia direto pro toast do
        // app com data em formato técnico (ISO, hora UTC) e sem acentuação —
        // trocado pelo mesmo padrão de formatação em pt-BR já usado em
        // outras mensagens deste arquivo (ex.: planValidUntilLabel).
        const nextAllowedLabel = nextAllowedBasePriceChangeAt.toLocaleDateString("pt-BR", {
          timeZone: env.APP_TIMEZONE
        });
        throw new AppError(
          `Valor base pode ser alterado apenas uma vez a cada 30 dias. Próxima alteração em ${nextAllowedLabel}.`,
          StatusCodes.BAD_REQUEST
        );
      }
      updated = await prisma.providerServiceOffer.findUniqueOrThrow({ where: { id: offerId } });
    } else {
      updated = await prisma.providerServiceOffer.update({ where: { id: offerId }, data: updateData });
    }

    return this.serializeOffer(updated);
  }

  async deleteProviderOffer(userId: string, offerId: string) {
    const provider = await this.providerProfileByUserId(userId);

    const offer = await prisma.providerServiceOffer.findUnique({
      where: { id: offerId }
    });

    if (!offer || offer.providerId !== provider.id) {
      throw new AppError("Oferta não encontrada.", StatusCodes.NOT_FOUND);
    }

    // Épico de Frentes, Frente 6 (Ofertas do profissional), Lote 4: excluir
    // uma oferta com uma solicitação já cotada (RESPONDED) "puxa o tapete"
    // do cliente sem aviso — quotedOfferId vira null silenciosamente
    // (onDelete: SetNull) e ele recebe "Solicitação sem oferta vinculada"
    // do nada ao tentar aceitar algo que já tinha visto um orçamento válido.
    const pendingQuote = await prisma.consultancyRequest.findFirst({
      where: { quotedOfferId: offerId, status: ConsultancyRequestStatus.RESPONDED },
      select: { id: true }
    });
    if (pendingQuote) {
      throw new AppError(
        "Existe uma solicitação de cliente aguardando decisão com esta oferta cotada — não é possível excluir agora. Aguarde o cliente decidir ou desative a oferta em vez de excluir.",
        StatusCodes.CONFLICT
      );
    }

    // Frente 5 (segunda camada), Lote 7: Booking.offerId usa onDelete:
    // SetNull (ao contrário de ConsultancyContract/PresentialPackage, que
    // usam Restrict e por isso já caem no catch de P2003 abaixo) — uma
    // oferta que só tem agendamentos avulsos vinculados (sem pacote/
    // contrato) podia ser excluída normalmente, e os bookings ficavam com
    // offerId nulo, perdendo a restrição de forma de pagamento configurada
    // pra aquela oferta (payment.service.ts só reaplica isso quando
    // offerId existe).
    const bookingUsingOffer = await prisma.booking.findFirst({
      where: { offerId },
      select: { id: true }
    });
    if (bookingUsingOffer) {
      throw new AppError(
        "Esta oferta já tem agendamentos registrados e não pode ser excluída — desative-a para parar de recebê-los sem apagar o histórico.",
        StatusCodes.CONFLICT
      );
    }

    try {
      await prisma.providerServiceOffer.delete({ where: { id: offerId } });
    } catch (err) {
      // Épico de Frentes, Frente 6, Lote 4: ConsultancyContract/
      // PresentialPackage têm onDelete: Restrict — qualquer oferta com 1+
      // venda histórica (mesmo cancelada) nunca pode ser excluída. Sem
      // esse catch, o middleware genérico de erro traduzia isso pra
      // "Referência inválida nos dados enviados.", que não orienta o
      // profissional a desativar em vez de excluir (e nunca vai
      // funcionar tentar de novo, já que a venda histórica não desaparece).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
        throw new AppError(
          "Esta oferta já tem vendas registradas e não pode ser excluída — desative-a para parar de recebê-las sem apagar o histórico.",
          StatusCodes.CONFLICT
        );
      }
      throw err;
    }
  }

  async createTrainingPlan(
    userId: string,
    input: {
      title: string;
      description?: string;
      isPrebuilt?: boolean;
      exercises: ExerciseInput[];
    }
  ) {
    const provider = await this.providerProfileByUserId(userId);
    this.ensureProviderCrefApproved(
      provider,
      `Seu CREF ainda não foi aprovado. ${CREF_APPROVAL_REQUIRED_MESSAGE}`
    );
    const normalizedExercises = await this.normalizePlanExercises(
      provider.id,
      input.exercises
    );

    return prisma.trainingPlan.create({
      data: {
        providerId: provider.id,
        title: input.title,
        description: input.description,
        isPrebuilt: input.isPrebuilt ?? true,
        isActive: true,
        exercises: {
          create: normalizedExercises
        }
      },
      include: {
        exercises: {
          orderBy: { sortOrder: "asc" },
          include: { exercise: true }
        }
      }
    });
  }

  async listProviderPlansByUser(userId: string) {
    const provider = await this.providerProfileByUserId(userId);
    // Frente 2 (segunda camada), Lote 6: rede de segurança contra
    // crescimento sem limite (mesmo padrão já usado em financial.service.ts)
    // — sem isso, um profissional com anos de uso acumula centenas de
    // fichas (cada renovação cria uma nova) e essa tela cresce pra sempre.
    return prisma.trainingPlan.findMany({
      where: { providerId: provider.id },
      include: {
        exercises: {
          orderBy: { sortOrder: "asc" },
          include: { exercise: true }
        }
      },
      orderBy: [{ isPrebuilt: "desc" }, { updatedAt: "desc" }],
      take: 2000
    });
  }

  async updateTrainingPlan(
    userId: string,
    planId: string,
    input: {
      title?: string;
      description?: string;
      isActive?: boolean;
      exercises?: ExerciseInput[];
      validUntil?: string;
    }
  ) {
    const provider = await this.providerProfileByUserId(userId);
    // Frente 4 (Criação/entrega/evolução do treino), Lote 3: este endpoint
    // não checava nada além de dono - diferente de deliverContract, que
    // exige CREF aprovado, conta não suspensa, contrato ACTIVE/DELIVERED e
    // ausência de contestação em aberto. Um profissional podia reescrever o
    // conteúdo de uma ficha até durante uma disputa aberta sobre ela mesma,
    // apagando a evidência que gerou a reclamação antes do admin julgar.
    this.ensureProviderCrefApproved(
      provider,
      `Seu CREF ainda não foi aprovado. ${CREF_APPROVAL_REQUIRED_MESSAGE}`
    );
    const suspendedProvider = await prisma.user.findUnique({
      where: { id: userId },
      select: { suspendedAt: true }
    });
    if (suspendedProvider?.suspendedAt) {
      throw new AppError("Sua conta está suspensa e não pode editar fichas de treino.", StatusCodes.FORBIDDEN);
    }

    const existing = await prisma.trainingPlan.findUnique({
      where: { id: planId },
      select: {
        id: true,
        providerId: true,
        contractId: true,
        contract: {
          select: {
            clientId: true,
            paymentCapturedAt: true,
            createdAt: true,
            status: true,
            billingCycle: true
          }
        }
      }
    });

    if (!existing || existing.providerId !== provider.id) {
      throw new AppError("Treino não encontrado.", StatusCodes.NOT_FOUND);
    }

    if (
      existing.contract &&
      existing.contract.status !== ConsultancyContractStatus.ACTIVE &&
      existing.contract.status !== ConsultancyContractStatus.DELIVERED
    ) {
      throw new AppError(
        "Contrato não está mais ativo — não é possível editar fichas vinculadas a ele.",
        StatusCodes.BAD_REQUEST
      );
    }

    const openContestOnThisPlan = await prisma.disputeCase.findFirst({
      where: { trainingPlanId: existing.id, type: "DELIVERY_CONTESTED", status: "OPEN" },
      select: { id: true }
    });
    if (openContestOnThisPlan) {
      throw new AppError(
        "Existe uma contestação em aberto sobre esta ficha. Aguarde a resolução antes de editá-la.",
        StatusCodes.CONFLICT
      );
    }

    let planValidUntil: Date | undefined;
    if (typeof input.validUntil !== "undefined") {
      if (!existing.contract) {
        throw new AppError(
          "Vigência só se aplica a treinos vinculados a um contrato de consultoria.",
          StatusCodes.BAD_REQUEST
        );
      }
      const parsed = new Date(input.validUntil);
      if (Number.isNaN(parsed.getTime())) {
        throw new AppError("Data de vigência do treino inválida.", StatusCodes.BAD_REQUEST);
      }
      const now = new Date();
      const contractValidUntil = consultancyValidUntil(existing.contract);
      if (parsed <= now) {
        throw new AppError("A vigência do treino deve ser uma data futura.", StatusCodes.BAD_REQUEST);
      }
      if (parsed > contractValidUntil) {
        throw new AppError(
          "A vigência do treino não pode ultrapassar a vigência da consultoria contratada.",
          StatusCodes.BAD_REQUEST
        );
      }
      planValidUntil = parsed;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const normalizedExercises = input.exercises
        ? await this.normalizePlanExercises(provider.id, input.exercises, tx)
        : null;

      if (normalizedExercises) {
        await tx.trainingPlanExercise.deleteMany({
          where: { trainingPlanId: existing.id }
        });
      }

      return tx.trainingPlan.update({
        where: { id: existing.id },
        data: {
          ...(typeof input.title !== "undefined" ? { title: input.title } : {}),
          ...(typeof input.description !== "undefined"
            ? { description: input.description }
            : {}),
          ...(typeof input.isActive !== "undefined"
            ? { isActive: input.isActive }
            : {}),
          ...(planValidUntil ? { validUntil: planValidUntil } : {}),
          ...(normalizedExercises
            ? {
                exercises: {
                  create: normalizedExercises
                }
              }
            : {})
        },
        include: {
          exercises: {
            orderBy: { sortOrder: "asc" },
            include: { exercise: true }
          }
        }
      });
    });

    if (existing.contract) {
      void notificationService.sendToUsers([existing.contract.clientId], {
        preferenceType: "CONSULTANCY",
        title: "Seu treino foi atualizado",
        body: "Seu profissional fez alterações no treino. Confira as novidades.",
        data: {
          type: "CONSULTANCY_TRAINING_UPDATED",
          trainingPlanId: existing.id
        }
      });
    }

    return updated;
  }

  async deleteTrainingPlan(userId: string, planId: string) {
    const provider = await this.providerProfileByUserId(userId);
    const existing = await prisma.trainingPlan.findUnique({
      where: { id: planId },
      select: {
        id: true,
        providerId: true,
        contractId: true
      }
    });

    if (!existing || existing.providerId !== provider.id) {
      throw new AppError("Treino não encontrado.", StatusCodes.NOT_FOUND);
    }

    if (existing.contractId) {
      throw new AppError(
        "Não é possível remover treino vinculado a contrato.",
        StatusCodes.BAD_REQUEST
      );
    }

    await prisma.trainingPlan.update({
      where: { id: existing.id },
      data: { isActive: false }
    });
  }

  async createConsultancyRequest(
    clientId: string,
    input: {
      providerId: string;
      trainingNeedText?: string;
      limitationText?: string;
      extraInfoText?: string;
      // Épico de Frentes, Frente 6 (Ofertas do profissional), Lote 6:
      // oferta escolhida pelo cliente na tela de solicitação — antes era
      // enviada mas nunca chegava a ser usada (nem o schema Zod declarava
      // o campo), então o profissional sempre cotava um serviço próprio,
      // possivelmente diferente do que o cliente selecionou.
      quotedOfferId?: string;
    }
  ) {
    const provider = await prisma.providerProfile.findUnique({
      where: { id: input.providerId },
      include: {
        onlineConsultancySetting: true
      }
    });

    if (!provider) {
      throw new AppError("Profissional não encontrado.", StatusCodes.NOT_FOUND);
    }

    this.ensureProviderCrefApproved(
      provider,
      "Este profissional ainda não está habilitado para consultoria on-line."
    );

    if (provider.userId === clientId) {
      throw new AppError(
        "Não é permitido enviar solicitação para o proprio perfil.",
        StatusCodes.BAD_REQUEST
      );
    }

    if (!provider.onlineConsultancySetting?.enabled) {
      throw new AppError(
        "Este profissional ainda não habilitou consultoria on-line.",
        StatusCodes.BAD_REQUEST
      );
    }

    const hasActiveOffer = await prisma.providerServiceOffer.findFirst({
      where: {
        providerId: provider.id,
        isActive: true,
        kind: { in: onlineOfferKinds }
      },
      select: { id: true }
    });
    if (!hasActiveOffer) {
      throw new AppError(
        "Este profissional não possui ofertas de consultoria ativas no momento.",
        StatusCodes.BAD_REQUEST
      );
    }

    const recentRequests = await prisma.consultancyRequest.count({
      where: {
        clientId,
        providerId: input.providerId,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      }
    });
    if (recentRequests >= 3) {
      throw new AppError(
        "Limite de 3 solicitacoes por dia para este profissional atingido.",
        StatusCodes.TOO_MANY_REQUESTS
      );
    }

    // Só usa a oferta escolhida pelo cliente se ela de fato pertencer a
    // este profissional, estiver ativa e for um tipo de consultoria — uma
    // escolha inválida/desatualizada (oferta apagada, por exemplo) não
    // deve bloquear a criação da solicitação, só é ignorada.
    let quotedOfferId: string | undefined;
    if (input.quotedOfferId) {
      const clientChosenOffer = await prisma.providerServiceOffer.findFirst({
        where: {
          id: input.quotedOfferId,
          providerId: provider.id,
          isActive: true,
          kind: { in: onlineOfferKinds }
        },
        select: { id: true }
      });
      quotedOfferId = clientChosenOffer?.id;
    }

    const request = await prisma.consultancyRequest.create({
      data: {
        providerId: provider.id,
        clientId,
        trainingNeedText: input.trainingNeedText,
        limitationText: input.limitationText,
        extraInfoText: input.extraInfoText,
        quotedOfferId,
        responseDeadlineAt: new Date(Date.now() + env.CONSULTANCY_DELIVERY_DEADLINE_HOURS * 60 * 60 * 1000)
      },
      include: {
        provider: {
          select: {
            ...PUBLIC_PROVIDER_SELECT,
            user: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      }
    });

    await notificationService.sendToUsers([provider.userId], {
        preferenceType: "CONSULTANCY",
      title: "Nova solicitação de consultoria",
      body: `Um aluno enviou uma nova solicitação de consultoria on-line. Você tem ${env.CONSULTANCY_DELIVERY_DEADLINE_HOURS}h para responder, ou o pedido expira automaticamente.`,
      data: {
        type: "CONSULTANCY_REQUEST_CREATED",
        requestId: request.id
      }
    });

    return request;
  }

  async listClientRequests(clientId: string) {
    return prisma.consultancyRequest.findMany({
      where: { clientId },
      include: {
        provider: {
          select: {
            ...PUBLIC_PROVIDER_SELECT,
            user: {
              select: {
                id: true,
                name: true
              }
            }
          }
        },
        quotedOffer: true,
        contract: {
          select: {
            ...CLIENT_SAFE_CONTRACT_SELECT,
            offer: true
          }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async listClientArchivedRequests(
    clientId: string,
    status?: "ALL" | "REFUSED" | "EXPIRED" | "EXPIRED_REFUNDED" | "ARCHIVED"
  ) {
    // Raio-X de pagamentos, Rodada 4, Lote 5: EXPIRED (solicitação que o
    // profissional nunca respondeu, gravada por expireStaleConsultancyRequests)
    // ficava fora desse filtro — a solicitação simplesmente sumia do app do
    // aluno pra sempre, sem aparecer nem nos ativos nem nos arquivados.
    const whereStatus =
      !status || status === "ALL"
        ? {
            in: [
              ConsultancyRequestStatus.REFUSED,
              ConsultancyRequestStatus.EXPIRED,
              ConsultancyRequestStatus.EXPIRED_REFUNDED,
              ConsultancyRequestStatus.ARCHIVED
            ]
          }
        : status;

    return prisma.consultancyRequest.findMany({
      where: {
        clientId,
        status: whereStatus
      },
      include: {
        provider: {
          select: {
            ...PUBLIC_PROVIDER_SELECT,
            user: {
              select: {
                id: true,
                name: true
              }
            }
          }
        },
        quotedOffer: true,
        contract: {
          select: {
            ...CLIENT_SAFE_CONTRACT_SELECT,
            offer: true
          }
        }
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
  }

  async listProviderRequests(userId: string) {
    const provider = await this.providerProfileByUserId(userId);
    return prisma.consultancyRequest.findMany({
      where: { providerId: provider.id },
      take: 100,
      include: {
        client: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        quotedOffer: true,
        contract: {
          include: {
            offer: true
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });
  }

  async listProviderArchivedRequests(
    userId: string,
    status?: "ALL" | "REFUSED" | "EXPIRED" | "EXPIRED_REFUNDED" | "ARCHIVED"
  ) {
    const provider = await this.providerProfileByUserId(userId);

    // Raio-X de pagamentos, Rodada 4, Lote 5: mesmo problema do lado do
    // profissional — uma solicitação que ele deixou expirar sem responder
    // sumia do próprio histórico dele também.
    const whereStatus =
      !status || status === "ALL"
        ? {
            in: [
              ConsultancyRequestStatus.REFUSED,
              ConsultancyRequestStatus.EXPIRED,
              ConsultancyRequestStatus.EXPIRED_REFUNDED,
              ConsultancyRequestStatus.ARCHIVED
            ]
          }
        : status;

    return prisma.consultancyRequest.findMany({
      where: {
        providerId: provider.id,
        status: whereStatus
      },
      include: {
        client: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        quotedOffer: true,
        contract: {
          include: {
            offer: true
          }
        }
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
  }

  async respondToRequest(
    userId: string,
    requestId: string,
    input: {
      providerResponseText: string;
      quotedOfferId: string;
    }
  ) {
    const provider = await this.providerProfileByUserId(userId);
    this.ensureProviderCrefApproved(
      provider,
      `Seu CREF ainda não foi aprovado. ${CREF_APPROVAL_REQUIRED_MESSAGE}`
    );

    const request = await prisma.consultancyRequest.findUnique({
      where: { id: requestId }
    });

    if (!request || request.providerId !== provider.id) {
      throw new AppError("Solicitação não encontrada.", StatusCodes.NOT_FOUND);
    }

    if (request.status !== ConsultancyRequestStatus.OPEN) {
      throw new AppError(
        "Solicitação já respondida ou encerrada.",
        StatusCodes.BAD_REQUEST
      );
    }

    const offer = await prisma.providerServiceOffer.findUnique({
      where: { id: input.quotedOfferId }
    });

    if (
      !offer ||
      offer.providerId !== provider.id ||
      !onlineOfferKinds.includes(offer.kind) ||
      !offer.isActive
    ) {
      throw new AppError(
        "Oferta de consultoria invalida para esta resposta.",
        StatusCodes.BAD_REQUEST
      );
    }

    const updated = await prisma.consultancyRequest.update({
      where: { id: requestId },
      data: {
        providerResponseText: input.providerResponseText,
        quotedOfferId: input.quotedOfferId,
        status: ConsultancyRequestStatus.RESPONDED,
        respondedAt: new Date()
      },
      include: {
        client: {
          select: {
            id: true
          }
        },
        quotedOffer: true
      }
    });

    await notificationService.sendToUsers([updated.client.id], {
        preferenceType: "CONSULTANCY",
      title: "Resposta da consultoria disponivel",
      body: "O profissional respondeu sua solicitação e enviou proposta.",
      data: {
        type: "CONSULTANCY_REQUEST_RESPONDED",
        requestId: updated.id
      }
    });

    return updated;
  }

  async decideRequest(
    clientId: string,
    requestId: string,
    input: {
      decision: "ACCEPT" | "REFUSE";
      paymentMethod?: ConsultancyPaymentMethod;
      acknowledgedImmediateExecution?: boolean;
    }
  ) {
    const request = await prisma.consultancyRequest.findUnique({
      where: { id: requestId },
      include: {
        quotedOffer: true,
        contract: true,
        provider: {
          include: {
            onlineConsultancySetting: true,
            user: {
              select: {
                id: true,
                suspendedAt: true
              }
            }
          }
        }
      }
    });

    if (!request || request.clientId !== clientId) {
      throw new AppError("Solicitação não encontrada.", StatusCodes.NOT_FOUND);
    }

    if (request.status !== ConsultancyRequestStatus.RESPONDED) {
      throw new AppError(
        "A solicitação não esta aguardando decisao do aluno.",
        StatusCodes.BAD_REQUEST
      );
    }

    if (input.decision === "REFUSE") {
      const updated = await prisma.consultancyRequest.update({
        where: { id: requestId },
        data: {
          status: ConsultancyRequestStatus.REFUSED,
          clientDecisionAt: new Date()
        }
      });

      await notificationService.sendToUsers([request.provider.user.id], {
        preferenceType: "CONSULTANCY",
        title: "Proposta recusada",
        body: "O aluno recusou a proposta de consultoria.",
        data: {
          type: "CONSULTANCY_PROPOSAL_REFUSED",
          requestId: updated.id
        }
      });

      return { request: updated, contract: null };
    }

    // Raio-X de pagamentos, Rodada 4, Lote 3: suspensão precisa bloquear
    // novo negócio entrando pra essa conta, não só o próprio login dele.
    if (request.provider.user.suspendedAt) {
      throw new AppError("Este profissional não está disponível para novas contratações no momento.", StatusCodes.BAD_REQUEST);
    }

    await assertEmailVerified(clientId);
    await debtService.assertNoOutstandingDebt(clientId);
    await debtService.assertProviderNoOutstandingDebt(request.providerId);

    await assertAnamnesisCompleted(clientId, "Preencha a anamnese antes de contratar um profissional.");

    if (!request.provider.mpAccountId) {
      throw new AppError(
        "Este profissional ainda não configurou o recebimento de pagamentos.",
        StatusCodes.BAD_REQUEST
      );
    }

    if (!request.quotedOffer) {
      throw new AppError(
        "Solicitação sem oferta vinculada para contratacao.",
        StatusCodes.BAD_REQUEST
      );
    }

    if (request.contract) {
      return { request, contract: request.contract };
    }

    if (input.acknowledgedImmediateExecution !== true) {
      // Defesa em profundidade — o validator já bloqueia isso, mas o consentimento
      // expresso ao início imediato do atendimento é a base legal (art. 49 do CDC)
      // pra dispensar o direito de arrependimento de 7 dias após a entrega da ficha.
      throw new AppError(
        "É necessário confirmar a ciência sobre o início imediato do atendimento para aceitar a proposta.",
        StatusCodes.BAD_REQUEST
      );
    }

    const selectedMethod = input.paymentMethod ?? ConsultancyPaymentMethod.CREDIT_CARD;
    const quotedOffer = request.quotedOffer;

    if (selectedMethod === ConsultancyPaymentMethod.PIX && !quotedOffer.acceptsPix) {
      throw new AppError(
        "Este profissional não aceita PIX para este serviço.",
        StatusCodes.BAD_REQUEST
      );
    }

    if (
      selectedMethod === ConsultancyPaymentMethod.DEBIT_CARD &&
      !quotedOffer.acceptsDebitCard
    ) {
      throw new AppError(
        "Este profissional não aceita cartao de debito para este serviço.",
        StatusCodes.BAD_REQUEST
      );
    }

    if (
      selectedMethod === ConsultancyPaymentMethod.CREDIT_CARD &&
      !quotedOffer.acceptsCreditCard
    ) {
      throw new AppError(
        "Este profissional não aceita cartao de credito para este serviço.",
        StatusCodes.BAD_REQUEST
      );
    }

    const now = new Date();
    const deliveryDeadlineAt = new Date(
      now.getTime() + env.CONSULTANCY_DELIVERY_DEADLINE_HOURS * 60 * 60 * 1000
    );

    const { updatedRequest, contract, paymentAmountCents } = await prisma.$transaction(async (tx) => {
      // Re-valida o status dentro da transação para prevenir race condition com decideRequest REFUSE
      const freshRequest = await tx.consultancyRequest.findUnique({
        where: { id: request.id },
        select: { status: true, contract: true }
      });
      if (!freshRequest || freshRequest.status !== ConsultancyRequestStatus.RESPONDED) {
        throw new AppError(
          "A solicitação já foi decidida por outro processo. Recarregue para ver o status atual.",
          StatusCodes.CONFLICT
        );
      }
      if (freshRequest.contract) {
        // Re-lê o request para garantir consistência (request fora da tx pode estar stale)
        const consistentRequest = await tx.consultancyRequest.findUniqueOrThrow({ where: { id: request.id } });
        return {
          updatedRequest: consistentRequest,
          contract: freshRequest.contract,
          paymentAmountCents: freshRequest.contract.paymentAmountCents
        };
      }

      // Épico de Frentes, Frente 6 (Ofertas do profissional), Lote 5: entre
      // o profissional cotar (respondToRequest) e o cliente aceitar pode
      // passar horas/dias — sem revalidar aqui, a oferta podia ser
      // desativada ou o CREF revogado nesse intervalo e o cliente ainda
      // conseguia pagar normalmente por uma oferta/profissional já
      // inválido no momento do aceite.
      const freshOffer = await tx.providerServiceOffer.findUnique({ where: { id: quotedOffer.id } });
      if (!freshOffer || !freshOffer.isActive) {
        throw new AppError(
          "Esta oferta não está mais disponível — peça ao profissional uma nova cotação.",
          StatusCodes.CONFLICT
        );
      }

      // Frente 5 (segunda camada), Lote 7: freshOffer já era buscado aqui
      // pra checar isActive, mas o valor cobrado e os campos congelados no
      // contrato continuavam vindo do `quotedOffer` capturado bem antes da
      // transação — uma alteração no preço promocional (sem cooldown de 30
      // dias, ao contrário do preço base) nessa janela não era pega.
      const paymentAmountCentsTx = this.offerEffectivePriceCents(freshOffer);
      const freshProvider = await tx.providerProfile.findUnique({
        where: { id: request.providerId },
        select: { crefValidationStatus: true, user: { select: { suspendedAt: true } } }
      });
      if (
        !freshProvider ||
        freshProvider.crefValidationStatus !== CrefValidationStatus.APPROVED ||
        freshProvider.user.suspendedAt
      ) {
        throw new AppError(
          "Este profissional não está mais disponível para novas contratações.",
          StatusCodes.CONFLICT
        );
      }

      const updatedRequestTx = await tx.consultancyRequest.update({
        where: { id: request.id },
        data: {
          status: ConsultancyRequestStatus.ACCEPTED,
          clientDecisionAt: now
        }
      });

      const contractTx = await tx.consultancyContract.create({
        data: {
          requestId: request.id,
          providerId: request.providerId,
          clientId,
          offerId: request.quotedOffer!.id,
          status: ConsultancyContractStatus.PENDING_PAYMENT,
          paymentMethod: selectedMethod,
          paymentInstallments: 1,
          paymentStatus: ConsultancyPaymentStatus.PENDING,
          paymentAmountCents: paymentAmountCentsTx,
          providerAmountCents: providerAmountFrom(paymentAmountCentsTx),
          platformAmountCents: platformAmountFrom(paymentAmountCentsTx),
          deliveryDeadlineAt,
          immediateExecutionAcknowledgedAt: now,
          // Épico de Frentes, Frente 6 (Ofertas do profissional), Lote 2:
          // snapshot congelado da oferta no momento da compra — editar a
          // oferta depois não pode mais mudar retroativamente a vigência/
          // categorização de um contrato já ativo. Lido de freshOffer (ver
          // Lote 7 acima), não do quotedOffer capturado antes da transação.
          billingCycle: freshOffer.billingCycle,
          kind: freshOffer.kind,
          fichaValidityDays: freshOffer.fichaValidityDays
        },
        include: {
          offer: true
        }
      });

      return {
        updatedRequest: updatedRequestTx,
        contract: contractTx,
        paymentAmountCents: paymentAmountCentsTx
      };
    });

    let mpPay: Awaited<ReturnType<Payment["create"]>>;
    try {
      mpPay = await this.createConsultancyMpPayment({
        requestId: request.id,
        contractId: contract.id,
        providerId: request.providerId,
        clientId,
        paymentMethod: selectedMethod,
        amountCents: paymentAmountCents
      });
    } catch (error) {
      await prisma.$transaction(async (tx) => {
        await tx.consultancyContract.update({
          where: { id: contract.id },
          data: {
            paymentStatus: ConsultancyPaymentStatus.FAILED,
            status: ConsultancyContractStatus.PENDING_PAYMENT
          }
        });

        await tx.consultancyRequest.update({
          where: { id: request.id },
          data: {
            status: ConsultancyRequestStatus.RESPONDED,
            clientDecisionAt: null
          }
        });
      });

      const message =
        error instanceof Error
          ? error.message
          : "Falha ao processar pagamento da consultoria.";
      throw new AppError(message, StatusCodes.BAD_REQUEST);
    }

    let updatedContract = contract;
    let pixPayload: ReturnType<typeof extractMpPixData> | null = null;
    const paymentNow = new Date();
    const mpPayId = String(mpPay.id);
    const mpStatus = mpPay.status;

    if (mpStatus === "approved") {
      // MP capturou na hora mesmo com capture:false pedido (acontece com débito,
      // que não suporta reserva em duas etapas) — trata como já cobrado de verdade.
      updatedContract = await prisma.consultancyContract.update({
        where: { id: contract.id },
        data: {
          mpPaymentId: mpPayId,
          paymentStatus: ConsultancyPaymentStatus.CAPTURED,
          paymentCapturedAt: paymentNow,
          status: ConsultancyContractStatus.ACTIVE
        },
        include: { offer: true }
      });
    } else if (mpStatus === "authorized") {
      // Caso normal do cartão de crédito: valor reservado, ainda não cobrado.
      // A cobrança de verdade só acontece na entrega da primeira ficha.
      updatedContract = await prisma.consultancyContract.update({
        where: { id: contract.id },
        data: {
          mpPaymentId: mpPayId,
          paymentStatus: ConsultancyPaymentStatus.AUTHORIZED,
          status: ConsultancyContractStatus.ACTIVE
        },
        include: { offer: true }
      });
    } else if (
      selectedMethod === ConsultancyPaymentMethod.PIX &&
      (mpStatus === "pending" || mpStatus === "in_process")
    ) {
      pixPayload = extractMpPixData(mpPay);
      updatedContract = await prisma.consultancyContract.update({
        where: { id: contract.id },
        data: {
          mpPaymentId: mpPayId,
          paymentStatus: ConsultancyPaymentStatus.PENDING,
          status: ConsultancyContractStatus.PENDING_PAYMENT
        },
        include: { offer: true }
      });
    } else {
      await prisma.$transaction(async (tx) => {
        await tx.consultancyContract.update({
          where: { id: contract.id },
          data: {
            mpPaymentId: mpPayId,
            paymentStatus: ConsultancyPaymentStatus.FAILED,
            status: ConsultancyContractStatus.PENDING_PAYMENT
          }
        });
        await tx.consultancyRequest.update({
          where: { id: request.id },
          data: { status: ConsultancyRequestStatus.RESPONDED, clientDecisionAt: null }
        });
      });

      throw new AppError("Pagamento da consultoria não foi confirmado. Tente novamente.", StatusCodes.BAD_REQUEST);
    }

    await notificationService.sendToUsers([request.provider.user.id], {
        preferenceType: "CONSULTANCY",
      title: mpStatus === "approved" ? "Consultoria contratada" : "Pagamento pendente",
      body:
        mpStatus === "approved"
          ? "Uma proposta de consultoria foi contratada e paga com sucesso."
          : "O aluno iniciou o pagamento da consultoria e aguarda confirmacao.",
      data: {
        type: "CONSULTANCY_CONTRACT_ACCEPTED",
        requestId: request.id,
        contractId: contract.id
      }
    });

    if (mpStatus === "approved") {
      const {
        onServicePurchased,
        onFirstConsultancyContracted,
      } = await import("../../gamification/services/gamification-events.service");
      void onServicePurchased(clientId, contract.id);
      void onFirstConsultancyContracted(clientId);
    }

    return {
      request: updatedRequest,
      contract: updatedContract,
      payment:
        pixPayload && selectedMethod === ConsultancyPaymentMethod.PIX
          ? {
              status: "PENDING",
              method: "PIX",
              pix: pixPayload
            }
          : {
              status: "CAPTURED",
              method: selectedMethod
            }
    };
  }

  async deliverContract(
    userId: string,
    contractId: string,
    input: {
      title: string;
      description?: string;
      exercises: ExerciseInput[];
      validUntil?: string;
    }
  ) {
    const provider = await this.providerProfileByUserId(userId);
    this.ensureProviderCrefApproved(
      provider,
      `Seu CREF ainda não foi aprovado. ${CREF_APPROVAL_REQUIRED_MESSAGE}`
    );

    // Raio-X de pagamentos, Rodada 5, Lote 2: cada nova ficha entregue cobra
    // o aluno de novo (Frente B) — um profissional suspenso nao pode seguir
    // gerando cobranca nova so porque o contrato ja estava ativo antes da
    // suspensao. Defesa em profundidade: a sessao/token ja deveriam ter sido
    // revogados na suspensao, mas o blacklist de token e "best effort".
    const suspendedProvider = await prisma.user.findUnique({
      where: { id: userId },
      select: { suspendedAt: true }
    });
    if (suspendedProvider?.suspendedAt) {
      throw new AppError("Sua conta está suspensa e não pode entregar novas fichas.", StatusCodes.FORBIDDEN);
    }

    const contract = await prisma.consultancyContract.findUnique({
      where: { id: contractId },
      include: {
        client: {
          select: {
            id: true
          }
        }
      }
    });

    if (!contract || contract.providerId !== provider.id) {
      throw new AppError("Contrato não encontrado.", StatusCodes.NOT_FOUND);
    }

    // Um contrato pode receber mais de um treino ao longo do tempo (o profissional
    // pode entregar quantos julgar necessário) — só a PRIMEIRA entrega transiciona
    // o contrato de ACTIVE pra DELIVERED; entregas seguintes só adicionam o treino.
    const isFirstDelivery = contract.status !== ConsultancyContractStatus.DELIVERED;
    if (contract.status !== ConsultancyContractStatus.ACTIVE && contract.status !== ConsultancyContractStatus.DELIVERED) {
      throw new AppError(
        "Contrato deve estar ativo (pagamento confirmado) para entregar o treino.",
        StatusCodes.BAD_REQUEST
      );
    }

    const now = new Date();
    // A vigencia do treino nunca pode passar da vigencia da propria consultoria
    // contratada. Se o profissional nao informar uma data, o treino herda a
    // vigencia inteira da consultoria (ele pode escalonar vigencias diferentes
    // pra treinos diferentes conforme o aluno evolui, mas nunca alem do contrato).
    //
    // Frente B (liberdade de ofertas): se a oferta configurou uma validade
    // padrao de ficha (fichaValidityDays), essa passa a ser a vigencia
    // padrao do treino - e deixa de ser limitada pela vigencia do contrato,
    // porque nesse modelo o contrato continua indefinidamente conforme as
    // fichas vao sendo renovadas (nao ha mais um "fim" fixo do contrato).
    const contractValidUntil = consultancyValidUntil(contract);
    const usesFichaValidity = Boolean(contract.fichaValidityDays);
    const defaultValidUntil = usesFichaValidity
      ? new Date(now.getTime() + contract.fichaValidityDays! * 24 * 60 * 60 * 1000)
      : contractValidUntil;
    let planValidUntil = defaultValidUntil;
    if (input.validUntil) {
      const parsed = new Date(input.validUntil);
      if (Number.isNaN(parsed.getTime())) {
        throw new AppError("Data de vigência do treino inválida.", StatusCodes.BAD_REQUEST);
      }
      if (parsed <= now) {
        throw new AppError("A vigência do treino deve ser uma data futura.", StatusCodes.BAD_REQUEST);
      }
      if (!usesFichaValidity && parsed > contractValidUntil) {
        throw new AppError(
          "A vigência do treino não pode ultrapassar a vigência da consultoria contratada.",
          StatusCodes.BAD_REQUEST
        );
      }
      planValidUntil = parsed;
    }

    // Frente B (liberdade de ofertas): a partir da 2a ficha, cada entrega
    // cobra de novo (mesmo valor combinado na assinatura) - sem ficha nova,
    // sem cobranca nova. Cobra ANTES de salvar (fail-loud, mesmo principio
    // da primeira entrega) - se a cobranca falhar, a entrega inteira falha.
    let renewalMpPaymentId: string | null = null;
    // Raio-X de pagamentos, Lote 4: trava leve por contrato ao redor de
    // "contar fichas -> cobrar renovação -> criar a ficha nova". Sem isso,
    // duas solicitações de entrega quase simultâneas podiam ler a mesma
    // contagem de fichas e cada uma cobrar (mesma idempotencyKey, MP cobra
    // só uma vez) e criar sua própria ficha nova (2 fichas pro
    // profissional, 1 cobrança só). Implementado como update condicional
    // atômico (mesmo idioma já usado em capturePaymentForBooking pra
    // idempotência) em vez de trava consultiva do Postgres — advisory lock
    // não é seguro com o pool de conexões do Prisma, porque quem pede e
    // quem libera a trava podem cair em conexões diferentes. Expira
    // sozinha em 30s (nunca prende o contrato pra sempre se o processo
    // cair no meio). Entregas sequenciais normais nunca disputam a trava,
    // porque a anterior já libera antes da próxima começar.
    //
    // Frente 2 (segunda camada), Lote 5: a trava passou a valer também pra
    // PRIMEIRA entrega — antes só cobria renovação, deixando a captura do
    // pagamento reservado (shouldCaptureNow, logo abaixo) sem nenhuma
    // proteção contra duplo toque no botão "entregar treino".
    const staleThreshold = new Date(now.getTime() - 30_000);
    const claimed = await prisma.consultancyContract.updateMany({
      where: {
        id: contract.id,
        OR: [{ renewalDeliveryLockedAt: null }, { renewalDeliveryLockedAt: { lt: staleThreshold } }]
      },
      data: { renewalDeliveryLockedAt: now }
    });
    if (claimed.count === 0) {
      throw new AppError(
        "Já existe uma entrega em andamento para este contrato. Aguarde alguns segundos e tente novamente.",
        StatusCodes.CONFLICT
      );
    }

    let result: { plan: Awaited<ReturnType<typeof prisma.trainingPlan.create>>; contract: Prisma.ConsultancyContractGetPayload<{ include: { offer: true } }> };
    try {
      // Se for a primeira entrega e o pagamento ainda estiver só reservado no
      // cartão (capture:false), captura AGORA, antes de salvar qualquer coisa.
      // Se a captura falhar, a entrega inteira falha e o profissional pode
      // tentar de novo — em vez de marcar como entregue sem o pagamento ter
      // sido efetivado de verdade (o que exigiria um job de retry separado
      // e espalharia essa distinção por mais telas do que o necessário).
      const shouldCaptureNow =
        isFirstDelivery &&
        contract.paymentStatus === ConsultancyPaymentStatus.AUTHORIZED &&
        Boolean(contract.mpPaymentId);
      if (shouldCaptureNow) {
        try {
          const mpPay = await mpPaymentClient.capture({
            id: contract.mpPaymentId!,
            transaction_amount: contract.paymentAmountCents / 100,
            // Frente 2 (segunda camada), Lote 4: chave estável por
            // contrato — qualquer retry desta mesma captura deve colidir
            // com a mesma operação na MP, nunca capturar duas vezes.
            requestOptions: { idempotencyKey: `consultancy:${contract.id}:capture` }
          });
          // Raio-X de pagamentos, Rodada 5, Lote 3: a MP pode responder 200
          // com um status que não é approved (hold expirado, captura
          // recusada) - o retorno era descartado e a entrega seguia como se
          // o pagamento tivesse sido efetivado de verdade.
          if (mpPay.status !== "approved") {
            throw new Error(`status inesperado: ${mpPay.status} / ${mpPay.status_detail}`);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "erro desconhecido";
          throw new AppError(
            `Não foi possível confirmar o pagamento reservado pra liberar a entrega. Tente novamente em instantes. (${message})`,
            StatusCodes.BAD_REQUEST
          );
        }
      }

      if (!isFirstDelivery) {
        // Raio-X de pagamentos, Rodada 2, Lote 4 (movido pra dentro da trava
        // na Rodada 3, Lote 6): sem essa checagem, o profissional podia
        // entregar (e cobrar) a ficha N+1 enquanto a contestação da ficha N
        // ainda estava pendente de julgamento do admin — o aluno acabava
        // pagando duas vezes por um período em disputa. Escopo é só a ficha
        // MAIS RECENTE (mesma convenção de contestDelivery) — uma
        // contestação antiga já superada por entregas seguintes não deve
        // travar o contrato pra sempre. Precisa rodar DEPOIS de reivindicar
        // a trava acima (não antes): checar e só depois travar deixava uma
        // janela onde uma contestação aberta bem nesse intervalo não era
        // vista, e a entrega passava mesmo assim (TOCTOU).
        const latestPlan = await prisma.trainingPlan.findFirst({
          where: { contractId: contract.id },
          orderBy: { createdAt: "desc" },
          select: { id: true }
        });
        const openContest = latestPlan
          ? await prisma.disputeCase.findFirst({
              where: { trainingPlanId: latestPlan.id, type: "DELIVERY_CONTESTED", status: "OPEN" },
              select: { id: true }
            })
          : null;
        if (openContest) {
          throw new AppError(
            "Existe uma contestação em aberto para a ficha mais recente deste contrato. Aguarde a resolução antes de entregar uma nova ficha.",
            StatusCodes.CONFLICT
          );
        }

        const existingPlansCount = await prisma.trainingPlan.count({ where: { contractId: contract.id } });
        const renewalPayment = await this.chargeFichaRenewal({
          contractId: contract.id,
          providerId: provider.id,
          clientId: contract.client.id,
          paymentMethod: contract.paymentMethod!,
          amountCents: contract.paymentAmountCents,
          renewalIndex: existingPlansCount
        });
        renewalMpPaymentId = String(renewalPayment.id);
      }

      result = await prisma.$transaction(async (tx) => {
        const normalizedExercises = await this.normalizePlanExercises(provider.id, input.exercises, tx);

        const plan = await tx.trainingPlan.create({
          data: {
            providerId: provider.id,
            contractId: contract.id,
            title: input.title,
            description: input.description,
            isPrebuilt: false,
            isActive: true,
            validUntil: planValidUntil,
            renewalMpPaymentId,
            exercises: {
              create: normalizedExercises
            }
          },
          include: {
            exercises: {
              orderBy: { sortOrder: "asc" },
              include: { exercise: true }
            }
          }
        });

        // Frente 4 (Criação/entrega/evolução do treino), Lote 3: sem isso,
        // entregar uma renovação antes da ficha anterior vencer deixava as
        // duas "vigentes" ao mesmo tempo pro cliente - ele podia concluir
        // (e ganhar XP/gerar post/histórico) a ficha já substituída.
        if (!isFirstDelivery) {
          await tx.trainingPlan.updateMany({
            where: { contractId: contract.id, isActive: true, id: { not: plan.id } },
            data: { isActive: false }
          });
        }

        const updatedContract = isFirstDelivery
          ? await tx.consultancyContract.update({
              where: { id: contract.id },
              data: {
                status: ConsultancyContractStatus.DELIVERED,
                deliveredAt: now,
                ...(shouldCaptureNow
                  ? { paymentStatus: ConsultancyPaymentStatus.CAPTURED, paymentCapturedAt: now }
                  : {})
              },
              include: { offer: true }
            })
          : await tx.consultancyContract.findUniqueOrThrow({
              where: { id: contract.id },
              include: { offer: true }
            });

        return {
          plan,
          contract: updatedContract
        };
      });
    } finally {
      await prisma.consultancyContract
        .updateMany({ where: { id: contract.id }, data: { renewalDeliveryLockedAt: null } })
        .catch((error) => console.error("Falha ao liberar trava de entrega de renovação:", error));
    }

    const planValidUntilLabel = planValidUntil.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const chargedAmountLabel = (contract.paymentAmountCents / 100).toFixed(2).replace(".", ",");

    await notificationService.sendToUsers([contract.client.id], {
      preferenceType: "CONSULTANCY",
      title: isFirstDelivery ? "Treino personalizado disponivel" : "Novo treino disponivel",
      body: isFirstDelivery
        ? `Seu treino foi entregue e já esta liberado em Seu Treino. Válido até ${planValidUntilLabel}.`
        : `Seu profissional liberou mais um treino (R$ ${chargedAmountLabel} cobrado no seu cartão). Válido até ${planValidUntilLabel}.`,
      data: {
        type: "CONSULTANCY_TRAINING_DELIVERED",
        contractId: contract.id
      }
    });

    if (!isFirstDelivery) {
      void notificationService
        .sendToUsers([userId], {
          preferenceType: "CONSULTANCY",
          title: "Ficha renovada",
          body: `Cobrança de R$ ${chargedAmountLabel} confirmada — nova ficha liberada, válida até ${planValidUntilLabel}.`,
          data: { type: "CONSULTANCY_FICHA_RENEWED", contractId: contract.id }
        })
        .catch((error) => console.error("Falha ao notificar profissional sobre renovação de ficha:", error));
    }

    return result;
  }

  // Mesmo prazo simétrico da entrega (48h): se a ficha entregue for
  // claramente inadequada (ex.: vazia, só pra travar o prazo), o aluno tem
  // essa janela pra contestar antes que o pagamento fique definitivo.
  //
  // Raio-X de pagamentos, Lote 4: passou a contestar a ENTREGA MAIS RECENTE
  // (a ficha atual), não mais só a primeira — antes, o prazo de 48h e o
  // limite de "uma contestação por contrato" eram fixados na 1ª entrega,
  // então uma renovação de ficha ruim (já cobrada de verdade) 5 meses
  // depois não tinha como ser contestada. Cada ficha (TrainingPlan) agora
  // tem sua própria janela e seu próprio limite de contestação.
  async contestDelivery(clientId: string, contractId: string, reason?: string) {
    const contract = await prisma.consultancyContract.findUnique({
      where: { id: contractId },
      include: { provider: { select: { userId: true } } }
    });

    if (!contract || contract.clientId !== clientId) {
      throw new AppError("Contrato não encontrado.", StatusCodes.NOT_FOUND);
    }

    if (contract.status !== ConsultancyContractStatus.DELIVERED || !contract.deliveredAt) {
      throw new AppError("Este contrato ainda não teve a primeira ficha entregue.", StatusCodes.BAD_REQUEST);
    }

    const latestPlan = await prisma.trainingPlan.findFirst({
      where: { contractId: contract.id },
      orderBy: { createdAt: "desc" }
    });
    if (!latestPlan) {
      throw new AppError("Nenhuma ficha entregue para contestar.", StatusCodes.BAD_REQUEST);
    }

    const deadline = new Date(
      latestPlan.createdAt.getTime() + env.CONSULTANCY_DELIVERY_DEADLINE_HOURS * 60 * 60 * 1000
    );
    if (new Date() > deadline) {
      throw new AppError("O prazo para contestar a entrega já passou.", StatusCodes.BAD_REQUEST);
    }

    const existing = await prisma.disputeCase.findFirst({
      where: { trainingPlanId: latestPlan.id, type: "DELIVERY_CONTESTED" }
    });
    if (existing) {
      throw new AppError("Você já contestou esta entrega.", StatusCodes.BAD_REQUEST);
    }

    const disputeCase = await prisma.disputeCase.create({
      data: {
        type: "DELIVERY_CONTESTED",
        clientId: contract.clientId,
        providerId: contract.providerId,
        amountCents: contract.paymentAmountCents,
        mpPaymentId: latestPlan.renewalMpPaymentId ?? contract.mpPaymentId,
        consultancyContractId: contract.id,
        trainingPlanId: latestPlan.id,
        contextNote: reason?.trim() || null
      }
    });

    void notificationService.sendToUsers([contract.provider.userId], {
      preferenceType: "CONSULTANCY",
      title: "Entrega da ficha contestada",
      body: "O aluno contestou a qualidade da ficha de treino entregue. O caso vai para análise de um administrador.",
      data: { type: "CONSULTANCY_DELIVERY_CONTESTED", contractId: contract.id }
    });

    return disputeCase;
  }

  async getMyTraining(clientId: string) {
    const contracts = await prisma.consultancyContract.findMany({
      where: {
        clientId,
        // AUTHORIZED entra aqui também: cartão com valor reservado (ainda não
        // capturado) já é um contrato ativo de verdade — o aluno precisa ver
        // que está "em preparação" mesmo antes da entrega/captura acontecer.
        paymentStatus: { in: [ConsultancyPaymentStatus.AUTHORIZED, ConsultancyPaymentStatus.CAPTURED] }
        // Frente 4 (Criação/entrega/evolução do treino), Lote 3: antes só
        // ACTIVE/DELIVERED entravam aqui - assim que o contrato cancelava
        // (inclusive no desfecho automático mais comum: ficha vencida 7
        // dias sem renovação), o cliente perdia acesso a TODAS as fichas
        // já pagas, contradizendo a própria mensagem de cancelamento ("as
        // fichas já recebidas continuam disponíveis"). Contratos CANCELLED/
        // REFUNDED_EXPIRED/ARCHIVED continuam aparecendo aqui (histórico),
        // mas sem permitir novas ações - ver o filtro por contrato ativo em
        // completeTrainingPlan/contestDelivery.
      },
      select: {
        ...CLIENT_SAFE_CONTRACT_SELECT,
        provider: {
          select: {
            ...PUBLIC_PROVIDER_SELECT,
            user: {
              select: {
                id: true,
                name: true
              }
            }
          }
        },
        offer: true,
        trainingPlans: {
          where: { isActive: true },
          include: {
            exercises: {
              orderBy: { sortOrder: "asc" },
              include: { exercise: true }
            }
          },
          orderBy: { createdAt: "desc" }
        }
      },
      orderBy: { createdAt: "desc" },
      // Frente 2 (segunda camada), Lote 6: rede de segurança contra
      // crescimento sem limite (mesmo padrão já usado em
      // financial.service.ts) — esta é a tela "Meu Treino", uma das mais
      // abertas pelo aluno, e inclui histórico completo (contratos
      // cancelados/expirados continuam aparecendo de propósito).
      take: 2000
    });

    const now = new Date();
    // Um treino vencido nunca some da lista (o aluno mantem o historico do que ja
    // contratou), mas os exercicios somem da resposta — so titulo/vigencia ficam
    // visiveis, o conteudo em si so e acessivel enquanto o treino estiver vigente.
    const contractsWithPlanValidity = contracts.map((contract) => ({
      ...contract,
      trainingPlans: contract.trainingPlans.map((plan) => {
        const effectiveValidUntil =
          plan.validUntil ?? consultancyValidUntil(contract);
        const isVigente = effectiveValidUntil >= now;
        return {
          ...plan,
          validUntil: effectiveValidUntil,
          isVigente,
          exercises: isVigente ? plan.exercises : []
        };
      })
    }));

    const unlockedContracts = contractsWithPlanValidity.filter((contract) => contract.trainingPlans.length > 0);
    const ACTIVE_CONTRACT_STATUSES_FOR_WAITING: ConsultancyContractStatus[] = [
      ConsultancyContractStatus.ACTIVE,
      ConsultancyContractStatus.DELIVERED
    ];

    return {
      locked: unlockedContracts.length === 0,
      // "Aguardando entrega" só faz sentido pra contrato ainda ativo — um
      // contrato cancelado/expirado sem nenhuma ficha nunca vai receber uma,
      // então não entra aqui (não é histórico de nada, nem está esperando).
      waitingDelivery: contractsWithPlanValidity
        .filter(
          (contract) =>
            contract.trainingPlans.length === 0 && ACTIVE_CONTRACT_STATUSES_FOR_WAITING.includes(contract.status)
        )
        .map((contract) => ({
          contractId: contract.id,
          providerName: contract.provider.displayName,
          deliveryDeadlineAt: contract.deliveryDeadlineAt,
          status: contract.status
        })),
      contracts: unlockedContracts
    };
  }

  async completeTrainingPlan(clientId: string, trainingPlanId: string, notes?: string) {
    const trainingPlan = await prisma.trainingPlan.findUnique({
      where: { id: trainingPlanId },
      include: {
        contract: {
          select: {
            id: true,
            clientId: true,
            providerId: true,
            paymentStatus: true,
            status: true,
            paymentCapturedAt: true,
            createdAt: true,
            billingCycle: true
          }
        },
        provider: {
          select: {
            id: true
          }
        }
      }
    });

    if (!trainingPlan || !trainingPlan.isActive) {
      throw new AppError("Treino não encontrado.", StatusCodes.NOT_FOUND);
    }

    const effectiveValidUntil = trainingPlan.contract
      ? trainingPlan.validUntil ?? consultancyValidUntil(trainingPlan.contract)
      : trainingPlan.validUntil;
    if (effectiveValidUntil && effectiveValidUntil < new Date()) {
      throw new AppError("Este treino não está mais vigente.", StatusCodes.BAD_REQUEST);
    }

    let contractId: string | null = trainingPlan.contractId;
    let providerId = trainingPlan.providerId;

    if (trainingPlan.contract) {
      // Frente 4 (Criação/entrega/evolução do treino), Lote 3: getMyTraining
      // agora mantém fichas de contratos cancelados/expirados visíveis
      // (histórico), mas nenhuma ação nova é permitida sobre elas.
      if (
        trainingPlan.contract.status !== ConsultancyContractStatus.ACTIVE &&
        trainingPlan.contract.status !== ConsultancyContractStatus.DELIVERED
      ) {
        throw new AppError(
          "Este contrato não está mais ativo — não é possível registrar novos treinos.",
          StatusCodes.BAD_REQUEST
        );
      }
      if (trainingPlan.contract.clientId !== clientId) {
        throw new AppError(
          "Você não possui acesso para registrar este treino.",
          StatusCodes.FORBIDDEN
        );
      }
      if (trainingPlan.contract.paymentStatus !== ConsultancyPaymentStatus.CAPTURED) {
        throw new AppError(
          "Contrato ainda sem pagamento efetivado para registrar treino.",
          StatusCodes.BAD_REQUEST
        );
      }
    } else {
      const activeContract = await prisma.consultancyContract.findFirst({
        where: {
          clientId,
          providerId,
          paymentStatus: ConsultancyPaymentStatus.CAPTURED,
          status: {
            in: [ConsultancyContractStatus.ACTIVE, ConsultancyContractStatus.DELIVERED]
          }
        },
        orderBy: { createdAt: "desc" },
        select: { id: true }
      });

      if (!activeContract) {
        throw new AppError(
          "Treino não liberado para este aluno sem contrato ativo.",
          StatusCodes.FORBIDDEN
        );
      }
      contractId = activeContract.id;
    }

    // Frente 4 (Criação/entrega/evolução do treino), Lote 4: referenceId do
    // XP é o id da própria conclusão (sempre novo), então a idempotência do
    // awardXp nunca disparava — o cliente podia chamar este endpoint
    // repetidamente e ganhar XP/post ilimitado pela mesma ficha, sem
    // nenhum treino de verdade acontecer entre uma chamada e outra. Trava
    // por dia (mesmo padrão de "um treino presencial só conta uma vez"
    // aplicado aqui como "uma conclusão de ficha só conta uma vez por dia").
    const todayStart = startOfTodayInSaoPaulo();
    const alreadyCompletedToday = await prisma.trainingPlanCompletion.findFirst({
      where: { trainingPlanId: trainingPlan.id, completedAt: { gte: todayStart } },
      select: { id: true }
    });
    if (alreadyCompletedToday) {
      throw new AppError(
        "Você já registrou a conclusão deste treino hoje. Volte amanhã para registrar de novo.",
        StatusCodes.CONFLICT
      );
    }

    const completion = await prisma.trainingPlanCompletion.create({
      data: {
        clientId,
        providerId,
        trainingPlanId: trainingPlan.id,
        contractId: contractId ?? undefined,
        notes: notes?.trim() || null
      }
    });

    const { onTrainingPlanCompleted } = await import("../../gamification/services/gamification-events.service");
    void onTrainingPlanCompleted(clientId, completion.id, providerId);

    return completion;
  }

  async listMyTrainingCompletions(clientId: string) {
    const completions = await prisma.trainingPlanCompletion.findMany({
      where: { clientId },
      orderBy: { completedAt: "desc" },
      take: 100,
      include: {
        trainingPlan: {
          select: {
            id: true,
            title: true
          }
        },
        provider: {
          select: {
            id: true,
            displayName: true,
            photoUrl: true,
            updatedAt: true
          }
        }
      }
    });

    return completions.map((completion) => ({
      ...completion,
      provider: {
        ...completion.provider,
        photoUrl: toProviderPhotoUrl(
          completion.provider.id,
          completion.provider.photoUrl,
          completion.provider.updatedAt
        )
      }
    }));
  }

  // O aluno pode desistir da consultoria a qualquer momento antes da primeira
  // ficha ser entregue — depois disso, o serviço já foi prestado e não cabe
  // mais cancelamento (ver Cláusula 8.2 dos Termos de Uso).
  // Raio-X de pagamentos, Rodada 4, Lote 2: generalizado de "só o aluno
  // cancela" pra aceitar também o profissional — precisa disso pra encerrar
  // com segurança os contratos ativos de um profissional que está
  // excluindo a própria conta (mesmo padrão que cancelPackage já usava).
  async cancelContract(userId: string, contractId: string) {
    const contract = await prisma.consultancyContract.findUnique({
      where: { id: contractId },
      include: { provider: { select: { userId: true } } }
    });

    if (!contract) {
      throw new AppError("Contrato não encontrado.", StatusCodes.NOT_FOUND);
    }
    const isClient = contract.clientId === userId;
    const isProvider = contract.provider.userId === userId;
    if (!isClient && !isProvider) {
      throw new AppError("Contrato não encontrado.", StatusCodes.NOT_FOUND);
    }

    if (
      contract.status !== ConsultancyContractStatus.ACTIVE &&
      contract.status !== ConsultancyContractStatus.DELIVERED
    ) {
      throw new AppError("Este contrato não pode mais ser cancelado.", StatusCodes.BAD_REQUEST);
    }

    // Frente 2 (segunda camada), Lote 5: trava atômica auto-expirável (mesmo
    // idioma de renewalDeliveryLockedAt acima) contra duplo toque em
    // "cancelar consultoria" disparando duas chamadas concorrentes de
    // estorno/cancelamento pro mesmo contrato. Expira sozinha em 30s.
    const cancelStaleThreshold = new Date(Date.now() - 30_000);
    const cancelClaimed = await prisma.consultancyContract.updateMany({
      where: {
        id: contract.id,
        OR: [{ cancelLockedAt: null }, { cancelLockedAt: { lt: cancelStaleThreshold } }]
      },
      data: { cancelLockedAt: new Date() }
    });
    if (cancelClaimed.count === 0) {
      throw new AppError(
        "Este contrato já está sendo cancelado. Aguarde alguns segundos e tente novamente.",
        StatusCodes.CONFLICT
      );
    }

    try {
      // Frente B (liberdade de ofertas): depois da primeira ficha entregue, a
      // consultoria vira uma relacao continua (cada ficha nova cobra na hora
      // que e entregue - ver deliverContract) - nao ha mais nenhum valor
      // reservado ou prepago pra devolver, entao encerrar aqui e so isso:
      // para de valer, sem nenhuma acao financeira (cada ficha ja recebida
      // ja foi paga de forma justa, uma a uma).
      if (contract.deliveredAt) {
        const ended = await prisma.consultancyContract.update({
          where: { id: contract.id },
          data: { status: ConsultancyContractStatus.CANCELLED }
        });

        if (!isProvider) {
          void notificationService.sendToUsers([contract.provider.userId], {
            preferenceType: "CONSULTANCY",
            title: "Consultoria encerrada pelo aluno",
            body: "O aluno encerrou a consultoria em andamento. Nenhuma ficha nova será cobrada.",
            data: { type: "CONSULTANCY_ENDED_BY_CLIENT", contractId: contract.id }
          });
        }
        void notificationService.sendToUsers([contract.clientId], {
          preferenceType: "CONSULTANCY",
          title: "Consultoria encerrada",
          body: isProvider
            ? "Seu profissional encerrou a consultoria em andamento. Nenhuma ficha nova será cobrada."
            : "Sua consultoria foi encerrada. As fichas já recebidas continuam disponíveis em Seu Treino.",
          data: { type: "CONSULTANCY_ENDED_BY_CLIENT", contractId: contract.id }
        });

        return ended;
      }

      // Cartão (AUTHORIZED): a reserva nunca chegou a ser cobrada — só precisa
      // ser liberada. PIX/débito (CAPTURED): o valor já foi cobrado de verdade,
      // precisa de estorno de fato.
      const isHoldOnly = contract.paymentStatus === ConsultancyPaymentStatus.AUTHORIZED;

      let gatewaySucceeded = true;
      let mpRefundId: string | null = null;

      if (contract.mpPaymentId) {
        try {
          if (isHoldOnly) {
            await mpPaymentClient.cancel({
              id: contract.mpPaymentId,
              requestOptions: { idempotencyKey: `consultancy:${contract.id}:cancel` }
            });
          } else {
            const refund = await mpRefundClient.create({
              payment_id: contract.mpPaymentId,
              body: {},
              requestOptions: { idempotencyKey: `consultancy:${contract.id}:refund` }
            });
            mpRefundId = String(refund.id);
          }
        } catch (error) {
          console.error(
            isHoldOnly ? "Consultancy client cancel hold failed (MP error):" : "Consultancy client cancel refund failed (MP error):",
            { contractId: contract.id, error }
          );
          if (!isHoldOnly) {
            Sentry.captureException(error, { tags: { area: "consultancy" }, extra: { contractId: contract.id, phase: "client_cancel_refund_failed" } });
          }
          gatewaySucceeded = false;
          // Falha ao liberar reserva não precisa de disputa (nada foi cobrado,
          // a reserva expira sozinha em 5 dias) — só falha ao estornar dinheiro
          // de verdade precisa de revisão manual.
          if (!isHoldOnly) {
            await prisma.disputeCase.create({
              data: {
                type: "REFUND_FAILED",
                clientId: contract.clientId,
                providerId: contract.providerId,
                amountCents: contract.paymentAmountCents,
                mpPaymentId: contract.mpPaymentId,
                consultancyContractId: contract.id,
                contextNote: "Reembolso automático falhou ao cancelar consultoria pelo aluno antes da entrega."
              }
            });
          }
        }
      }

      const updated = await prisma.consultancyContract.update({
        where: { id: contract.id },
        data: {
          status: ConsultancyContractStatus.CANCELLED,
          paymentStatus: isHoldOnly
            ? ConsultancyPaymentStatus.CANCELED
            : gatewaySucceeded
              ? ConsultancyPaymentStatus.REFUNDED
              : ConsultancyPaymentStatus.CAPTURED,
          refundedAt: !isHoldOnly && gatewaySucceeded ? new Date() : null,
          paymentCanceledAt: isHoldOnly ? new Date() : null,
          mpRefundId,
          refundReason: isHoldOnly
            ? "Cancelado pelo aluno antes da entrega. Reserva liberada, nunca chegou a ser cobrada."
            : gatewaySucceeded
              ? "Cancelado pelo aluno antes da entrega da primeira ficha."
              : "Cancelado pelo aluno antes da entrega. Reembolso via gateway falhou — pendente revisao manual."
        }
      });

      if (!isProvider) {
        void notificationService.sendToUsers([contract.provider.userId], {
          preferenceType: "CONSULTANCY",
          title: "Consultoria cancelada pelo aluno",
          body: "O aluno cancelou a consultoria antes da entrega da primeira ficha.",
          data: { type: "CONSULTANCY_CANCELLED_BY_CLIENT", contractId: contract.id }
        });
      }
      void notificationService.sendToUsers([contract.clientId], {
        preferenceType: "CONSULTANCY",
        title: "Consultoria cancelada",
        body: isProvider
          ? "Seu profissional cancelou esta consultoria. Qualquer valor já cobrado será estornado."
          : isHoldOnly
            ? "Sua consultoria foi cancelada. O valor reservado no cartão nunca chegou a ser cobrado."
            : gatewaySucceeded
              ? "Sua consultoria foi cancelada e o valor foi estornado."
              : "Sua consultoria foi cancelada. Houve uma falha ao processar o reembolso — nossa equipe já foi avisada e vai resolver manualmente.",
        data: { type: "CONSULTANCY_CANCELLED_BY_CLIENT", contractId: contract.id }
      });

      return updated;
    } finally {
      await prisma.consultancyContract
        .updateMany({ where: { id: contract.id }, data: { cancelLockedAt: null } })
        .catch((error) => console.error("Falha ao liberar trava de cancelamento de consultoria:", error));
    }
  }

  // Raio-X de pagamentos, Rodada 4, Lote 10: só existia o aviso de quando o
  // prazo de resposta já tinha vencido — nenhum lembrete antes disso, ao
  // contrário do padrão já usado pra confirmação de agendamento avulso
  // (Rodada 4, Lote 4). Só o profissional é avisado aqui — é ele quem
  // precisa agir; o aluno só é avisado quando de fato expira.
  async sendConsultancyResponseReminders(referenceDate = new Date()) {
    const reminderWindowMs = 6 * 60 * 60 * 1000;
    const dueSoon = await prisma.consultancyRequest.findMany({
      where: {
        status: ConsultancyRequestStatus.OPEN,
        responseReminderSentAt: null,
        responseDeadlineAt: {
          gt: referenceDate,
          lte: new Date(referenceDate.getTime() + reminderWindowMs)
        }
      },
      select: { id: true, provider: { select: { userId: true } } },
      take: 200
    });

    if (dueSoon.length === 0) {
      return;
    }

    await prisma.consultancyRequest.updateMany({
      where: { id: { in: dueSoon.map((r) => r.id) }, responseReminderSentAt: null },
      data: { responseReminderSentAt: referenceDate }
    });
    for (const request of dueSoon) {
      void notificationService
        .sendToUsers([request.provider.userId], {
          preferenceType: "CONSULTANCY",
          title: "Responda uma solicitação de consultoria",
          body: "Você tem uma solicitação de consultoria aguardando resposta — o prazo está acabando.",
          data: { type: "CONSULTANCY_REQUEST_RESPONSE_DUE_SOON", requestId: request.id }
        })
        .catch((e) => console.error("Consultancy response reminder failed:", e));
    }
  }

  // Se o profissional nunca responder uma solicitação em aberto dentro do prazo,
  // ela expira sozinha — o aluno não fica esperando indefinidamente por alguém
  // que, na prática, não deu a atenção devida ao pedido.
  async expireStaleConsultancyRequests(referenceDate = new Date()) {
    const staleRequests = await prisma.consultancyRequest.findMany({
      where: {
        status: ConsultancyRequestStatus.OPEN,
        responseDeadlineAt: { lte: referenceDate }
      },
      include: { provider: { select: { userId: true } } },
      take: 200
    });

    for (const request of staleRequests) {
      await prisma.consultancyRequest.update({
        where: { id: request.id },
        data: { status: ConsultancyRequestStatus.EXPIRED }
      });

      void notificationService.sendToUsers([request.clientId], {
        preferenceType: "CONSULTANCY",
        title: "Solicitação de consultoria expirou",
        body: "O profissional não respondeu dentro do prazo. Você já pode procurar outro profissional.",
        data: { type: "CONSULTANCY_REQUEST_EXPIRED", requestId: request.id }
      });
      void notificationService.sendToUsers([request.provider.userId], {
        preferenceType: "CONSULTANCY",
        title: "Solicitação de consultoria expirou",
        body: "Você não respondeu a uma solicitação de consultoria dentro do prazo e ela foi encerrada automaticamente.",
        data: { type: "CONSULTANCY_REQUEST_EXPIRED", requestId: request.id }
      });
    }
  }

  // Raio-X de pagamentos, Lote 4: diferente de sessão avulsa e pacote
  // presencial (que desistem sozinhos de um Pix não confirmado em 26h), a
  // consultoria não tinha esse mecanismo — se o aluno pagasse por Pix e a
  // confirmação da MP nunca chegasse, o contrato ficava "aguardando
  // pagamento" pra sempre, sem nenhuma saída dentro do app (aceitar a
  // proposta de novo só devolvia o mesmo contrato travado). Ao expirar,
  // devolve a solicitação pro estado RESPONDED — o aluno consegue aceitar
  // de novo pelo fluxo normal, o que gera um Pix novo.
  async expireStalePendingPixConsultancyContracts(referenceDate = new Date()) {
    const threshold = new Date(referenceDate.getTime() - 26 * 60 * 60 * 1000);
    const stale = await prisma.consultancyContract.findMany({
      where: {
        status: ConsultancyContractStatus.PENDING_PAYMENT,
        paymentStatus: ConsultancyPaymentStatus.PENDING,
        paymentMethod: ConsultancyPaymentMethod.PIX,
        createdAt: { lte: threshold }
      },
      include: { provider: { select: { userId: true } } },
      take: 200
    });

    for (const contract of stale) {
      await prisma.$transaction([
        prisma.consultancyContract.update({
          where: { id: contract.id },
          data: { paymentStatus: ConsultancyPaymentStatus.FAILED }
        }),
        prisma.consultancyRequest.updateMany({
          where: { id: contract.requestId, status: ConsultancyRequestStatus.ACCEPTED },
          data: { status: ConsultancyRequestStatus.RESPONDED }
        })
      ]);

      void notificationService.sendToUsers([contract.clientId], {
        preferenceType: "CONSULTANCY",
        title: "Pix da consultoria expirou",
        body: "O Pix expirou sem confirmação de pagamento. Aceite a proposta novamente para gerar um novo Pix.",
        data: { type: "CONSULTANCY_PIX_EXPIRED", contractId: contract.id }
      });
      void notificationService.sendToUsers([contract.provider.userId], {
        preferenceType: "CONSULTANCY",
        title: "Pix do aluno expirou",
        body: "O Pix de uma consultoria expirou sem confirmação de pagamento.",
        data: { type: "CONSULTANCY_PIX_EXPIRED", contractId: contract.id }
      });
    }
  }

  async sendConsultancyExpiryReminders(referenceDate = new Date()) {
    const hourMs = 60 * 60 * 1000;
    const windowMs = 5 * 60 * 1000;

    const lower24h = new Date(referenceDate.getTime() + 24 * hourMs - windowMs);
    const upper24h = new Date(referenceDate.getTime() + 24 * hourMs + windowMs);

    const due24h = await prisma.consultancyContract.findMany({
      where: {
        status: ConsultancyContractStatus.ACTIVE,
        expiry24hSentAt: null,
        deliveryDeadlineAt: { gte: lower24h, lte: upper24h },
      },
      select: { id: true, clientId: true, provider: { select: { userId: true } } },
    });

    if (due24h.length > 0) {
      await prisma.consultancyContract.updateMany({
        where: { id: { in: due24h.map((c) => c.id) }, expiry24hSentAt: null },
        data: { expiry24hSentAt: referenceDate },
      });
      for (const contract of due24h) {
        // Épico de Frentes, Frente 9, Lote 18: texto único ("seu plano de
        // treino") não fazia sentido pro profissional, que é quem PRECISA
        // entregar o plano, não quem vai recebê-lo - mesmo padrão de texto
        // por papel já usado em sendFichaExpiryReminders.
        void notificationService
          .sendToUsers([contract.clientId], {
            preferenceType: "CONSULTANCY",
            title: "Consultoria expira em 24 horas",
            body: "O prazo de entrega do seu plano de treino expira em 24 horas.",
            data: { type: "CONSULTANCY_EXPIRY_24H", contractId: contract.id },
          })
          .catch((e) => console.error("Consultancy 24h reminder (client) failed:", e));
        void notificationService
          .sendToUsers([contract.provider.userId], {
            preferenceType: "CONSULTANCY",
            title: "Prazo de entrega expira em 24 horas",
            body: "O prazo para entregar o plano de treino de um aluno expira em 24 horas.",
            data: { type: "CONSULTANCY_EXPIRY_24H", contractId: contract.id },
          })
          .catch((e) => console.error("Consultancy 24h reminder (provider) failed:", e));
      }
    }

    const lower6h = new Date(referenceDate.getTime() + 6 * hourMs - windowMs);
    const upper6h = new Date(referenceDate.getTime() + 6 * hourMs + windowMs);

    const due6h = await prisma.consultancyContract.findMany({
      where: {
        status: ConsultancyContractStatus.ACTIVE,
        expiry6hSentAt: null,
        deliveryDeadlineAt: { gte: lower6h, lte: upper6h },
      },
      select: { id: true, clientId: true, provider: { select: { userId: true } } },
    });

    if (due6h.length > 0) {
      await prisma.consultancyContract.updateMany({
        where: { id: { in: due6h.map((c) => c.id) }, expiry6hSentAt: null },
        data: { expiry6hSentAt: referenceDate },
      });
      for (const contract of due6h) {
        void notificationService
          .sendToUsers([contract.clientId], {
            preferenceType: "CONSULTANCY",
            title: "Consultoria expira em breve",
            body: "O prazo de entrega do seu plano de treino expira em 6 horas.",
            data: { type: "CONSULTANCY_EXPIRY_6H", contractId: contract.id },
          })
          .catch((e) => console.error("Consultancy 6h reminder (client) failed:", e));
        void notificationService
          .sendToUsers([contract.provider.userId], {
            preferenceType: "CONSULTANCY",
            title: "Prazo de entrega expira em breve",
            body: "O prazo para entregar o plano de treino de um aluno expira em 6 horas.",
            data: { type: "CONSULTANCY_EXPIRY_6H", contractId: contract.id },
          })
          .catch((e) => console.error("Consultancy 6h reminder (provider) failed:", e));
      }
    }

    const expiredContracts = await prisma.consultancyContract.findMany({
      where: {
        status: ConsultancyContractStatus.ACTIVE,
        expiryNoticeSentAt: null,
        deliveryDeadlineAt: { lte: referenceDate },
      },
      select: { id: true, clientId: true, provider: { select: { userId: true } } },
    });

    if (expiredContracts.length > 0) {
      await prisma.consultancyContract.updateMany({
        where: { id: { in: expiredContracts.map((c) => c.id) }, expiryNoticeSentAt: null },
        data: { expiryNoticeSentAt: referenceDate },
      });
      for (const contract of expiredContracts) {
        void notificationService
          .sendToUsers([contract.clientId, contract.provider.userId], {
            preferenceType: "CONSULTANCY",
            title: "Prazo de consultoria expirado",
            body: "O prazo de entrega do plano de treino expirou.",
            data: { type: "CONSULTANCY_EXPIRED", contractId: contract.id },
          })
          .catch((e) => console.error("Consultancy expiry notice failed:", e));
      }
    }
  }

  // Frente B (liberdade de ofertas): avisa o profissional (pendencia) e o
  // aluno quando a ficha atual de uma consultoria em andamento esta perto
  // de vencer e quando vence de fato - sempre considerando so a ficha MAIS
  // RECENTE de cada contrato (uma ficha antiga ja superada por uma entrega
  // posterior nao deve gerar aviso).
  async sendFichaExpiryReminders(referenceDate = new Date()) {
    const REMINDER_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

    async function isLatestPlanForContract(planId: string, contractId: string, createdAt: Date) {
      const newerCount = await prisma.trainingPlan.count({
        where: { contractId, createdAt: { gt: createdAt } }
      });
      return newerCount === 0;
    }

    const approaching = await prisma.trainingPlan.findMany({
      where: {
        contractId: { not: null },
        expiryReminderSentAt: null,
        validUntil: { gte: referenceDate, lte: new Date(referenceDate.getTime() + REMINDER_WINDOW_MS) }
      },
      select: {
        id: true,
        createdAt: true,
        contract: {
          select: {
            id: true,
            status: true,
            clientId: true,
            paymentAmountCents: true,
            provider: { select: { userId: true } }
          }
        }
      },
      // Frente 2 (segunda camada), Lote 7: faltava aqui o mesmo `take`
      // que as funções irmãs deste arquivo já usam — sem ele, esse job
      // (roda a cada REMINDER_JOB_INTERVAL_SECONDS, ~60s por padrão) fica
      // mais lento a cada tick conforme a base de fichas cresce, sem teto.
      take: 200
    });

    for (const plan of approaching) {
      if (!plan.contract || plan.contract.status !== ConsultancyContractStatus.DELIVERED) continue;
      if (!(await isLatestPlanForContract(plan.id, plan.contract.id, plan.createdAt))) continue;

      await prisma.trainingPlan.update({ where: { id: plan.id }, data: { expiryReminderSentAt: referenceDate } });

      void notificationService
        .sendToUsers([plan.contract.provider.userId], {
          preferenceType: "CONSULTANCY",
          title: "Ficha de aluno vencendo em breve",
          body: "A ficha de um dos seus alunos está perto de vencer — prepare a atualização.",
          data: { type: "CONSULTANCY_FICHA_EXPIRING_SOON", contractId: plan.contract.id }
        })
        .catch((e) => console.error("Ficha expiry-soon reminder (provider) failed:", e));

      // Raio-X de pagamentos, Lote 4: o aluno precisa saber, com
      // antecedência, que a renovação vai cobrar de novo — não só "vai
      // receber uma ficha nova".
      const renewalAmountLabel = (plan.contract.paymentAmountCents / 100).toFixed(2).replace(".", ",");
      void notificationService
        .sendToUsers([plan.contract.clientId], {
          preferenceType: "CONSULTANCY",
          title: "Sua ficha está perto de vencer",
          body: `Seu personal vai te enviar uma ficha atualizada em breve — a renovação cobra R$ ${renewalAmountLabel} no seu cartão salvo.`,
          data: { type: "CONSULTANCY_FICHA_EXPIRING_SOON", contractId: plan.contract.id }
        })
        .catch((e) => console.error("Ficha expiry-soon reminder (client) failed:", e));
    }

    const expired = await prisma.trainingPlan.findMany({
      where: {
        contractId: { not: null },
        expiredNoticeSentAt: null,
        validUntil: { lt: referenceDate }
      },
      select: {
        id: true,
        createdAt: true,
        contract: { select: { id: true, status: true, clientId: true, provider: { select: { userId: true } } } }
      },
      take: 200
    });

    for (const plan of expired) {
      if (!plan.contract || plan.contract.status !== ConsultancyContractStatus.DELIVERED) continue;
      if (!(await isLatestPlanForContract(plan.id, plan.contract.id, plan.createdAt))) continue;

      await prisma.trainingPlan.update({ where: { id: plan.id }, data: { expiredNoticeSentAt: referenceDate } });

      void notificationService
        .sendToUsers([plan.contract.provider.userId], {
          preferenceType: "CONSULTANCY",
          title: "Ficha de aluno vencida",
          body: "A ficha de um dos seus alunos venceu — entregue uma atualização para continuar recebendo por essa consultoria.",
          data: { type: "CONSULTANCY_FICHA_EXPIRED", contractId: plan.contract.id }
        })
        .catch((e) => console.error("Ficha expired notice (provider) failed:", e));

      void notificationService
        .sendToUsers([plan.contract.clientId], {
          preferenceType: "CONSULTANCY",
          title: "Sua ficha venceu",
          body: "Sua ficha de treino venceu. Você pode encerrar a consultoria a qualquer momento se preferir.",
          data: { type: "CONSULTANCY_FICHA_EXPIRED", contractId: plan.contract.id }
        })
        .catch((e) => console.error("Ficha expired notice (client) failed:", e));
    }
  }

  // Raio-X de pagamentos, Lote 4: quando a ficha vence e ninguém age (nem o
  // profissional entrega nova, nem o aluno cancela), a consultoria ficava
  // "pendurada" pra sempre, sem nenhuma consequência real — diferente da 1ª
  // entrega, que tem prazo de 48h e estorno automático. Só se aplica a
  // ofertas com fichaValidityDays configurado (que esperam renovação
  // periódica) — uma consultoria sem essa configuração não tem essa
  // dinâmica de "vencimento de ficha" no mesmo sentido.
  async escalateExpiredFichaContracts(referenceDate = new Date()) {
    const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
    const ESCALATION_THROTTLE_MS = 24 * 60 * 60 * 1000;

    const stale = await prisma.trainingPlan.findMany({
      where: {
        contractId: { not: null },
        expiredNoticeSentAt: { not: null },
        validUntil: { lt: referenceDate }
      },
      select: {
        id: true,
        createdAt: true,
        validUntil: true,
        lastEscalationSentAt: true,
        contract: {
          select: {
            id: true,
            status: true,
            clientId: true,
            fichaValidityDays: true,
            provider: { select: { userId: true } }
          }
        }
      },
      // Frente 2 (segunda camada), Lote 7: mesma rede de segurança das
      // funções irmãs deste arquivo — este job também roda a cada ~60s.
      take: 200
    });

    for (const plan of stale) {
      if (!plan.contract || plan.contract.status !== ConsultancyContractStatus.DELIVERED) continue;
      // Épico de Frentes, Frente 6 (Ofertas do profissional), Lote 2: lê o
      // fichaValidityDays congelado no contrato — antes lia ao vivo da
      // oferta, então zerar esse campo na oferta depois do vencimento
      // fazia esse job ignorar o contrato pra sempre (ficava "pendurado"
      // em DELIVERED, com ficha vencida, sem cobrança nem cancelamento).
      if (!plan.contract.fichaValidityDays) continue;

      const newerCount = await prisma.trainingPlan.count({
        where: { contractId: plan.contract.id, createdAt: { gt: plan.createdAt } }
      });
      if (newerCount > 0) continue;

      const autoCancelDeadline = new Date(plan.validUntil!.getTime() + GRACE_PERIOD_MS);
      if (referenceDate >= autoCancelDeadline) {
        await prisma.consultancyContract.update({
          where: { id: plan.contract.id },
          data: { status: ConsultancyContractStatus.CANCELLED }
        });

        // Raio-X de pagamentos, Rodada 2, Lote 5: mesmo padrão já usado em
        // autoRefundExpiredContracts — se este contrato é a metade de
        // consultoria de um combo, a metade presencial continua ativa e
        // sendo cobrada normalmente; o aluno precisa saber disso, em vez de
        // uma notificação genérica que soa como "tudo acabou".
        const linkedPackage = await prisma.presentialPackage.findFirst({
          where: { consultancyContractId: plan.contract.id },
          select: { id: true, status: true }
        });
        const isComboHalf =
          linkedPackage !== null && linkedPackage.status !== "CANCELLED" && linkedPackage.status !== "EXPIRED";

        void notificationService.sendToUsers([plan.contract.clientId, plan.contract.provider.userId], {
          preferenceType: "CONSULTANCY",
          title: isComboHalf ? "Consultoria do seu combo foi encerrada" : "Consultoria encerrada automaticamente",
          body: isComboHalf
            ? "A ficha venceu há 7 dias e nenhuma renovação foi entregue — a consultoria foi encerrada automaticamente. Isso afeta só a parte de consultoria do combo — a parte presencial continua normalmente, sendo cobrada como sempre."
            : "A ficha venceu há 7 dias e nenhuma renovação foi entregue — a consultoria foi encerrada automaticamente.",
          data: isComboHalf
            ? { type: "COMBO_CONSULTANCY_AUTO_CANCELLED", contractId: plan.contract.id, packageId: linkedPackage!.id }
            : { type: "CONSULTANCY_AUTO_CANCELLED", contractId: plan.contract.id }
        });
        continue;
      }

      if (plan.lastEscalationSentAt && referenceDate.getTime() - plan.lastEscalationSentAt.getTime() < ESCALATION_THROTTLE_MS) {
        continue;
      }
      await prisma.trainingPlan.update({ where: { id: plan.id }, data: { lastEscalationSentAt: referenceDate } });

      void notificationService
        .sendToUsers([plan.contract.provider.userId], {
          preferenceType: "CONSULTANCY",
          title: "Pendência: ficha de aluno vencida",
          body: "A ficha de um dos seus alunos está vencida — entregue uma renovação para continuar recebendo por essa consultoria. Sem ação em 7 dias, ela é encerrada automaticamente.",
          data: { type: "CONSULTANCY_FICHA_EXPIRED_ESCALATION", contractId: plan.contract.id }
        })
        .catch((e) => console.error("Ficha escalation (provider) failed:", e));

      void notificationService
        .sendToUsers([plan.contract.clientId], {
          preferenceType: "CONSULTANCY",
          title: "Sua ficha continua vencida",
          body: "Peça ao seu personal para renovar sua ficha de treino, ou encerre a consultoria quando preferir.",
          data: { type: "CONSULTANCY_FICHA_EXPIRED_ESCALATION", contractId: plan.contract.id }
        })
        .catch((e) => console.error("Ficha escalation (client) failed:", e));
    }
  }

  async autoRefundExpiredContracts(referenceDate = new Date()) {
    const expiredContracts = await prisma.consultancyContract.findMany({
      where: {
        status: ConsultancyContractStatus.ACTIVE,
        paymentStatus: { in: [ConsultancyPaymentStatus.AUTHORIZED, ConsultancyPaymentStatus.CAPTURED] },
        deliveredAt: null,
        deliveryDeadlineAt: {
          lte: referenceDate
        }
      },
      include: {
        provider: {
          select: {
            userId: true
          }
        }
      },
      take: 200,
    });

    const processContract = async (contract: (typeof expiredContracts)[number]) => {
      // Cartão (AUTHORIZED): a reserva nunca chegou a ser cobrada — só precisa
      // ser liberada. PIX/débito (CAPTURED): o valor já foi cobrado de
      // verdade, precisa de estorno de fato.
      const isHoldOnly = contract.paymentStatus === ConsultancyPaymentStatus.AUTHORIZED;

      // Frente 5 do roteiro de seguranca de pagamentos: se este contrato é a
      // metade de consultoria de um combo, a metade presencial (vinculada
      // via consultancyContractId) continua normalmente - o aluno precisa
      // ser avisado com clareza disso e ter a opção de cancelar também a
      // parte presencial, em vez de só uma notificação genérica.
      const linkedPackage = await prisma.presentialPackage.findFirst({
        where: { consultancyContractId: contract.id },
        select: { id: true, status: true }
      });
      const isComboHalf =
        linkedPackage !== null &&
        linkedPackage.status !== "CANCELLED" &&
        linkedPackage.status !== "EXPIRED";

      let mpRefundId: string | null = null;
      let gatewaySucceeded = true;
      let refundReason = `Prazo de ${env.CONSULTANCY_DELIVERY_DEADLINE_HOURS} horas expirado sem entrega do treino personalizado.`;

      if (contract.mpPaymentId) {
        try {
          if (isHoldOnly) {
            await mpPaymentClient.cancel({
              id: contract.mpPaymentId,
              // Frente 2 (segunda camada), Lote 4: chave estável por
              // contrato — se o job rodar de novo pro mesmo contrato antes
              // do status mudar (ex.: falha após o cancelamento mas antes
              // de gravar no banco), não duplica a chamada no gateway.
              requestOptions: { idempotencyKey: `consultancy:${contract.id}:cancel` }
            });
          } else {
            const refund = await mpRefundClient.create({
              payment_id: contract.mpPaymentId,
              body: {},
              requestOptions: { idempotencyKey: `consultancy:${contract.id}:refund` }
            });
            mpRefundId = String(refund.id);
          }
        } catch (error) {
          // Não interrompe o lote — registra o erro. Só abre caso de disputa
          // quando havia dinheiro de verdade em jogo (CAPTURED); uma reserva
          // que falhou ao ser cancelada expira sozinha em até 5 dias pelo
          // próprio Mercado Pago, sem risco financeiro pro aluno.
          console.error(
            isHoldOnly ? "Consultancy hold cancel failed (MP error):" : "Consultancy refund failed (MP error):",
            { contractId: contract.id, error }
          );
          if (!isHoldOnly) {
            Sentry.captureException(error, { tags: { area: "consultancy" }, extra: { contractId: contract.id, phase: "auto_refund_expired_failed" } });
          }
          gatewaySucceeded = false;
          refundReason = isHoldOnly
            ? "Prazo expirado sem entrega. Falha ao cancelar a reserva no gateway — expira sozinha em até 5 dias."
            : "Prazo expirado sem entrega. Reembolso via gateway falhou — pendente revisao manual.";
          if (!isHoldOnly) {
            await prisma.disputeCase.create({
              data: {
                type: "REFUND_FAILED",
                clientId: contract.clientId,
                providerId: contract.providerId,
                amountCents: contract.paymentAmountCents,
                mpPaymentId: contract.mpPaymentId,
                consultancyContractId: contract.id,
                contextNote: "Reembolso automático falhou ao expirar o prazo de entrega da consultoria (48h sem ficha entregue)."
              }
            });
          }
        }
      } else {
        refundReason = "Prazo expirado sem entrega. Contrato legado sem cobranca gateway registrada.";
      }

      await prisma.$transaction(async (tx) => {
        await tx.consultancyContract.update({
          where: { id: contract.id },
          data: {
            status: ConsultancyContractStatus.REFUNDED_EXPIRED,
            paymentStatus: isHoldOnly
              ? ConsultancyPaymentStatus.CANCELED
              : gatewaySucceeded
                ? ConsultancyPaymentStatus.REFUNDED
                : ConsultancyPaymentStatus.CAPTURED,
            refundedAt: !isHoldOnly && gatewaySucceeded ? referenceDate : null,
            paymentCanceledAt: isHoldOnly ? referenceDate : null,
            mpRefundId,
            refundReason
          }
        });
        await tx.consultancyRequest.update({ where: { id: contract.requestId }, data: { status: ConsultancyRequestStatus.EXPIRED_REFUNDED } });
      });

      const baseReasonText = isHoldOnly
        ? "Prazo de entrega expirado sem treino entregue. O valor reservado no cartão nunca chegou a ser cobrado."
        : gatewaySucceeded
          ? "Prazo de entrega expirado sem treino entregue. Valor estornado automaticamente."
          : "Prazo de entrega expirado sem treino entregue. Houve uma falha ao processar o reembolso — nossa equipe já foi avisada e vai resolver manualmente.";

      void notificationService.sendToUsers([contract.clientId], {
        preferenceType: "CONSULTANCY",
        title: isComboHalf
          ? "Consultoria do seu combo foi estornada"
          : isHoldOnly
            ? "Reserva liberada"
            : "Estorno automatico da consultoria",
        body: isComboHalf
          ? `${baseReasonText} Isso afeta só a parte de consultoria — a parte presencial do combo continua normalmente, sendo cobrada como sempre. Se preferir, você pode cancelar a parte presencial também a qualquer momento.`
          : baseReasonText,
        data: isComboHalf
          ? { type: "COMBO_CONSULTANCY_AUTO_REFUND", contractId: contract.id, packageId: linkedPackage!.id }
          : { type: "CONSULTANCY_AUTO_REFUND", contractId: contract.id }
      });
      void notificationService.sendToUsers([contract.provider.userId], {
        preferenceType: "CONSULTANCY",
        title: "Contrato estornado por prazo expirado",
        body: isComboHalf
          ? "A consultoria de um combo expirou sem entrega e foi estornada ao aluno. A parte presencial do combo continua normalmente."
          : "Contrato de consultoria expirou sem entrega e foi estornado ao aluno.",
        data: { type: "CONSULTANCY_CONTRACT_EXPIRED", contractId: contract.id }
      });
    };

    // Processar 5 em paralelo para não sobrecarregar a API do MP
    const CONCURRENCY = 5;
    for (let i = 0; i < expiredContracts.length; i += CONCURRENCY) {
      await Promise.allSettled(expiredContracts.slice(i, i + CONCURRENCY).map(processContract));
    }
  }
}
