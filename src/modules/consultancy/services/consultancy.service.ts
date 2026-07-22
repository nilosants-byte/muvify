import {
  ConsultancyContractStatus,
  CrefValidationStatus,
  ConsultancyPaymentMethod,
  ConsultancyPaymentStatus,
  ConsultancyRequestStatus,
  OfferBillingCycle,
  Prisma,
  PresentialPackageMode,
  ServiceOfferKind,
  UserRole
} from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env";
import { prisma } from "../../../config/prisma";
import { mp } from "../../../config/mercadopago";
import { AppError } from "../../../shared/errors/app-error";
import { platformFeeAmount, providerSplitAmount } from "../../../shared/utils/platform-fee";
import { toProviderPhotoUrl } from "../../../shared/utils/photo-url";
import { resolveProviderMpAccessToken } from "../../../shared/utils/mp-provider-account";
import { consultancyValidUntil } from "../../../shared/utils/consultancy-validity";
import { NotificationService } from "../../notifications/services/notification.service";
import { Payment, CardToken, PaymentRefund } from "mercadopago";

const BASE_PRICE_UPDATE_COOLDOWN_DAYS = 30;
const BASE_PRICE_UPDATE_COOLDOWN_MS =
  BASE_PRICE_UPDATE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

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
  maxCreditInstallments?: number;
  isActive?: boolean;
  presentialPackageMode?: PresentialPackageMode | null;
  presentialHasFixedTerm?: boolean;
  presentialTotalCycles?: number | null;
  presentialSessionsPerCycle?: number | null;
  comboPresentialShareCents?: number | null;
  comboConsultancyShareCents?: number | null;
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

const installmentEligibleCycles = new Set<OfferBillingCycle>([
  OfferBillingCycle.QUARTERLY,
  OfferBillingCycle.SEMIANNUAL,
  OfferBillingCycle.ANNUAL
]);

function supportsInstallments(cycle: OfferBillingCycle) {
  return installmentEligibleCycles.has(cycle);
}

function resolveMaxInstallments(cycle: OfferBillingCycle, configured: number) {
  if (!supportsInstallments(cycle)) {
    return 1;
  }
  return Math.min(Math.max(configured, 1), 12);
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
    installments: number;
  }) {
    const paymentData = await this.resolveClientPaymentData(input.clientId, input.paymentMethod);
    const nameParts = paymentData.clientName.split(" ");

    const provider = await prisma.providerProfile.findUnique({
      where: { id: input.providerId },
      select: { mpAccountId: true }
    });
    const providerAccessToken = await resolveProviderMpAccessToken(input.providerId);
    const split =
      providerAccessToken && provider?.mpAccountId
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
      consultancyPaymentMethod: input.paymentMethod,
      installments: String(input.installments)
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
          ...(providerAccessToken ? { accessToken: providerAccessToken } : {})
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

    return mpPaymentClient.create({
      body: {
        transaction_amount: input.amountCents / 100,
        token: String(tokenResult.id),
        installments: input.installments,
        payer: {
          type: "customer",
          id: paymentData.mpCustomerId,
          email: paymentData.clientEmail
        },
        description: `Consultoria #${input.requestId}`,
        metadata,
        ...split
      },
      requestOptions: {
        idempotencyKey: `consultancy:${input.requestId}:card`,
        ...(providerAccessToken ? { accessToken: providerAccessToken } : {})
      }
    });
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
      maxCreditInstallments: number;
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
        acceptsCreditCard: offer.acceptsCreditCard,
        maxCreditInstallments: resolveMaxInstallments(
          offer.billingCycle,
          offer.maxCreditInstallments
        )
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

  private validateOfferInput(input: OfferInput, currentKind?: ServiceOfferKind) {
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
        typeof input.comboOnlineDaysPerWeek !== "undefined")
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

    if (!acceptsCreditCard && (input.maxCreditInstallments ?? 1) > 1) {
      throw new AppError(
        "Parcelamento acima de 1x exige cartao de credito habilitado.",
        StatusCodes.BAD_REQUEST
      );
    }

    if (acceptsCreditCard && (input.maxCreditInstallments ?? 1) > 1) {
      const cycle = input.billingCycle;
      if (!supportsInstallments(cycle)) {
        throw new AppError(
          "Parcelamento em cartao de credito e permitido apenas para ciclos trimestral, semestral ou anual.",
          StatusCodes.BAD_REQUEST
        );
      }

      const maxInstallments = resolveMaxInstallments(cycle, input.maxCreditInstallments ?? 1);
      const minInstallmentCents = 500; // R$ 5,00 — mínimo exigido pelo Mercado Pago por parcela
      if (input.priceCents / maxInstallments < minInstallmentCents) {
        const maxAllowed = Math.floor(input.priceCents / minInstallmentCents);
        throw new AppError(
          `O valor da oferta (R$ ${(input.priceCents / 100).toFixed(2)}) não permite ${maxInstallments}x. ` +
            `Cada parcela deve ser de no mínimo R$ 5,00. Máximo permitido para este valor: ${maxAllowed}x.`,
          StatusCodes.UNPROCESSABLE_ENTITY
        );
      }
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
          "Informe quantas sessões (ou créditos) o pacote libera por ciclo.",
          StatusCodes.BAD_REQUEST
        );
      }
      if (input.presentialHasFixedTerm && (!input.presentialTotalCycles || input.presentialTotalCycles < 1)) {
        throw new AppError(
          "Informe o número total de ciclos para um pacote com vigência determinada.",
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

    if (kind === ServiceOfferKind.COMBO && (input.comboPresentialShareCents || input.comboConsultancyShareCents)) {
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
            crefValidationStatus: CrefValidationStatus.APPROVED
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
        acceptsCreditCard: offer.acceptsCreditCard,
        maxCreditInstallments: resolveMaxInstallments(
          offer.billingCycle,
          offer.maxCreditInstallments
        )
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
            name: true
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

    if (!provider || provider.crefValidationStatus !== CrefValidationStatus.APPROVED) {
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
    this.validateOfferInput(input);
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
    const maxCreditInstallments = acceptsCreditCard
      ? resolveMaxInstallments(input.billingCycle, input.maxCreditInstallments ?? 1)
      : 1;

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
        maxCreditInstallments,
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
          input.kind === ServiceOfferKind.COMBO ? input.comboConsultancyShareCents ?? null : null
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
    const nextMaxCreditInstallments =
      typeof input.maxCreditInstallments === "number"
        ? input.maxCreditInstallments
        : offer.maxCreditInstallments;
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
        maxCreditInstallments: nextMaxCreditInstallments,
        isActive: input.isActive ?? offer.isActive,
        presentialPackageMode: nextPresentialPackageMode,
        presentialHasFixedTerm: nextPresentialHasFixedTerm,
        presentialTotalCycles: nextPresentialTotalCycles,
        presentialSessionsPerCycle: nextPresentialSessionsPerCycle,
        comboPresentialShareCents: nextComboPresentialShareCents,
        comboConsultancyShareCents: nextComboConsultancyShareCents
      },
      offer.kind
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

    if (isPriceChanging && now < nextAllowedBasePriceChangeAt) {
      throw new AppError(
        `Valor base pode ser alterado apenas uma vez a cada 30 dias. Proxima alteracao em ${nextAllowedBasePriceChangeAt.toISOString()}.`,
        StatusCodes.BAD_REQUEST
      );
    }

    const resolvedMaxCreditInstallments = nextAcceptsCreditCard
      ? resolveMaxInstallments(input.billingCycle ?? offer.billingCycle, nextMaxCreditInstallments)
      : 1;

    const updated = await prisma.providerServiceOffer.update({
      where: { id: offerId },
      data: {
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
        maxCreditInstallments:
          typeof input.maxCreditInstallments === "undefined" &&
          typeof input.acceptsCreditCard === "undefined" &&
          typeof input.billingCycle === "undefined"
            ? undefined
            : resolvedMaxCreditInstallments,
        isActive: input.isActive,
        presentialPackageMode:
          nextKind === ServiceOfferKind.PRESENTIAL || nextKind === ServiceOfferKind.COMBO
            ? nextPresentialPackageMode
            : null,
        presentialHasFixedTerm: nextPresentialHasFixedTerm,
        presentialTotalCycles: nextPresentialHasFixedTerm ? nextPresentialTotalCycles : null,
        presentialSessionsPerCycle: nextPresentialSessionsPerCycle,
        comboPresentialShareCents: nextKind === ServiceOfferKind.COMBO ? nextComboPresentialShareCents : null,
        comboConsultancyShareCents: nextKind === ServiceOfferKind.COMBO ? nextComboConsultancyShareCents : null
      }
    });

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

    await prisma.providerServiceOffer.delete({ where: { id: offerId } });
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
    return prisma.trainingPlan.findMany({
      where: { providerId: provider.id },
      include: {
        exercises: {
          orderBy: { sortOrder: "asc" },
          include: { exercise: true }
        }
      },
      orderBy: [{ isPrebuilt: "desc" }, { updatedAt: "desc" }]
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
            offer: { select: { billingCycle: true } }
          }
        }
      }
    });

    if (!existing || existing.providerId !== provider.id) {
      throw new AppError("Treino não encontrado.", StatusCodes.NOT_FOUND);
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
      const contractValidUntil = consultancyValidUntil(existing.contract, existing.contract.offer.billingCycle);
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

    const request = await prisma.consultancyRequest.create({
      data: {
        providerId: provider.id,
        clientId,
        trainingNeedText: input.trainingNeedText,
        limitationText: input.limitationText,
        extraInfoText: input.extraInfoText
      },
      include: {
        provider: {
          include: {
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
      body: "Um aluno enviou uma nova solicitação de consultoria on-line.",
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
          include: {
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
          include: {
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
    status?: "ALL" | "REFUSED" | "EXPIRED_REFUNDED" | "ARCHIVED"
  ) {
    const whereStatus =
      !status || status === "ALL"
        ? {
            in: [
              ConsultancyRequestStatus.REFUSED,
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
          include: {
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
          include: {
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
    status?: "ALL" | "REFUSED" | "EXPIRED_REFUNDED" | "ARCHIVED"
  ) {
    const provider = await this.providerProfileByUserId(userId);

    const whereStatus =
      !status || status === "ALL"
        ? {
            in: [
              ConsultancyRequestStatus.REFUSED,
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
      installments?: number;
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
                id: true
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

    if (env.REQUIRE_ANAMNESIS_FOR_CONTRACTS) {
      const anamnesis = await prisma.clientAnamnesis.findUnique({
        where: { clientId }
      });
      if (!anamnesis || anamnesis.status !== "COMPLETED") {
        throw new AppError(
          "Preencha a anamnese antes de contratar um profissional.",
          StatusCodes.BAD_REQUEST
        );
      }
    }

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

    const selectedMethod = input.paymentMethod ?? ConsultancyPaymentMethod.CREDIT_CARD;
    const requestedInstallments = input.installments ?? 1;
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

    let resolvedInstallments = 1;
    if (selectedMethod === ConsultancyPaymentMethod.CREDIT_CARD) {
      const maxAllowedInstallments = resolveMaxInstallments(
        quotedOffer.billingCycle,
        quotedOffer.maxCreditInstallments
      );
      if (requestedInstallments > maxAllowedInstallments) {
        throw new AppError(
          `Parcelamento acima do permitido para este serviço. Maximo: ${maxAllowedInstallments}x.`,
          StatusCodes.BAD_REQUEST
        );
      }
      resolvedInstallments = requestedInstallments;
    } else if (requestedInstallments !== 1) {
      throw new AppError(
        "Parcelamento acima de 1x e permitido apenas em cartao de credito.",
        StatusCodes.BAD_REQUEST
      );
    }

    const paymentAmountCents = this.offerEffectivePriceCents({
      isPromotion: request.quotedOffer.isPromotion,
      promotionPriceCents: request.quotedOffer.promotionPriceCents,
      promotionEndsAt: request.quotedOffer.promotionEndsAt,
      priceCents: request.quotedOffer.priceCents
    });

    // Mínimo de R$ 5,00 por parcela exigido pelo Mercado Pago
    if (resolvedInstallments > 1 && paymentAmountCents / resolvedInstallments < 500) {
      const maxAllowed = Math.floor(paymentAmountCents / 500);
      throw new AppError(
        `Cada parcela deve ser de no mínimo R$ 5,00. Máximo permitido para este valor: ${maxAllowed}x.`,
        StatusCodes.UNPROCESSABLE_ENTITY
      );
    }

    const now = new Date();
    const deliveryDeadlineAt = new Date(
      now.getTime() + env.CONSULTANCY_DELIVERY_DEADLINE_HOURS * 60 * 60 * 1000
    );

    const { updatedRequest, contract } = await prisma.$transaction(async (tx) => {
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
        return { updatedRequest: consistentRequest, contract: freshRequest.contract };
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
          paymentInstallments: resolvedInstallments,
          paymentStatus: ConsultancyPaymentStatus.PENDING,
          paymentAmountCents,
          providerAmountCents: providerAmountFrom(paymentAmountCents),
          platformAmountCents: platformAmountFrom(paymentAmountCents),
          deliveryDeadlineAt
        },
        include: {
          offer: true
        }
      });

      return {
        updatedRequest: updatedRequestTx,
        contract: contractTx
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
        amountCents: paymentAmountCents,
        installments: resolvedInstallments
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
    const contract = await prisma.consultancyContract.findUnique({
      where: { id: contractId },
      include: {
        client: {
          select: {
            id: true
          }
        },
        offer: {
          select: {
            billingCycle: true
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
    const contractValidUntil = consultancyValidUntil(contract, contract.offer.billingCycle);
    let planValidUntil = contractValidUntil;
    if (input.validUntil) {
      const parsed = new Date(input.validUntil);
      if (Number.isNaN(parsed.getTime())) {
        throw new AppError("Data de vigência do treino inválida.", StatusCodes.BAD_REQUEST);
      }
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

    const result = await prisma.$transaction(async (tx) => {
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

      const updatedContract = isFirstDelivery
        ? await tx.consultancyContract.update({
            where: { id: contract.id },
            data: {
              status: ConsultancyContractStatus.DELIVERED,
              deliveredAt: now
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

    await notificationService.sendToUsers([contract.client.id], {
      preferenceType: "CONSULTANCY",
      title: isFirstDelivery ? "Treino personalizado disponivel" : "Novo treino disponivel",
      body: isFirstDelivery
        ? "Seu treino foi entregue e já esta liberado em Seu Treino."
        : "Seu profissional liberou mais um treino. Confira em Seu Treino.",
      data: {
        type: "CONSULTANCY_TRAINING_DELIVERED",
        contractId: contract.id
      }
    });

    return result;
  }

  async getMyTraining(clientId: string) {
    const contracts = await prisma.consultancyContract.findMany({
      where: {
        clientId,
        paymentStatus: ConsultancyPaymentStatus.CAPTURED,
        status: {
          in: [ConsultancyContractStatus.ACTIVE, ConsultancyContractStatus.DELIVERED]
        }
      },
      include: {
        provider: {
          include: {
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
      orderBy: { createdAt: "desc" }
    });

    const now = new Date();
    // Um treino vencido nunca some da lista (o aluno mantem o historico do que ja
    // contratou), mas os exercicios somem da resposta — so titulo/vigencia ficam
    // visiveis, o conteudo em si so e acessivel enquanto o treino estiver vigente.
    const contractsWithPlanValidity = contracts.map((contract) => ({
      ...contract,
      trainingPlans: contract.trainingPlans.map((plan) => {
        const effectiveValidUntil =
          plan.validUntil ?? consultancyValidUntil(contract, contract.offer.billingCycle);
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

    return {
      locked: unlockedContracts.length === 0,
      waitingDelivery: contractsWithPlanValidity
        .filter((contract) => contract.trainingPlans.length === 0)
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
            offer: { select: { billingCycle: true } }
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
      ? trainingPlan.validUntil ?? consultancyValidUntil(trainingPlan.contract, trainingPlan.contract.offer.billingCycle)
      : trainingPlan.validUntil;
    if (effectiveValidUntil && effectiveValidUntil < new Date()) {
      throw new AppError("Este treino não está mais vigente.", StatusCodes.BAD_REQUEST);
    }

    let contractId: string | null = trainingPlan.contractId;
    let providerId = trainingPlan.providerId;

    if (trainingPlan.contract) {
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
        void notificationService
          .sendToUsers([contract.clientId, contract.provider.userId], {
            preferenceType: "CONSULTANCY",
            title: "Consultoria expira em 24 horas",
            body: "O prazo de entrega do seu plano de treino expira em 24 horas.",
            data: { type: "CONSULTANCY_EXPIRY_24H", contractId: contract.id },
          })
          .catch((e) => console.error("Consultancy 24h reminder failed:", e));
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
          .sendToUsers([contract.clientId, contract.provider.userId], {
            preferenceType: "CONSULTANCY",
            title: "Consultoria expira em breve",
            body: "O prazo de entrega do seu plano de treino expira em 6 horas.",
            data: { type: "CONSULTANCY_EXPIRY_6H", contractId: contract.id },
          })
          .catch((e) => console.error("Consultancy 6h reminder failed:", e));
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

  async autoRefundExpiredContracts(referenceDate = new Date()) {
    const expiredContracts = await prisma.consultancyContract.findMany({
      where: {
        status: ConsultancyContractStatus.ACTIVE,
        paymentStatus: ConsultancyPaymentStatus.CAPTURED,
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
      let mpRefundId: string | null = null;
      let refundReason = `Prazo de ${env.CONSULTANCY_DELIVERY_DEADLINE_HOURS} horas expirado sem entrega do treino personalizado.`;

      if (contract.mpPaymentId) {
        try {
          const refund = await mpRefundClient.create({ payment_id: contract.mpPaymentId, body: {} });
          mpRefundId = String(refund.id);
        } catch (error) {
          // Não interrompe — registra o erro e marca o contrato como expirado sem reembolso gateway
          console.error("Consultancy refund failed (MP error):", { contractId: contract.id, error });
          refundReason = "Prazo expirado sem entrega. Reembolso via gateway falhou — pendente revisao manual.";
        }
      } else {
        refundReason = "Prazo expirado sem entrega. Contrato legado sem cobranca gateway registrada.";
      }

      await prisma.$transaction(async (tx) => {
        await tx.consultancyContract.update({
          where: { id: contract.id },
          data: { status: ConsultancyContractStatus.REFUNDED_EXPIRED, paymentStatus: ConsultancyPaymentStatus.REFUNDED, refundedAt: referenceDate, mpRefundId, refundReason }
        });
        await tx.consultancyRequest.update({ where: { id: contract.requestId }, data: { status: ConsultancyRequestStatus.EXPIRED_REFUNDED } });
      });

      void notificationService.sendToUsers([contract.clientId], { preferenceType: "CONSULTANCY", title: "Estorno automatico da consultoria", body: "Prazo de entrega expirado sem treino entregue. Valor estornado automaticamente.", data: { type: "CONSULTANCY_AUTO_REFUND", contractId: contract.id } });
      void notificationService.sendToUsers([contract.provider.userId], { preferenceType: "CONSULTANCY", title: "Contrato estornado por prazo expirado", body: "Contrato de consultoria expirou sem entrega e foi estornado ao aluno.", data: { type: "CONSULTANCY_CONTRACT_EXPIRED", contractId: contract.id } });
    };

    // Processar 5 em paralelo para não sobrecarregar a API do MP
    const CONCURRENCY = 5;
    for (let i = 0; i < expiredContracts.length; i += CONCURRENCY) {
      await Promise.allSettled(expiredContracts.slice(i, i + CONCURRENCY).map(processContract));
    }
  }
}
