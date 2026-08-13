import {
  BookingStatus,
  ConsultancyContractStatus,
  ConsultancyRequestStatus,
  ConsultancyPaymentStatus,
  CrefValidationStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma
} from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { createHmac, timingSafeEqual } from "crypto";
import * as Sentry from "@sentry/node";
import { Customer, CustomerCard, CardToken, Payment, PaymentRefund } from "mercadopago";
import { mp } from "../../../config/mercadopago";
import { env } from "../../../config/env";
import { prisma } from "../../../config/prisma";
import { paymentOperationTotal } from "../../../observability/metrics";
import { AppError } from "../../../shared/errors/app-error";
import { platformFeeAmount, providerSplitAmount } from "../../../shared/utils/platform-fee";
import { encryptSensitiveText, decryptSensitiveText } from "../../../shared/utils/encryption";
import { requireProviderMpAccessToken } from "../../../shared/utils/mp-provider-account";
import { recalculateProviderRatingAfterRefund } from "../../../shared/utils/provider-rating";
import { assertOfferAcceptsPaymentMethod } from "../../../shared/utils/offer-payment-method";
import { NotificationService } from "../../notifications/services/notification.service";
import { PresentialPackageService } from "../../presential-packages/services/presential-package.service";

type Tx = Prisma.TransactionClient | typeof prisma;

type CustomerCardSummary = {
  id: string;
  nickname: string;
  brand: string;
  last4: string;
  funding: "CREDIT" | "DEBIT" | "UNKNOWN";
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type ConfirmSetupIntentInput = {
  cardToken?: string;
  nickname?: string;
  makeDefault?: boolean;
};

type BookingPaymentPublicView = {
  id: string;
  bookingId: string;
  amountCents: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  failureReason: string | null;
};

// MP payment statuses
const MP_STATUS_AUTHORIZED = "authorized";
const MP_STATUS_APPROVED = "approved";
const MP_STATUS_PENDING = "pending";
const MP_STATUS_REJECTED = "rejected";
const MP_STATUS_CANCELLED = "cancelled";
const MP_STATUS_REFUNDED = "refunded";
const MP_STATUS_IN_PROCESS = "in_process";
const MP_STATUS_IN_MEDIATION = "in_mediation";
const MP_OAUTH_STATE_TTL_MS = 15 * 60 * 1000;
const MP_HTTP_TIMEOUT_MS = 10000;

async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = MP_HTTP_TIMEOUT_MS
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

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

function normalizeNickname(nickname?: string | null) {
  const value = (nickname ?? "").trim();
  return value.length ? value : "Cartao";
}

const notificationService = new NotificationService();
const presentialPackageService = new PresentialPackageService();
const mpPayment = new Payment(mp);
const mpCustomer = new Customer(mp);
const mpCustomerCard = new CustomerCard(mp);
const mpCardToken = new CardToken(mp);
const mpRefund = new PaymentRefund(mp);

async function writeAuditLog(input: {
  paymentId?: string | null;
  consultancyContractId?: string | null;
  fromStatus?: string | null;
  toStatus: string;
  triggeredBy: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await prisma.paymentAuditLog.create({
      data: {
        paymentId: input.paymentId ?? null,
        consultancyContractId: input.consultancyContractId ?? null,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus,
        triggeredBy: input.triggeredBy,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined
      }
    });
  } catch {
    // Audit log writes must never throw and break the main flow
  }
}

export class PaymentService {
  private toPublicBookingPayment(payment: {
    id: string;
    bookingId: string;
    amountCents: number;
    currency: string;
    method: PaymentMethod;
    status: PaymentStatus;
    failureReason?: string | null;
  }): BookingPaymentPublicView {
    return {
      id: payment.id,
      bookingId: payment.bookingId,
      amountCents: payment.amountCents,
      currency: payment.currency,
      method: payment.method,
      status: payment.status,
      // Frente 5 (Descoberta, agendamento e agenda), Lote 3: o campo
      // existe e é gravado ativamente em vários pontos do fluxo de
      // pagamento, mas nunca era selecionado/devolvido aqui — cliente e
      // profissional nunca viam o motivo real de uma falha, mesmo o
      // backend tendo a informação disponível.
      failureReason: payment.failureReason ?? null
    };
  }

  private createMpOauthState(providerId: string) {
    const payload = Buffer.from(
      JSON.stringify({ providerId, issuedAt: Date.now() }),
      "utf8"
    ).toString("base64url");
    const signature = createHmac("sha256", env.JWT_SECRET).update(payload).digest("base64url");
    return `v1.${payload}.${signature}`;
  }

  private parseMpOauthState(state: string) {
    const trimmed = state.trim();

    const [version, payload, signature] = trimmed.split(".");
    if (version !== "v1" || !payload || !signature) {
      return null;
    }

    const expected = createHmac("sha256", env.JWT_SECRET).update(payload).digest("base64url");
    const expectedBuffer = Buffer.from(expected, "utf8");
    const signatureBuffer = Buffer.from(signature, "utf8");
    const validSignature =
      expectedBuffer.length === signatureBuffer.length &&
      timingSafeEqual(expectedBuffer, signatureBuffer);
    if (!validSignature) {
      return null;
    }

    try {
      const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
        providerId?: string;
        issuedAt?: number;
      };
      if (!parsed.providerId || !parsed.issuedAt) {
        return null;
      }
      if (Date.now() - parsed.issuedAt > MP_OAUTH_STATE_TTL_MS) {
        return null;
      }
      return parsed.providerId;
    } catch {
      return null;
    }
  }

  private resolveConnectUrls(returnUrl?: string, refreshUrl?: string) {
    return {
      returnUrl: returnUrl ?? env.MP_CONNECT_RETURN_URL,
      refreshUrl: refreshUrl ?? env.MP_CONNECT_REFRESH_URL
    };
  }

  private async notifyBookingUsers(
    bookingId: string,
    input: {
      title: string;
      body: string;
      data?: Record<string, string | number | boolean>;
    }
  ) {
    try {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { provider: { select: { userId: true } } }
      });
      if (!booking) return;
      await notificationService.sendToUsers([booking.clientId, booking.provider.userId], {
        preferenceType: "PAYMENTS",
        title: input.title,
        body: input.body,
        data: { bookingId, ...input.data }
      });
    } catch (error) {
      console.error("Payment push notification failed:", error);
    }
  }

  private async ensureCustomerForUser(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError("Usuário não encontrado.", StatusCodes.NOT_FOUND);

    if (user.mpCustomerId) {
      return { user, customerId: user.mpCustomerId };
    }

    const nameParts = user.name.trim().split(" ");
    let customer: Awaited<ReturnType<typeof mpCustomer.create>>;
    try {
      customer = await mpCustomer.create({
        body: {
          email: user.email,
          first_name: nameParts[0] ?? user.name,
          last_name: nameParts.slice(1).join(" ") || undefined,
          phone: user.phone ? { number: user.phone } : undefined,
          description: `userId:${user.id}`
        }
      });
    } catch {
      throw new AppError(
        "Serviço de pagamento temporariamente indisponível. Tente novamente em instantes.",
        StatusCodes.SERVICE_UNAVAILABLE
      );
    }

    const customerId = String(customer.id);
    // updateMany WHERE mpCustomerId IS NULL previne race condition:
    // se outro request já criou o customer, não sobrescreve.
    await prisma.user.updateMany({
      where: { id: user.id, mpCustomerId: null },
      data: { mpCustomerId: customerId }
    });

    // Re-fetch para garantir que temos o customerId definitivo (o que foi gravado primeiro)
    const finalUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    return { user: finalUser, customerId: finalUser.mpCustomerId! };
  }

  private mapFundingToPaymentMethod(funding?: string | null) {
    if (funding === "debit") return PaymentMethod.DEBIT_CARD;
    if (funding === "credit") return PaymentMethod.CREDIT_CARD;
    return PaymentMethod.CARD;
  }

  private mapCardSummary(card: {
    id: string;
    nickname: string;
    brand: string;
    last4: string;
    funding: string | null;
    expMonth: number | null;
    expYear: number | null;
    isDefault: boolean;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): CustomerCardSummary {
    return {
      id: card.id,
      nickname: card.nickname,
      brand: card.brand,
      last4: card.last4,
      funding:
        card.funding === "credit" ? "CREDIT" : card.funding === "debit" ? "DEBIT" : "UNKNOWN",
      expMonth: card.expMonth,
      expYear: card.expYear,
      isDefault: card.isDefault,
      isActive: card.isActive,
      createdAt: card.createdAt.toISOString(),
      updatedAt: card.updatedAt.toISOString()
    };
  }

  private async upsertCustomerPaymentMethodFromMp(input: {
    userId: string;
    customerId: string;
    mpCardId: string;
    nickname?: string;
    makeDefault?: boolean;
  }) {
    const savedCard = await mpCustomerCard.get({
      customerId: input.customerId,
      cardId: input.mpCardId
    });

    const brand = String(savedCard.payment_method?.name ?? savedCard.payment_method?.id ?? "unknown");
    const last4 = String(savedCard.last_four_digits ?? "0000");
    const paymentTypeId = savedCard.payment_method?.payment_type_id ?? null;
    const funding =
      paymentTypeId === "debit_card"
        ? "debit"
        : paymentTypeId === "credit_card"
          ? "credit"
          : null;
    const expMonth = savedCard.expiration_month
      ? Number(savedCard.expiration_month)
      : null;
    const expYear = savedCard.expiration_year
      ? Number(String(savedCard.expiration_year).slice(-2))
      : null;

    const existingDefault = await prisma.customerPaymentMethod.findFirst({
      where: { userId: input.userId, isActive: true, isDefault: true },
      select: { id: true }
    });
    const shouldSetDefault = input.makeDefault === true || !existingDefault?.id;

    if (shouldSetDefault) {
      await prisma.customerPaymentMethod.updateMany({
        where: { userId: input.userId },
        data: { isDefault: false }
      });
    }

    const saved = await prisma.customerPaymentMethod.upsert({
      where: { mpCardId: input.mpCardId },
      update: {
        userId: input.userId,
        mpCustomerId: input.customerId,
        nickname: normalizeNickname(input.nickname),
        brand: brand.toUpperCase(),
        last4,
        funding,
        expMonth,
        expYear,
        isDefault: shouldSetDefault,
        isActive: true
      },
      create: {
        userId: input.userId,
        mpCustomerId: input.customerId,
        mpCardId: input.mpCardId,
        nickname: normalizeNickname(input.nickname),
        brand: brand.toUpperCase(),
        last4,
        funding,
        expMonth,
        expYear,
        isDefault: shouldSetDefault,
        isActive: true
      }
    });

    if (shouldSetDefault) {
      await prisma.user.update({
        where: { id: input.userId },
        data: { mpCustomerId: input.customerId, mpDefaultCardId: input.mpCardId }
      });
    }

    return saved;
  }

  async createPendingForBooking(
    tx: Tx,
    bookingId: string,
    amountCents: number,
    currency = "BRL",
    method: PaymentMethod = PaymentMethod.CREDIT_CARD,
    mpCardToken?: string | null
  ) {
    return tx.payment.create({
      data: {
        bookingId,
        amountCents,
        currency: currency.toUpperCase(),
        method,
        mpCardToken: mpCardToken ?? null,
        status: PaymentStatus.PENDING_AUTH
      }
    });
  }

  // Setup: client sends a card token (from frontend MP SDK) to save the card
  async setupCustomerPaymentMethod(userId: string, cardToken: string) {
    const { customerId } = await this.ensureCustomerForUser(userId);

    const savedCard = await mpCustomerCard.create({
      customerId,
      body: { token: cardToken }
    });

    const mpCardId = String(savedCard.id);
    await this.upsertCustomerPaymentMethodFromMp({
      userId,
      customerId,
      mpCardId,
      makeDefault: true
    });
  }

  // Returns the MP public key and customer ID so the frontend can tokenize a card
  async createCustomerSetupIntent(userId: string) {
    const { customerId } = await this.ensureCustomerForUser(userId);
    return {
      mpPublicKey: env.MP_PUBLIC_KEY,
      customerId,
      // Fields kept for API compatibility with mobile client
      setupIntentId: `mp_setup_${customerId}`,
      setupIntentClientSecret: env.MP_PUBLIC_KEY,
      ephemeralKeySecret: env.MP_PUBLIC_KEY
    };
  }

  // Called after frontend tokenizes a card and sends the token
  async confirmCustomerSetupIntent(
    userId: string,
    setupIntentId: string | undefined,
    input?: ConfirmSetupIntentInput
  ) {
    // setupIntentId is kept for backward compatibility with previous API contracts.
    void setupIntentId;

    if (!input?.cardToken) {
      throw new AppError("Token do cartão não informado.", StatusCodes.BAD_REQUEST);
    }

    const { user, customerId } = await this.ensureCustomerForUser(userId);

    const savedCard = await mpCustomerCard.create({
      customerId,
      body: { token: input.cardToken }
    });

    await this.upsertCustomerPaymentMethodFromMp({
      userId: user.id,
      customerId,
      mpCardId: String(savedCard.id),
      nickname: input.nickname,
      makeDefault: input.makeDefault
    });
  }

  async getCustomerPaymentStatus(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, mpCustomerId: true, mpDefaultCardId: true }
    });

    if (!user) throw new AppError("Usuário não encontrado.", StatusCodes.NOT_FOUND);

    // Frente 5 (Descoberta, agendamento e agenda), Lote 8: dívida do cliente
    // só era descoberta no submit final da criação de booking/pacote/
    // consultoria, depois de escolher categoria, data, horário e local —
    // a tela já busca esse status junto com o resto no carregamento
    // inicial, então dá pra avisar antes do cliente preencher tudo.
    const outstandingDebt = await prisma.debtRecord.findFirst({
      where: { clientId: userId, debtorType: "CLIENT", status: { in: ["PENDING", "NOTIFIED"] } },
      select: { id: true }
    });

    return {
      configured: Boolean(user.mpCustomerId && user.mpDefaultCardId),
      hasCustomer: Boolean(user.mpCustomerId),
      hasDefaultPaymentMethod: Boolean(user.mpDefaultCardId),
      hasOutstandingDebt: Boolean(outstandingDebt)
    };
  }

  async listCustomerCards(userId: string) {
    const cards = await prisma.customerPaymentMethod.findMany({
      where: { userId, isActive: true },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
    });
    return cards.map((item) => this.mapCardSummary(item));
  }

  async setDefaultCustomerCard(userId: string, cardId: string) {
    const card = await prisma.customerPaymentMethod.findFirst({
      where: { id: cardId, userId, isActive: true }
    });
    if (!card) throw new AppError("Cartão não encontrado.", StatusCodes.NOT_FOUND);

    await prisma.customerPaymentMethod.updateMany({
      where: { userId },
      data: { isDefault: false }
    });
    await prisma.customerPaymentMethod.update({
      where: { id: card.id },
      data: { isDefault: true }
    });
    await prisma.user.update({
      where: { id: userId },
      data: { mpCustomerId: card.mpCustomerId, mpDefaultCardId: card.mpCardId }
    });

    return this.listCustomerCards(userId);
  }

  async updateCustomerCardNickname(userId: string, cardId: string, nickname: string) {
    const card = await prisma.customerPaymentMethod.findFirst({
      where: { id: cardId, userId, isActive: true }
    });
    if (!card) throw new AppError("Cartão não encontrado.", StatusCodes.NOT_FOUND);

    await prisma.customerPaymentMethod.update({
      where: { id: card.id },
      data: { nickname: normalizeNickname(nickname) }
    });

    return this.listCustomerCards(userId);
  }

  async removeCustomerCard(userId: string, cardId: string) {
    const card = await prisma.customerPaymentMethod.findFirst({
      where: { id: cardId, userId, isActive: true }
    });
    if (!card) throw new AppError("Cartão não encontrado.", StatusCodes.NOT_FOUND);

    await prisma.customerPaymentMethod.update({
      where: { id: card.id },
      data: { isActive: false, isDefault: false }
    });

    try {
      await mpCustomerCard.remove({ customerId: card.mpCustomerId, cardId: card.mpCardId });
    } catch {
      // best effort
    }

    const nextDefault = await prisma.customerPaymentMethod.findFirst({
      where: { userId, isActive: true },
      orderBy: { createdAt: "asc" }
    });

    if (nextDefault) {
      await prisma.customerPaymentMethod.update({
        where: { id: nextDefault.id },
        data: { isDefault: true }
      });
      await prisma.user.update({
        where: { id: userId },
        data: { mpCustomerId: nextDefault.mpCustomerId, mpDefaultCardId: nextDefault.mpCardId }
      });
    } else {
      await prisma.user.update({
        where: { id: userId },
        data: { mpDefaultCardId: null }
      });
    }

    return this.listCustomerCards(userId);
  }

  async selectBookingPaymentMethod(
    userId: string,
    bookingId: string,
    input: { method: "CARD" | "PIX"; customerCardId?: string }
  ) {
    const payment = await prisma.payment.findUnique({
      where: { bookingId },
      include: { booking: true }
    });

    if (!payment) throw new AppError("Pagamento não encontrado para este agendamento.", StatusCodes.NOT_FOUND);
    if (payment.booking.clientId !== userId) {
      throw new AppError("Apenas o cliente pode alterar o método de pagamento deste agendamento.", StatusCodes.FORBIDDEN);
    }
    if (payment.status === PaymentStatus.CAPTURED || payment.status === PaymentStatus.REFUNDED) {
      throw new AppError("Pagamento já finalizado; não é possível alterar o metodo.", StatusCodes.BAD_REQUEST);
    }

    // Épico de Frentes, Frente 6 (Ofertas do profissional), Lote 3: a
    // criação do booking já valida acceptsPix/acceptsDebitCard/
    // acceptsCreditCard da oferta vinculada, mas o cliente podia trocar de
    // método aqui depois, contornando a restrição por completo.
    const offer = payment.booking.offerId
      ? await prisma.providerServiceOffer.findUnique({ where: { id: payment.booking.offerId } })
      : null;

    if (input.method === "PIX") {
      if (offer) assertOfferAcceptsPaymentMethod(offer, "PIX", "este agendamento");
      const updated = await prisma.payment.update({
        where: { id: payment.id },
        data: { method: PaymentMethod.PIX, mpCardToken: null }
      });
      return this.toPublicBookingPayment(updated);
    }

    const card = await prisma.customerPaymentMethod.findFirst({
      where: { id: input.customerCardId, userId, isActive: true }
    });
    if (!card) throw new AppError("Cartão selecionado não encontrado.", StatusCodes.NOT_FOUND);

    const selectedMethod = this.mapFundingToPaymentMethod(card.funding);
    if (offer) assertOfferAcceptsPaymentMethod(offer, selectedMethod, "este agendamento");
    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: { method: selectedMethod, mpCardToken: card.mpCardId }
    });
    return this.toPublicBookingPayment(updated);
  }

  private async resolveProviderAccessToken(providerId: string): Promise<string> {
    return requireProviderMpAccessToken(providerId);
  }

  async createProviderOnboardingLink(userId: string, returnUrl?: string, refreshUrl?: string) {
    const connectUrls = this.resolveConnectUrls(returnUrl, refreshUrl);
    const provider = await prisma.providerProfile.findFirst({ where: { userId } });

    if (!provider) throw new AppError("Perfil profissional não encontrado.", StatusCodes.NOT_FOUND);
    if (provider.crefValidationStatus !== CrefValidationStatus.APPROVED) {
      throw new AppError(
        "Seu CREF ainda não foi aprovado. Esta funcionalidade ficará disponível quando seu CREF for aprovado.",
        StatusCodes.BAD_REQUEST
      );
    }

    const appId = env.MP_APP_ID?.trim();
    if (!appId) {
      throw new AppError(
        "Integracao Mercado Pago incompleta. Configure MP_APP_ID para onboarding.",
        StatusCodes.INTERNAL_SERVER_ERROR
      );
    }
    const state = this.createMpOauthState(provider.id);
    const oauthUrl = `https://auth.mercadopago.com.br/authorization?client_id=${appId}&response_type=code&platform_id=mp&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(connectUrls.returnUrl)}`;

    return { accountId: provider.mpAccountId ?? null, onboardingUrl: oauthUrl };
  }

  async getProviderConnectStatus(userId: string) {
    const provider = await prisma.providerProfile.findFirst({ where: { userId } });
    const hasAccount = Boolean(provider?.mpAccountId);
    // Raio-X de pagamentos, Lote 5: antes só conferia se existia um
    // mpAccountId salvo, nunca se o token ainda funciona de verdade — um
    // profissional cuja renovação de token falhou via
    // refreshProviderMpTokens continuava vendo "Ativo" aqui, sem saber que
    // as vendas dele já não estavam mais repassando.
    const needsReconnect = hasAccount && Boolean(provider?.mpTokenInvalidatedAt);
    return {
      hasAccount,
      accountId: provider?.mpAccountId ?? null,
      chargesEnabled: hasAccount && !needsReconnect,
      payoutsEnabled: hasAccount && !needsReconnect,
      needsReconnect
    };
  }

  async completeProviderOnboardingCallback(code: string, state: string) {
    const providerId = this.parseMpOauthState(state);
    if (!providerId) {
      throw new AppError("State de onboarding inválido ou expirado.", StatusCodes.BAD_REQUEST);
    }

    const appId = env.MP_APP_ID?.trim();
    const clientSecret = env.MP_CLIENT_SECRET?.trim();
    if (!appId || !clientSecret) {
      throw new AppError(
        "Integracao Mercado Pago incompleta. Configure MP_APP_ID e MP_CLIENT_SECRET.",
        StatusCodes.INTERNAL_SERVER_ERROR
      );
    }

    const tokenResponse = await fetchWithTimeout("https://api.mercadopago.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: appId,
        client_secret: clientSecret,
        code,
        redirect_uri: env.MP_CONNECT_RETURN_URL
      })
    });

    if (!tokenResponse.ok) {
      throw new AppError(
        "Falha ao finalizar conexao com o Mercado Pago. Tente novamente.",
        StatusCodes.BAD_GATEWAY
      );
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      user_id?: number | string;
    };

    const accountIdFromToken = tokenData.user_id ? String(tokenData.user_id) : null;
    let mpAccountId = accountIdFromToken;

    if (!mpAccountId && tokenData.access_token) {
      const meResponse = await fetchWithTimeout("https://api.mercadopago.com/users/me", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      if (meResponse.ok) {
        const meData = (await meResponse.json()) as { id?: number | string };
        if (meData.id) {
          mpAccountId = String(meData.id);
        }
      }
    }

    if (!mpAccountId) {
      throw new AppError(
        "Não foi possível identificar a conta Mercado Pago conectada.",
        StatusCodes.BAD_GATEWAY
      );
    }

    const provider = await prisma.providerProfile.findUnique({ where: { id: providerId } });
    if (!provider) {
      throw new AppError("Profissional não encontrado para concluir onboarding.", StatusCodes.NOT_FOUND);
    }

    const mpTokenExpiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : null;

    await prisma.providerProfile.update({
      where: { id: provider.id },
      data: {
        mpAccountId,
        mpAccessToken:    tokenData.access_token  ? encryptSensitiveText(tokenData.access_token)  : undefined,
        mpRefreshToken:   tokenData.refresh_token ? encryptSensitiveText(tokenData.refresh_token) : undefined,
        mpTokenExpiresAt: mpTokenExpiresAt ?? undefined,
        mpTokenInvalidatedAt: null,
      }
    });

    return { providerId: provider.id, mpAccountId };
  }

  async refreshProviderMpTokens() {
    const appId = env.MP_APP_ID?.trim();
    const clientSecret = env.MP_CLIENT_SECRET?.trim();
    if (!appId || !clientSecret) return;

    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const providers = await prisma.providerProfile.findMany({
      where: {
        mpRefreshToken: { not: null },
        mpTokenExpiresAt: { lt: thirtyDaysFromNow },
      },
      select: { id: true, userId: true, mpRefreshToken: true, mpTokenInvalidatedAt: true },
    });

    for (const provider of providers) {
      if (!provider.mpRefreshToken) continue;
      try {
        const refreshToken = decryptSensitiveText(provider.mpRefreshToken);
        if (!refreshToken) continue;
        const response = await fetchWithTimeout("https://api.mercadopago.com/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: appId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
          }),
        });
        if (!response.ok) {
          console.error(`[mp-token-refresh] provider ${provider.id}: HTTP ${response.status}`);
          // Raio-X de pagamentos, Lote 5: 400/401 aqui significa que o
          // refresh token em si não é mais válido (ex: profissional
          // revogou o acesso no painel do Mercado Pago) — tentar de novo
          // no próximo ciclo do job nunca vai resolver sozinho, diferente
          // de uma falha 5xx/rede passageira. Marca e avisa o profissional
          // uma única vez (só na transição de "ok" pra "inválido").
          if ((response.status === 400 || response.status === 401) && !provider.mpTokenInvalidatedAt) {
            // Épico de Frentes, Frente 7, Lote 10: `provider` aqui é um
            // snapshot lido no início do job (findMany, acima) - se o
            // profissional reconectou a conta bem no meio dessa janela
            // (entre o findMany e este ponto), o refresh token que acabamos
            // de tentar usar já está obsoleto, e essa falha 400/401 não
            // reflete o estado real da conexão. `updateMany` condicionado
            // ao mpRefreshToken ainda ser o mesmo do snapshot vira um no-op
            // nesse caso — evita marcar mpTokenInvalidatedAt (e notificar
            // "reconecte") logo depois de uma reconexão bem-sucedida.
            const claimed = await prisma.providerProfile.updateMany({
              where: { id: provider.id, mpRefreshToken: provider.mpRefreshToken, mpTokenInvalidatedAt: null },
              data: { mpTokenInvalidatedAt: new Date() }
            });
            if (claimed.count > 0) {
              void notificationService.sendToUsers([provider.userId], {
                preferenceType: "PAYMENTS",
                title: "Reconecte sua conta do Mercado Pago",
                body: "Perdemos a conexão com sua conta do Mercado Pago — suas vendas não estão sendo repassadas. Reconecte em Recebimentos para voltar a vender.",
                data: { type: "MP_TOKEN_INVALIDATED" }
              });
            }
          } else {
            // Frente 13 (segunda camada), Lote 4: 400/401 (acima) é o único
            // caso já tratado (token revogado pelo profissional) — qualquer
            // outro status (5xx da própria MP, client_id/client_secret
            // errado, etc.) só caía num console.error. Uma falha
            // sistemática aqui significa profissional deixando de receber
            // repasse sem ninguém do time saber, já que o comentário logo
            // acima já reconhece a gravidade disso.
            Sentry.captureMessage(
              `[mp-token-refresh] provider ${provider.id}: HTTP ${response.status} inesperado ao renovar token`,
              "error"
            );
            paymentOperationTotal.inc({ operation: "mp_token_refresh", result: "failure" });
          }
          continue;
        }
        const tokenData = (await response.json()) as {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
        };
        if (!tokenData.access_token) continue;
        const mpTokenExpiresAt = tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000)
          : null;
        await prisma.providerProfile.update({
          where: { id: provider.id },
          data: {
            mpAccessToken: encryptSensitiveText(tokenData.access_token),
            mpRefreshToken: tokenData.refresh_token
              ? encryptSensitiveText(tokenData.refresh_token)
              : undefined,
            mpTokenExpiresAt: mpTokenExpiresAt ?? undefined,
            mpTokenInvalidatedAt: null,
          },
        });
        paymentOperationTotal.inc({ operation: "mp_token_refresh", result: "success" });
      } catch (err) {
        console.error(`[mp-token-refresh] provider ${provider.id}:`, err);
        Sentry.captureException(err, {
          tags: { area: "mp-token-refresh" },
          extra: { providerId: provider.id }
        });
        paymentOperationTotal.inc({ operation: "mp_token_refresh", result: "failure" });
      }
    }
  }

  async createPixChargeForBooking(bookingId: string, userId: string) {
    const payment = await prisma.payment.findUnique({
      where: { bookingId },
      include: {
        booking: {
          include: { provider: true, client: true }
        }
      }
    });

    if (!payment) throw new AppError("Pagamento não encontrado para este agendamento.", StatusCodes.NOT_FOUND);
    if (payment.booking.clientId !== userId) {
      throw new AppError("Apenas o cliente do agendamento pode iniciar pagamento PIX.", StatusCodes.FORBIDDEN);
    }
    if (payment.method !== PaymentMethod.PIX) {
      throw new AppError("Este agendamento não está configurado para pagamento via PIX.", StatusCodes.BAD_REQUEST);
    }

    if (payment.status === PaymentStatus.CAPTURED) {
      return {
        paymentId: payment.id,
        bookingId,
        status: payment.status,
        method: payment.method,
        amountCents: payment.amountCents,
        pix: null
      };
    }

    let mpPay: Awaited<ReturnType<Payment["get"]>>;
    if (payment.mpPaymentId) {
      mpPay = await mpPayment.get({ id: payment.mpPaymentId });
    } else {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.AUTHORIZING, attempts: { increment: 1 }, failureReason: null }
      });

      const pixExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      try {
        const providerAccessToken = await this.resolveProviderAccessToken(payment.booking.provider.id);
        const providerNetCents  = providerSplitAmount(payment.amountCents);
        const platformFeeCents  = platformFeeAmount(payment.amountCents);

        mpPay = await mpPayment.create({
          body: {
            transaction_amount: payment.amountCents / 100,
            payment_method_id: "pix",
            date_of_expiration: pixExpiresAt,
            payer: {
              email: payment.booking.client.email,
              first_name: payment.booking.client.name.split(" ")[0],
              last_name: payment.booking.client.name.split(" ").slice(1).join(" ") || undefined
            },
            description: `Agendamento #${payment.bookingId}`,
            metadata: {
              bookingId: payment.bookingId,
              paymentId: payment.id,
              paymentMethod: PaymentMethod.PIX
            },
            ...(payment.booking.provider.mpAccountId
              ? {
                  collector: { id: Number(payment.booking.provider.mpAccountId) },
                  marketplace_fee: platformFeeCents / 100,
                }
              : {})
          },
          requestOptions: {
            idempotencyKey: `booking:${payment.bookingId}:pix:${payment.attempts + 1}`,
            ...{ accessToken: providerAccessToken }
          }
        });

        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            mpPaymentId: String(mpPay.id),
            providerAmountCents: providerNetCents,
            platformFeeCents,
            failureReason: null
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao gerar cobrança PIX";
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.FAILED, failureReason: message }
        });
        throw error;
      }
    }

    if (mpPay.status === MP_STATUS_APPROVED) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.CAPTURED,
          authorizedAt: new Date(),
          capturedAt: new Date(),
          failureReason: null
        }
      });
      // Gamificação: XP por serviço contratado via PIX (confirmação imediata)
      const pixBooking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { clientId: true } });
      if (pixBooking?.clientId) {
        const { onServicePurchased } = await import("../../gamification/services/gamification-events.service");
        void onServicePurchased(pixBooking.clientId, bookingId);
      }
      return {
        paymentId: payment.id, bookingId,
        status: PaymentStatus.CAPTURED, method: payment.method,
        amountCents: payment.amountCents, pix: null
      };
    }

    if (mpPay.status !== MP_STATUS_PENDING && mpPay.status !== MP_STATUS_IN_PROCESS) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED, failureReason: `Status PIX inesperado: ${mpPay.status}` }
      });
      throw new AppError("Não foi possível iniciar a cobrança PIX para este agendamento.", StatusCodes.BAD_REQUEST);
    }

    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.AUTHORIZING }
    });

    const pix = extractMpPixData(mpPay);

    return {
      paymentId: payment.id, bookingId,
      status: PaymentStatus.AUTHORIZING, method: payment.method,
      amountCents: payment.amountCents, pix
    };
  }

  async authorizeDuePayments(referenceDate = new Date()) {
    const upper = new Date(referenceDate.getTime() + env.PRE_AUTH_WINDOW_MINUTES * 60 * 1000);
    const payments = await prisma.payment.findMany({
      where: {
        method: { in: [PaymentMethod.CARD, PaymentMethod.CREDIT_CARD, PaymentMethod.DEBIT_CARD] },
        status: { in: [PaymentStatus.PENDING_AUTH, PaymentStatus.FAILED] },
        booking: {
          status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
          scheduledAt: { gt: referenceDate, lte: upper }
        }
      },
      include: { booking: { include: { client: true, provider: true } } },
      orderBy: { createdAt: "asc" },
      take: 500,
    });

    const CONCURRENCY = 10;
    for (let i = 0; i < payments.length; i += CONCURRENCY) {
      await Promise.allSettled(
        payments.slice(i, i + CONCURRENCY).map((p) =>
          this.authorizePayment(p.id)
            .then(() => {
              paymentOperationTotal.inc({ operation: "authorize_due", result: "success" });
            })
            .catch((err) => {
              console.error("Failed to authorize payment", { paymentId: p.id, error: err });
              // Frente 13 (segunda camada), Lote 4: authorizePayment relança
              // a exceção de propósito (pra quem chama via rota HTTP saber
              // que falhou), mas esse job em lote engolia o erro ANTES do
              // wrapper de payment-jobs.ts (que só tem Sentry pra falha do
              // job inteiro, nunca chega a rodar aqui). Falha em massa de
              // pré-autorização = sessão acontecendo sem garantia de
              // pagamento, sem ninguém saber.
              Sentry.captureException(err, {
                tags: { area: "payment-authorize-due" },
                extra: { paymentId: p.id }
              });
              paymentOperationTotal.inc({ operation: "authorize_due", result: "failure" });
            })
        )
      );
    }
  }

  async authorizePayment(paymentId: string) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { booking: { include: { client: true, provider: true } } }
    });
    if (!payment) throw new AppError("Pagamento não encontrado.", StatusCodes.NOT_FOUND);
    if (payment.status !== PaymentStatus.PENDING_AUTH && payment.status !== PaymentStatus.FAILED) {
      return payment;
    }
    if (payment.method === PaymentMethod.PIX) {
      throw new AppError(
        "Pagamento PIX deve ser iniciado pelo endpoint de cobrança PIX do agendamento.",
        StatusCodes.BAD_REQUEST
      );
    }

    const customerId = payment.booking.client.mpCustomerId;
    const selectedCardId = payment.mpCardToken || payment.booking.client.mpDefaultCardId;

    if (!customerId || !selectedCardId) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED, failureReason: "Cliente sem método de pagamento configurado." }
      });
      await this.notifyBookingUsers(payment.bookingId, {
        title: "Falha na pre-autorização",
        body: "Cliente sem método de pagamento configurado.",
        data: { type: "PAYMENT_AUTH_FAILED" }
      });
      throw new AppError("Cliente sem método de pagamento configurado.", StatusCodes.BAD_REQUEST);
    }

    const claimed = await prisma.payment.updateMany({
      where: { id: payment.id, status: { in: [PaymentStatus.PENDING_AUTH, PaymentStatus.FAILED] } },
      data: { status: PaymentStatus.AUTHORIZING, attempts: { increment: 1 } }
    });
    if (claimed.count === 0) {
      // Já sendo autorizado por outro worker — retorna estado atual do banco
      return prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    }

    try {
      // Create server-side token from saved card for off-session charge
      const tokenResult = await mpCardToken.create({
        body: { customer_id: customerId, card_id: selectedCardId }
      });
      const cardToken = String(tokenResult.id);

      const providerAccessToken = await this.resolveProviderAccessToken(payment.booking.provider.id);
      const providerNetCents    = providerSplitAmount(payment.amountCents);
      const platformFeeCents    = platformFeeAmount(payment.amountCents);

      const mpPay = await mpPayment.create({
        body: {
          transaction_amount: payment.amountCents / 100,
          token: cardToken,
          installments: 1,
          payer: {
            type: "customer",
            id: customerId,
            email: payment.booking.client.email
          },
          description: `Agendamento #${payment.bookingId}`,
          capture: false,
          metadata: {
            bookingId: payment.bookingId,
            paymentId: payment.id
          },
          ...(payment.booking.provider.mpAccountId
            ? {
                collector: { id: Number(payment.booking.provider.mpAccountId) },
                marketplace_fee: platformFeeCents / 100,
              }
            : {})
        },
        requestOptions: {
          idempotencyKey: `booking:${payment.bookingId}:auth:${payment.attempts + 1}`,
          ...{ accessToken: providerAccessToken }
        }
      });

      if (mpPay.status !== MP_STATUS_AUTHORIZED && mpPay.status !== MP_STATUS_APPROVED) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.FAILED,
            mpPaymentId: String(mpPay.id),
            failureReason: `Status inesperado: ${mpPay.status} / ${mpPay.status_detail}`
          }
        });
        await this.notifyBookingUsers(payment.bookingId, {
          title: "Falha na pre-autorização",
          body: "Não foi possível pré-autorizar o pagamento. Revise o método de pagamento.",
          data: { type: "PAYMENT_AUTH_FAILED" }
        });
        return payment;
      }

      const authorizedPayment = await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.AUTHORIZED,
          mpPaymentId: String(mpPay.id),
          authorizedAt: new Date(),
          providerAmountCents: providerNetCents,
          platformFeeCents,
          failureReason: null
        }
      });
      await this.notifyBookingUsers(payment.bookingId, {
        title: "Pagamento pré-autorizado",
        body: "Pre-autorização concluída com sucesso para este agendamento.",
        data: { type: "PAYMENT_AUTHORIZED" }
      });
      // Gamificação: XP por serviço contratado (pré-autorização = serviço confirmado)
      const clientId = payment.booking.client.id;
      if (clientId) {
        const { onServicePurchased } = await import("../../gamification/services/gamification-events.service");
        void onServicePurchased(clientId, payment.bookingId);
      }
      return authorizedPayment;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha na pre-autorização";
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED, failureReason: message }
      });
      await this.notifyBookingUsers(payment.bookingId, {
        title: "Falha na pre-autorização",
        body: "Não foi possível pré-autorizar o pagamento. Tente novamente mais tarde.",
        data: { type: "PAYMENT_AUTH_FAILED" }
      });
      throw error;
    }
  }

  async cancelPaymentForBooking(bookingId: string) {
    const payment = await prisma.payment.findUnique({ where: { bookingId } });
    if (!payment) return;

    // Frente 2 (segunda camada), Lote 5: trava atômica auto-expirável (mesmo
    // idioma de DisputeCase.resolvingLockedAt/ConsultancyContract.
    // renewalDeliveryLockedAt) contra duplo toque em "cancelar" disparando
    // duas chamadas concorrentes de estorno/cancelamento pro mesmo
    // pagamento. Expira sozinha em 30s caso o processo caia no meio.
    const staleThreshold = new Date(Date.now() - 30_000);
    const claimed = await prisma.payment.updateMany({
      where: {
        id: payment.id,
        status: payment.status,
        OR: [{ mutationLockedAt: null }, { mutationLockedAt: { lt: staleThreshold } }]
      },
      data: { mutationLockedAt: new Date() }
    });
    if (claimed.count === 0) {
      // Já sendo cancelado/estornado por outra chamada concorrente.
      return;
    }

    try {
    if (payment.status === PaymentStatus.CAPTURED && payment.mpPaymentId) {
      try {
        const refund = await mpRefund.create({
          payment_id: payment.mpPaymentId,
          body: {},
          // Frente 2 (segunda camada), Lote 4: sem isso, um timeout de rede
          // seguido de retry (manual ou automático) podia gerar dois
          // estornos reais no gateway pro mesmo pagamento — chave estável
          // por pagamento, igual em qualquer retry desta mesma operação.
          requestOptions: { idempotencyKey: `booking:${bookingId}:refund` }
        });
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.REFUNDED,
            refundedAt: new Date(),
            mpChargeId: payment.mpPaymentId
          }
        });
        void writeAuditLog({
          paymentId: payment.id,
          fromStatus: PaymentStatus.CAPTURED,
          toStatus: PaymentStatus.REFUNDED,
          triggeredBy: "cancel_booking",
          metadata: { mpRefundId: String(refund.id) }
        });
        await this.notifyBookingUsers(bookingId, {
          title: "Pagamento estornado",
          body: "Pagamento cancelado e estorno realizado para o cliente.",
          data: { type: "PAYMENT_REFUNDED" }
        });
        await recalculateProviderRatingAfterRefund(bookingId).catch((error) =>
          console.error(`Falha ao recalcular rating do profissional após estorno do agendamento ${bookingId}:`, error)
        );
      } catch (error) {
        // Dinheiro já cobrado de verdade (CAPTURED) e o estorno no gateway
        // falhou — nunca deixar essa exceção subir (o agendamento precisa
        // terminar cancelado do mesmo jeito); em vez disso, abre um caso de
        // disputa pra revisão manual, igual ao padrão já usado em
        // consultancy.service.ts e no cancelamento de pacote presencial.
        console.error("cancelPaymentForBooking: estorno falhou (MP error):", { bookingId, paymentId: payment.id, error });
        Sentry.captureException(error, { tags: { area: "payments" }, extra: { bookingId, paymentId: payment.id, phase: "refund_failed" } });
        const booking = await prisma.booking.findUnique({
          where: { id: bookingId },
          select: { clientId: true, providerId: true }
        });
        if (booking) {
          await prisma.disputeCase.create({
            data: {
              type: "REFUND_FAILED",
              clientId: booking.clientId,
              providerId: booking.providerId,
              amountCents: payment.amountCents,
              mpPaymentId: payment.mpPaymentId,
              bookingId,
              contextNote: "Reembolso automático falhou ao cancelar agendamento presencial."
            }
          });
        }
        await this.notifyBookingUsers(bookingId, {
          title: "Estorno pendente de revisão",
          body: "Não conseguimos confirmar o estorno automaticamente — nossa equipe já foi avisada e vai resolver manualmente.",
          data: { type: "PAYMENT_REFUND_FAILED" }
        });
      }
      return;
    }

    if (!payment.mpPaymentId) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.CANCELED, canceledAt: new Date() }
      });
      await this.notifyBookingUsers(bookingId, {
        title: "Pagamento cancelado",
        body: "Pagamento do agendamento foi cancelado.",
        data: { type: "PAYMENT_CANCELED" }
      });
      return;
    }

    // Cancel authorized (not yet captured) payment
    if (payment.status === PaymentStatus.AUTHORIZED) {
      try {
        await mpPayment.cancel({
          id: payment.mpPaymentId,
          requestOptions: { idempotencyKey: `booking:${bookingId}:cancel` }
        });
      } catch (error) {
        // Raio-X de pagamentos, Rodada 2, Lote 1: mesmo princípio do ramo
        // CAPTURED acima — nunca deixar essa exceção subir (o agendamento
        // precisa terminar cancelado do mesmo jeito). O hold no cartão do
        // cliente pode não ter sido liberado no gateway; abre disputa pra
        // revisão manual em vez de falhar em silêncio (console.error).
        console.error("cancelPaymentForBooking: cancelamento de pré-autorização falhou (MP error):", {
          bookingId,
          paymentId: payment.id,
          error
        });
        Sentry.captureException(error, { tags: { area: "payments" }, extra: { bookingId, paymentId: payment.id, phase: "preauth_cancel_failed" } });
        const booking = await prisma.booking.findUnique({
          where: { id: bookingId },
          select: { clientId: true, providerId: true }
        });
        if (booking) {
          await prisma.disputeCase.create({
            data: {
              type: "REFUND_FAILED",
              clientId: booking.clientId,
              providerId: booking.providerId,
              amountCents: payment.amountCents,
              mpPaymentId: payment.mpPaymentId,
              bookingId,
              contextNote: "Cancelamento de pré-autorização (hold no cartão) falhou ao cancelar agendamento presencial — pagamento nunca foi capturado."
            }
          });
        }
        await this.notifyBookingUsers(bookingId, {
          title: "Cancelamento pendente de revisão",
          body: "Não conseguimos confirmar a liberação do valor pré-autorizado — nossa equipe já foi avisada e vai resolver manualmente.",
          data: { type: "PAYMENT_REFUND_FAILED" }
        });
        // Não marca o Payment como CANCELED — o hold pode ainda estar ativo
        // no gateway, e mentir sobre o estado local atrapalharia qualquer
        // tentativa de resolução manual depois (mesmo princípio do ramo
        // CAPTURED acima, que também não atualiza o status em caso de falha).
        return;
      }
    }

    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.CANCELED, canceledAt: new Date() }
    });
    await this.notifyBookingUsers(bookingId, {
      title: "Pagamento cancelado",
      body: "Pagamento do agendamento foi cancelado.",
      data: { type: "PAYMENT_CANCELED" }
    });
    } catch (error) {
      await prisma.payment
        .updateMany({ where: { id: payment.id }, data: { mutationLockedAt: null } })
        .catch((releaseError) => console.error("Falha ao liberar trava de cancelamento de pagamento:", releaseError));
      throw error;
    }
  }

  async capturePaymentForBooking(bookingId: string) {
    const payment = await prisma.payment.findUnique({ where: { bookingId } });
    if (!payment) throw new AppError("Pagamento não encontrado.", StatusCodes.NOT_FOUND);
    if (payment.status === PaymentStatus.CAPTURED) return payment;
    if (payment.status !== PaymentStatus.AUTHORIZED || !payment.mpPaymentId) {
      throw new AppError("Pagamento ainda não autorizado para captura.", StatusCodes.BAD_REQUEST);
    }

    // Frente 2 (segunda camada), Lote 5: claim atômico ANTES de chamar a MP.
    // Sem isso, a confirmação manual da sessão (confirmCompletion, trava por
    // pg_advisory_xact_lock) e o job de auto-captura (autoCaptureSingle
    // Confirmation, sem essa trava) podiam cruzar o mesmo bookingId quase ao
    // mesmo tempo e chamar mpPayment.capture() duas vezes pro mesmo
    // pagamento — o updateMany de capturedCount logo abaixo já protegia a
    // escrita local contra isso, mas não a chamada externa em si.
    const staleThreshold = new Date(Date.now() - 30_000);
    const claimed = await prisma.payment.updateMany({
      where: {
        id: payment.id,
        status: PaymentStatus.AUTHORIZED,
        OR: [{ mutationLockedAt: null }, { mutationLockedAt: { lt: staleThreshold } }]
      },
      data: { mutationLockedAt: new Date() }
    });
    if (claimed.count === 0) {
      // Já sendo capturado por outra chamada concorrente — devolve o estado atual.
      return prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    }

    try {
      const mpPay = await mpPayment.capture({
        id: payment.mpPaymentId,
        transaction_amount: payment.amountCents / 100,
        // Frente 2 (segunda camada), Lote 4: chave estável por pagamento —
        // qualquer retry desta mesma captura (timeout de rede, nova
        // tentativa manual) deve colidir com a mesma operação na MP, nunca
        // capturar duas vezes.
        requestOptions: { idempotencyKey: `booking:${bookingId}:capture` }
      });

      // Raio-X de pagamentos, Rodada 5, Lote 3: a MP pode responder 200 com um
      // status que não é approved (hold expirado, captura recusada) - o
      // retorno era descartado e o pagamento virava CAPTURED mesmo assim.
      // Mesma checagem que authorizePayment já faz sobre a própria resposta.
      if (mpPay.status !== MP_STATUS_APPROVED) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { failureReason: `Captura recusada pela MP: ${mpPay.status} / ${mpPay.status_detail}` }
        });
        throw new AppError(
          `Captura recusada pela Mercado Pago (status: ${mpPay.status}).`,
          StatusCodes.BAD_REQUEST
        );
      }

      // Marca como CAPTURED só se ainda AUTHORIZED (idempotência via updateMany)
      const capturedCount = await prisma.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.AUTHORIZED },
        data: {
          status: PaymentStatus.CAPTURED,
          capturedAt: new Date(),
          mpChargeId: payment.mpPaymentId
        }
      });
      const capturedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      // Épico de Frentes, Frente 12, Lote 2: audit log e notificação não eram
      // condicionados a este updateMany ter de fato mudado alguma linha -
      // diferente do resto do código de captura/webhook, que segue esse
      // padrão consistentemente. Sem a guarda, uma corrida entre a confirmação
      // manual da sessão e o job de auto-captura (mesmo bookingId cruzando o
      // limiar de AUTO_CAPTURE_CONFIRMATION_HOURS quase ao mesmo tempo) fazia
      // as duas chamadas passarem pelo check inicial antes de qualquer commit
      // e disparar push/log duplicado, mesmo sem nada de errado ter
      // acontecido de fato com o dinheiro (a MP em si é idempotente pro mesmo
      // mpPaymentId).
      if (capturedCount.count > 0) {
        void writeAuditLog({
          paymentId: payment.id,
          fromStatus: PaymentStatus.AUTHORIZED,
          toStatus: PaymentStatus.CAPTURED,
          triggeredBy: "capture_for_booking"
        });
        await this.notifyBookingUsers(bookingId, {
          title: "Pagamento efetivado",
          body: "Serviço concluído e pagamento capturado com sucesso.",
          data: { type: "PAYMENT_CAPTURED" }
        });
      }
      return capturedPayment;
    } catch (error) {
      await prisma.payment
        .updateMany({ where: { id: payment.id }, data: { mutationLockedAt: null } })
        .catch((releaseError) => console.error("Falha ao liberar trava de captura de pagamento:", releaseError));
      throw error;
    }
  }

  async captureIfAuthorizedForBooking(bookingId: string) {
    const payment = await prisma.payment.findUnique({ where: { bookingId } });
    if (!payment || payment.status !== PaymentStatus.AUTHORIZED) return null;
    return this.capturePaymentForBooking(bookingId);
  }

  // Igual a captureIfAuthorizedForBooking, mas nunca deixa a falha passar em
  // silêncio: usado nos pontos em que a cobrança acontece sem ninguém
  // presente pra tentar de novo na hora (cliente cancelou em cima da hora,
  // relato de falta resolvido automaticamente) — se a captura falhar, o
  // profissional ficaria sem receber por um serviço que já aconteceu, sem
  // que ninguém soubesse. Cria um caso de disputa (mesmo padrão do reembolso
  // que falha) em vez de engolir o erro.
  async captureIfAuthorizedForBookingOrDispute(bookingId: string, contextNote: string) {
    try {
      return await this.captureIfAuthorizedForBooking(bookingId);
    } catch (error) {
      console.error("captureIfAuthorizedForBookingOrDispute: captura falhou (MP error):", { bookingId, error });
      Sentry.captureException(error, { tags: { area: "payments" }, extra: { bookingId, phase: "capture_failed" } });
      const [payment, booking] = await Promise.all([
        prisma.payment.findUnique({ where: { bookingId } }),
        prisma.booking.findUnique({ where: { id: bookingId }, select: { clientId: true, providerId: true } })
      ]);
      if (payment && booking) {
        await prisma.disputeCase.create({
          data: {
            type: "CAPTURE_FAILED",
            clientId: booking.clientId,
            providerId: booking.providerId,
            amountCents: payment.amountCents,
            mpPaymentId: payment.mpPaymentId,
            bookingId,
            contextNote
          }
        });
      }
      await this.notifyBookingUsers(bookingId, {
        title: "Cobrança pendente de revisão",
        body: "Não conseguimos confirmar a cobrança automaticamente — nossa equipe já foi avisada e vai resolver manualmente.",
        data: { type: "PAYMENT_CAPTURE_FAILED" }
      });
      return null;
    }
  }

  async autoCaptureSingleConfirmation(referenceDate = new Date()) {
    const threshold = new Date(
      referenceDate.getTime() - env.AUTO_CAPTURE_CONFIRMATION_HOURS * 60 * 60 * 1000
    );
    const bookings = await prisma.booking.findMany({
      where: {
        status: BookingStatus.CONFIRMED,
        scheduledAt: { lte: threshold },
        OR: [
          { clientConfirmedAt: { not: null }, providerConfirmedAt: null },
          { clientConfirmedAt: null, providerConfirmedAt: { not: null } }
        ],
        payment: { status: PaymentStatus.AUTHORIZED }
      },
      take: 200,
    });

    const CONCURRENCY = 10;
    for (let i = 0; i < bookings.length; i += CONCURRENCY) {
      const results = await Promise.allSettled(
        bookings.slice(i, i + CONCURRENCY).map(async (booking) => {
          // Captura ANTES de marcar concluído — se a cobrança falhar, o
          // agendamento continua CONFIRMED (a própria consulta acima já
          // filtra por AUTHORIZED, então a próxima rodada do job tenta de
          // novo sozinha); antes, o agendamento era marcado concluído
          // primeiro e uma falha de captura ficava completamente invisível.
          await this.capturePaymentForBooking(booking.id);
          await prisma.booking.update({
            where: { id: booking.id },
            data: { status: BookingStatus.COMPLETED, completedAt: referenceDate }
          });
        })
      );
      results.forEach((result, idx) => {
        if (result.status === "rejected") {
          const bookingId = bookings[i + idx]?.id;
          console.error(
            "autoCaptureSingleConfirmation: falha ao capturar/concluir agendamento:",
            { bookingId, error: result.reason }
          );
          // Frente 13 (segunda camada), Lote 4: dinheiro já autorizado
          // (AUTHORIZED) que falha ao ser capturado fica retentando
          // silenciosamente a cada ciclo do job — se a falha for
          // persistente (não só uma instabilidade passageira da MP),
          // ninguém percebia sem abrir manualmente o log do processo.
          Sentry.captureException(result.reason, {
            tags: { area: "payment-auto-capture" },
            extra: { bookingId }
          });
          paymentOperationTotal.inc({ operation: "auto_capture", result: "failure" });
        } else {
          paymentOperationTotal.inc({ operation: "auto_capture", result: "success" });
        }
      });
    }
  }

  async getPaymentForBooking(bookingId: string, userId: string) {
    const payment = await prisma.payment.findUnique({
      where: { bookingId },
      select: {
        id: true,
        bookingId: true,
        amountCents: true,
        currency: true,
        method: true,
        status: true,
        failureReason: true,
        booking: {
          select: {
            clientId: true,
            provider: {
              select: { userId: true }
            }
          }
        }
      }
    });
    if (payment) {
      const canRead = payment.booking.clientId === userId || payment.booking.provider.userId === userId;
      if (!canRead) throw new AppError("Sem permissão para visualizar este pagamento.", StatusCodes.FORBIDDEN);
      return this.toPublicBookingPayment(payment);
    }

    // Raio-X de pagamentos, Rodada 2, Lote 4: bookings gerados por
    // activateCycle (sessões de pacote de horário fixo) nunca têm um
    // Payment próprio — o ciclo inteiro já foi cobrado de uma vez. Ausência
    // de Payment não é um erro aqui, é o estado esperado; devolve null em
    // vez de 404 pra não derrubar a tela de detalhe desses agendamentos.
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { clientId: true, provider: { select: { userId: true } } }
    });
    if (!booking) throw new AppError("Agendamento não encontrado.", StatusCodes.NOT_FOUND);
    const canRead = booking.clientId === userId || booking.provider.userId === userId;
    if (!canRead) throw new AppError("Sem permissão para visualizar este pagamento.", StatusCodes.FORBIDDEN);
    return null;
  }

  async processWebhookEvent(
    signature: string | string[] | undefined,
    rawBody: Buffer,
    queryParams?: Record<string, string | string[] | undefined>,
    requestIdHeader?: string | string[]
  ) {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    } catch {
      throw new AppError("Payload de webhook inválido.", StatusCodes.BAD_REQUEST);
    }

    const bodyDataId = String(
      (body["data"] as Record<string, unknown> | undefined)?.["id"] ?? body["id"] ?? ""
    );
    const queryDataIdRaw = queryParams?.["data.id"] ?? queryParams?.["id"];
    const queryDataId = Array.isArray(queryDataIdRaw) ? queryDataIdRaw[0] : queryDataIdRaw;
    const dataId = queryDataId ?? bodyDataId;

    if (!env.MP_WEBHOOK_SECRET) {
      throw new AppError("Webhook secret não configurado.", StatusCodes.INTERNAL_SERVER_ERROR);
    }

    {
      if (!signature || Array.isArray(signature)) {
        throw new AppError("Assinatura de webhook inválida.", StatusCodes.BAD_REQUEST);
      }

      const requestId = Array.isArray(requestIdHeader)
        ? requestIdHeader[0] ?? ""
        : (requestIdHeader ?? "");

      const parts = Object.fromEntries(
        signature
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean)
          .map((entry) => {
            const [key, value] = entry.split("=");
            return [key, value ?? ""] as [string, string];
          })
      );
      const ts = parts["ts"] ?? "";
      const v1 = parts["v1"] ?? "";

      if (!dataId || !requestId || !ts || !v1) {
        throw new AppError("Assinatura de webhook inválida.", StatusCodes.BAD_REQUEST);
      }

      const tsMs = Number(ts);
      if (isNaN(tsMs) || Date.now() - tsMs > 5 * 60 * 1000) {
        throw new AppError("Assinatura de webhook inválida.", StatusCodes.BAD_REQUEST);
      }

      const message = `id:${dataId};request-id:${requestId};ts:${ts};`;
      const expected = createHmac("sha256", env.MP_WEBHOOK_SECRET).update(message).digest("hex");
      const expectedBuffer = Buffer.from(expected, "utf8");
      const receivedBuffer = Buffer.from(v1, "utf8");
      const isValid =
        expectedBuffer.length === receivedBuffer.length &&
        timingSafeEqual(expectedBuffer, receivedBuffer);

      if (!isValid) {
        throw new AppError("Assinatura de webhook inválida.", StatusCodes.BAD_REQUEST);
      }
    }

    const topic = (body["topic"] ?? body["type"]) as string | undefined;

    if (!dataId) return;

    // Fetch the actual payment from MP
    if (topic === "payment" || topic === "payment.updated") {
      await this.handleMpPaymentNotification(dataId);
    }

    if (topic === "chargebacks") {
      await this.handleMpPaymentNotification(dataId);
    }
  }

  private async handleMpPaymentNotification(mpPaymentId: string) {
    let mpPay: Awaited<ReturnType<Payment["get"]>>;
    try {
      mpPay = await mpPayment.get({ id: mpPaymentId });
    } catch (error) {
      // Frente 2 (segunda camada), Lote 8: essa falha era engolida sem
      // nenhum log nem Sentry — se a MP ficasse instável por alguns
      // minutos, os webhooks recebidos nesse período eram descartados sem
      // rastro, e o pagamento ficava "pendente" pro cliente sem que
      // ninguém soubesse que a confirmação do webhook nunca chegou a
      // processar de verdade.
      console.error("handleMpPaymentNotification: falha ao buscar pagamento na MP:", { mpPaymentId, error });
      Sentry.captureException(error, { tags: { area: "payments" }, extra: { mpPaymentId, phase: "webhook_fetch_failed" } });
      return;
    }

    const mpStatus = mpPay.status;

    // Find booking payment
    const payment = await prisma.payment.findFirst({
      where: { mpPaymentId: String(mpPay.id) },
      select: {
        id: true, bookingId: true, status: true, amountCents: true,
        booking: { select: { clientId: true, providerId: true, priceCents: true } }
      }
    });

    // Find consultancy contract
    const consultancyContract = await prisma.consultancyContract.findFirst({
      where: { mpPaymentId: String(mpPay.id) },
      select: {
        id: true, requestId: true, clientId: true, paymentStatus: true, paymentAmountCents: true,
        provider: { select: { id: true, userId: true } }
      }
    });

    // Pix pendente de um ciclo de pacote presencial (cartao ja resolve
    // sincrono em chargeCycle - so Pix depende do webhook pra confirmar).
    const presentialPackagePending = await prisma.presentialPackage.findFirst({
      where: { pendingChargeMpPaymentId: String(mpPay.id) },
      select: { id: true }
    });

    // Épico de Frentes (fechamento, verificação pós-Frente 12): renovação de
    // ficha (TrainingPlan.renewalMpPaymentId) nunca era buscada aqui - um
    // chargeback/reembolso aberto direto no Mercado Pago sobre o pagamento
    // de uma renovação caía no "nao encontrado" abaixo e era silenciosamente
    // ignorado (nenhum DisputeCase, nenhum refundedAmountCents atualizado).
    const trainingPlanRenewal = await prisma.trainingPlan.findFirst({
      where: { renewalMpPaymentId: String(mpPay.id) },
      select: {
        id: true,
        providerId: true,
        contract: { select: { clientId: true, paymentAmountCents: true, provider: { select: { userId: true } } } }
      }
    });

    // Frente 9 (segunda camada), Lote 2: pendingChargeMpPaymentId só existe
    // ENQUANTO o Pix do ciclo está pendente - é zerado assim que o ciclo é
    // ativado (cartão nem passa por ali). Qualquer evento sobre um ciclo já
    // CAPTURADO (inclusive chargeback) caía direto no "não encontrado"
    // abaixo e nunca chegava no tratamento de disputa mais adiante, ao
    // contrário de payment/consultancyContract/trainingPlanRenewal, que já
    // são buscados pelo id definitivo (não um campo "pendente").
    const presentialPackageCycle = await prisma.presentialPackageCycle.findFirst({
      where: { mpPaymentId: String(mpPay.id) },
      select: {
        id: true,
        amountCents: true,
        packageId: true,
        package: { select: { clientId: true, providerId: true, provider: { select: { userId: true } } } }
      }
    });

    if (
      !payment &&
      !consultancyContract &&
      !presentialPackagePending &&
      !trainingPlanRenewal &&
      !presentialPackageCycle
    ) {
      console.warn(`[webhook] mpPaymentId ${mpPaymentId} nao encontrado em payment ou contract. Status: ${mpStatus}`);
      return;
    }

    if (mpStatus === MP_STATUS_PENDING || mpStatus === MP_STATUS_IN_PROCESS) {
      if (payment) {
        await prisma.payment.updateMany({
          where: { id: payment.id, status: PaymentStatus.PENDING_AUTH },
          data: { status: PaymentStatus.AUTHORIZING }
        });
      }
    }

    if (mpStatus === MP_STATUS_AUTHORIZED) {
      if (payment) {
        await prisma.payment.updateMany({
          where: { id: payment.id, status: PaymentStatus.PENDING_AUTH },
          data: { status: PaymentStatus.AUTHORIZED, authorizedAt: new Date(), failureReason: null }
        });
      }
    }

    if (mpStatus === MP_STATUS_APPROVED) {
      if (payment) {
        const updatedPayment = await prisma.payment.updateMany({
          where: { id: payment.id, status: { not: PaymentStatus.CAPTURED } },
          data: {
            status: PaymentStatus.CAPTURED,
            authorizedAt: new Date(),
            capturedAt: new Date(),
            failureReason: null
          }
        });
        if (updatedPayment.count > 0) {
          await this.notifyBookingUsers(payment.bookingId, {
            title: "Pagamento confirmado",
            body: "Pagamento confirmado com sucesso para este agendamento.",
            data: { type: "PAYMENT_CAPTURED" }
          });
        }
      }

      if (consultancyContract) {
        const updatedContract = await prisma.consultancyContract.updateMany({
          where: {
            id: consultancyContract.id,
            status: ConsultancyContractStatus.PENDING_PAYMENT,
            paymentStatus: { not: ConsultancyPaymentStatus.CAPTURED }
          },
          data: {
            paymentStatus: ConsultancyPaymentStatus.CAPTURED,
            paymentCapturedAt: new Date(),
            status: ConsultancyContractStatus.ACTIVE
          }
        });
        if (updatedContract.count > 0) {
          await notificationService.sendToUsers(
            [consultancyContract.clientId, consultancyContract.provider.userId],
            {
              preferenceType: "PAYMENTS",
              title: "Pagamento da consultoria confirmado",
              body: "Pagamento confirmado. A consultoria foi ativada com sucesso.",
              data: { type: "CONSULTANCY_PAYMENT_CAPTURED", contractId: consultancyContract.id }
            }
          );
        }
      }

      if (presentialPackagePending) {
        await presentialPackageService.confirmPendingPixCycle(String(mpPay.id));
      }
    }

    if (mpStatus === MP_STATUS_REJECTED || mpStatus === MP_STATUS_CANCELLED) {
      const newStatus = mpStatus === MP_STATUS_CANCELLED ? PaymentStatus.CANCELED : PaymentStatus.FAILED;

      if (payment) {
        // Raio-X de pagamentos, Lote 6: mesma proteção contra reenvio de
        // webhook já usada no caminho de sucesso — sem isso, cada reenvio
        // do mesmo aviso de recusa/cancelamento (comum e esperado do MP)
        // reenviava a notificação de novo, mesmo sem nada ter mudado.
        // Raio-X, Rodada 3, Lote 1: além disso, um webhook de recusa/
        // cancelamento ATRASADO (a MP reenvia eventos fora de ordem) não
        // pode reverter um pagamento que já foi resolvido de verdade —
        // "not: newStatus" só bloqueava reprocessar o mesmo status, não
        // impedia rebaixar um CAPTURED/REFUNDED pra FAILED/CANCELED.
        const updatedPayment = await prisma.payment.updateMany({
          where: {
            id: payment.id,
            status: {
              notIn: [
                newStatus,
                PaymentStatus.CAPTURED,
                PaymentStatus.REFUNDED,
                PaymentStatus.PARTIALLY_REFUNDED
              ]
            }
          },
          data: { status: newStatus, failureReason: String(mpPay.status_detail ?? mpStatus) }
        });
        if (updatedPayment.count > 0) {
          await this.notifyBookingUsers(payment.bookingId, {
            title: newStatus === PaymentStatus.CANCELED ? "Pagamento cancelado" : "Falha no pagamento",
            body: "Não foi possível confirmar o pagamento deste agendamento.",
            data: { type: "PAYMENT_AUTH_FAILED" }
          });
        }
      }

      if (consultancyContract) {
        // Mesma proteção monotônica: só reverte se o contrato ainda não
        // tiver sido resolvido de verdade (CAPTURED/REFUNDED) por um
        // evento mais novo que este webhook atrasado.
        const updatedContractCount = await prisma.$transaction(async (tx) => {
          const updated = await tx.consultancyContract.updateMany({
            where: {
              id: consultancyContract.id,
              paymentStatus: { notIn: [ConsultancyPaymentStatus.CAPTURED, ConsultancyPaymentStatus.REFUNDED] }
            },
            data: {
              paymentStatus: ConsultancyPaymentStatus.FAILED,
              status: ConsultancyContractStatus.PENDING_PAYMENT
            }
          });
          if (updated.count > 0) {
            await tx.consultancyRequest.update({
              where: { id: consultancyContract.requestId },
              data: { status: ConsultancyRequestStatus.RESPONDED, clientDecisionAt: null }
            });
          }
          return updated.count;
        });
        if (updatedContractCount > 0) {
          await notificationService.sendToUsers(
            [consultancyContract.clientId, consultancyContract.provider.userId],
            {
              preferenceType: "PAYMENTS",
              title: "Pagamento da consultoria falhou",
              body: "Não foi possível confirmar o pagamento da consultoria.",
              data: { type: "CONSULTANCY_PAYMENT_FAILED", contractId: consultancyContract.id }
            }
          );
        }
      }
    }

    if (mpStatus === MP_STATUS_REFUNDED) {
      // Raio-X de pagamentos, Rodada 2, Lote 2: reembolso parcial (valor
      // devolvido menor que o total cobrado) não é mais tratado igual a
      // reembolso total — o MP informa o valor já devolvido acumulado em
      // transaction_amount_refunded a cada notificação de reembolso. Vale
      // tanto pro Payment de booking quanto pro ConsultancyContract, já que
      // os dois podem ser reembolsados fora do fluxo de disputa do admin
      // (ex: chargeback processado direto no gateway).
      const refundedAmountReais = (mpPay as { transaction_amount_refunded?: number }).transaction_amount_refunded;

      if (payment) {
        const refundedAmountCents =
          refundedAmountReais != null && refundedAmountReais > 0
            ? Math.round(refundedAmountReais * 100)
            : payment.amountCents;
        const isPartial = refundedAmountCents < payment.amountCents;

        const updatedByWebhook = await prisma.payment.updateMany({
          // refundedAmountCents muda a cada notificação (parcial -> parcial
          // maior -> total) — comparar por ele em vez de status permite
          // processar reembolsos parciais sucessivos sem reprocessar o
          // mesmo valor duas vezes. NULL nunca bate com "not: X" em SQL, por
          // isso o OR explícito pro primeiro reembolso (campo ainda null).
          where: {
            id: payment.id,
            OR: [{ refundedAmountCents: null }, { refundedAmountCents: { not: refundedAmountCents } }]
          },
          data: {
            status: isPartial ? PaymentStatus.PARTIALLY_REFUNDED : PaymentStatus.REFUNDED,
            refundedAt: new Date(),
            refundedAmountCents
          }
        });
        // Frente 5 (Descoberta, agendamento e agenda), Lote 4: reembolso
        // total notificado via webhook (ex: chargeback processado direto no
        // gateway) é outro caminho, além da resolução manual do admin, em
        // que uma sessão já avaliada podia ser estornada sem o rating do
        // profissional nunca ser corrigido.
        if (!isPartial && updatedByWebhook.count > 0) {
          await recalculateProviderRatingAfterRefund(payment.bookingId).catch((error) =>
            console.error(`Falha ao recalcular rating do profissional após estorno via webhook (booking ${payment.bookingId}):`, error)
          );
        }
      }
      if (consultancyContract) {
        // Épico de Frentes, Frente 12, Lote 1: mesmo bug do Payment acima -
        // um reembolso parcial marcava REFUNDED igual a total, fazendo o
        // contrato inteiro desaparecer da receita do Financeiro em vez de
        // só a fração devolvida.
        const refundedAmountCentsContract =
          refundedAmountReais != null && refundedAmountReais > 0
            ? Math.round(refundedAmountReais * 100)
            : consultancyContract.paymentAmountCents;
        const isContractPartial = refundedAmountCentsContract < consultancyContract.paymentAmountCents;

        await prisma.consultancyContract.updateMany({
          where: {
            id: consultancyContract.id,
            // Fechamento pós-Frente 12: guard trocado de status (notIn) pra
            // valor (mesmo padrão do Payment acima) - com notIn, a primeira
            // notificação de reembolso parcial marcava PARTIALLY_REFUNDED e
            // qualquer notificação seguinte (inclusive um complemento que
            // fecha em 100%) nunca mais batia no where, travando o contrato
            // no valor do primeiro parcial pra sempre.
            OR: [{ refundedAmountCents: null }, { refundedAmountCents: { not: refundedAmountCentsContract } }]
          },
          data: {
            paymentStatus: isContractPartial ? ConsultancyPaymentStatus.PARTIALLY_REFUNDED : ConsultancyPaymentStatus.REFUNDED,
            refundedAt: new Date(),
            refundedAmountCents: refundedAmountCentsContract
          }
        });
      }
      if (trainingPlanRenewal && trainingPlanRenewal.contract) {
        // Fechamento pós-Frente 12: mesma lacuna do ConsultancyContract acima,
        // mas pra renovação de ficha - cada renovação cobra o mesmo valor do
        // contrato original (ver chargeFichaRenewal em consultancy.service.ts).
        const totalAmount = trainingPlanRenewal.contract.paymentAmountCents;
        const refundedAmountCentsPlan =
          refundedAmountReais != null && refundedAmountReais > 0
            ? Math.round(refundedAmountReais * 100)
            : totalAmount;

        await prisma.trainingPlan.updateMany({
          where: {
            id: trainingPlanRenewal.id,
            OR: [{ refundedAmountCents: null }, { refundedAmountCents: { not: refundedAmountCentsPlan } }]
          },
          data: { refundedAt: new Date(), refundedAmountCents: refundedAmountCentsPlan }
        });
      }
    }

    if (mpStatus === MP_STATUS_IN_MEDIATION) {
      // Raio-X de pagamentos, Rodada 2, Lote 2: antes esse status não caia
      // em nenhum branch — sumia sem log nem aviso, até (ou se) virar um
      // chargeback de verdade. Fase de mediação ainda pode ser resolvida
      // sem virar contestação — por isso só regista e avisa, sem criar
      // DisputeCase nem mudar o status do pagamento. Aguarda a escrita (ao
      // contrário do padrão fire-and-forget usado no ramo de chargeback)
      // porque este é o único rastro desse evento — sem outro efeito
      // colateral (dispute, mudança de status) pra garantir que o evento
      // não passou batido.
      await writeAuditLog({
        paymentId: payment?.id ?? null,
        consultancyContractId: consultancyContract?.id ?? null,
        fromStatus: payment?.status ?? null,
        toStatus: "IN_MEDIATION",
        triggeredBy: "mp_webhook:in_mediation",
        metadata: { mpPaymentId: String(mpPay.id) }
      });
      if (payment) {
        this.notifyBookingUsers(payment.bookingId, {
          title: "Pagamento em mediação",
          body: "O Mercado Pago abriu uma mediação para um pagamento deste agendamento. Nossa equipe está acompanhando.",
          data: { type: "PAYMENT_IN_MEDIATION" }
        }).catch((error) => console.error("In-mediation notification failed:", error));
      } else if (consultancyContract) {
        notificationService
          .sendToUsers([consultancyContract.clientId, consultancyContract.provider.userId], {
            preferenceType: "PAYMENTS",
            title: "Pagamento em mediação",
            body: "O Mercado Pago abriu uma mediação para um pagamento desta consultoria. Nossa equipe está acompanhando.",
            data: { type: "PAYMENT_IN_MEDIATION", contractId: consultancyContract.id }
          })
          .catch((error) => console.error("In-mediation notification failed:", error));
      }
    }

    if (mpStatus === "charged_back") {
      void writeAuditLog({
        paymentId: payment?.id ?? null,
        fromStatus: payment?.status ?? null,
        toStatus: "DISPUTED",
        triggeredBy: "mp_webhook:charged_back",
        metadata: { mpPaymentId: String(mpPay.id) }
      });

      // MP pode reenviar o mesmo webhook varias vezes — nao duplicar o caso.
      const existingDisputeCase = await prisma.disputeCase.findFirst({
        where: { mpPaymentId: String(mpPay.id), type: "CHARGEBACK" },
        select: { id: true }
      });

      // Raio-X de pagamentos, Lote 6: a criação do DisputeCase já era
      // idempotente (não duplica), mas a notificação disparava a cada
      // reenvio do mesmo webhook (comum e esperado do MP) — agora só
      // notifica na primeira vez que esse chargeback é visto.
      if (payment) {
        if (!existingDisputeCase) {
          this.notifyBookingUsers(payment.bookingId, {
            title: "Contestação de pagamento aberta",
            body: "Uma contestação foi aberta para um pagamento deste agendamento.",
            data: { type: "PAYMENT_DISPUTED" }
          }).catch((error) => console.error("Dispute notification failed:", error));

          await prisma.disputeCase.create({
            data: {
              type: "CHARGEBACK",
              clientId: payment.booking.clientId,
              providerId: payment.booking.providerId,
              amountCents: payment.booking.priceCents,
              mpPaymentId: String(mpPay.id),
              bookingId: payment.bookingId
            }
          });
        }
      } else if (consultancyContract) {
        if (!existingDisputeCase) {
          notificationService
            .sendToUsers(
              [consultancyContract.clientId, consultancyContract.provider.userId],
              {
                preferenceType: "PAYMENTS",
                title: "Contestação de pagamento aberta",
                body: "Uma contestação foi aberta para um pagamento desta consultoria.",
                data: { type: "PAYMENT_DISPUTED", contractId: consultancyContract.id }
              }
            )
            .catch((error) => console.error("Dispute notification failed:", error));

          await prisma.disputeCase.create({
            data: {
              type: "CHARGEBACK",
              clientId: consultancyContract.clientId,
              providerId: consultancyContract.provider.id,
              amountCents: consultancyContract.paymentAmountCents,
              mpPaymentId: String(mpPay.id),
              consultancyContractId: consultancyContract.id
            }
          });
        }
      } else if (trainingPlanRenewal && trainingPlanRenewal.contract) {
        // Fechamento pós-Frente 12: renovação de ficha contestada direto na
        // MP também precisa abrir DisputeCase, mesmo tratamento do contrato
        // original acima.
        if (!existingDisputeCase) {
          notificationService
            .sendToUsers(
              [trainingPlanRenewal.contract.clientId, trainingPlanRenewal.contract.provider.userId],
              {
                preferenceType: "PAYMENTS",
                title: "Contestação de pagamento aberta",
                body: "Uma contestação foi aberta para um pagamento de renovação de ficha.",
                data: { type: "PAYMENT_DISPUTED", trainingPlanId: trainingPlanRenewal.id }
              }
            )
            .catch((error) => console.error("Dispute notification failed:", error));

          await prisma.disputeCase.create({
            data: {
              type: "CHARGEBACK",
              clientId: trainingPlanRenewal.contract.clientId,
              providerId: trainingPlanRenewal.providerId,
              amountCents: trainingPlanRenewal.contract.paymentAmountCents,
              mpPaymentId: String(mpPay.id),
              trainingPlanId: trainingPlanRenewal.id
            }
          });
        }
      } else if (presentialPackageCycle) {
        if (!existingDisputeCase) {
          notificationService
            .sendToUsers(
              [presentialPackageCycle.package.clientId, presentialPackageCycle.package.provider.userId],
              {
                preferenceType: "PAYMENTS",
                title: "Contestação de pagamento aberta",
                body: "Uma contestação foi aberta para uma cobrança de pacote presencial.",
                data: { type: "PAYMENT_DISPUTED", packageId: presentialPackageCycle.packageId }
              }
            )
            .catch((error) => console.error("Dispute notification failed:", error));

          await prisma.disputeCase.create({
            data: {
              type: "CHARGEBACK",
              clientId: presentialPackageCycle.package.clientId,
              providerId: presentialPackageCycle.package.providerId,
              amountCents: presentialPackageCycle.amountCents ?? 0,
              mpPaymentId: String(mpPay.id),
              presentialPackageId: presentialPackageCycle.packageId,
              presentialPackageCycleId: presentialPackageCycle.id
            }
          });
        }
      }
    }
  }

  async autoExpirePixPayments(referenceDate = new Date()) {
    const threshold = new Date(referenceDate.getTime() - 26 * 60 * 60 * 1000); // 26h (margem extra)
    const expired = await prisma.payment.updateMany({
      where: {
        method: PaymentMethod.PIX,
        status: { in: [PaymentStatus.PENDING_AUTH, PaymentStatus.AUTHORIZING] },
        updatedAt: { lte: threshold },
      },
      data: { status: PaymentStatus.FAILED, failureReason: "PIX expirou apos 24 horas sem confirmacao" },
    });
    if (expired.count > 0) {
      console.info(`[payment-jobs] Auto-expired ${expired.count} PIX payments`);
    }
  }

  async autoRefundExpiredBookings() {
    const payments = await prisma.payment.findMany({
      where: {
        status: { in: [PaymentStatus.AUTHORIZING, PaymentStatus.AUTHORIZED, PaymentStatus.CAPTURED] },
        booking: { status: BookingStatus.CANCELLED }
      },
      select: { id: true, bookingId: true },
      take: 200,
    });

    const CONCURRENCY = 5;
    for (let i = 0; i < payments.length; i += CONCURRENCY) {
      await Promise.allSettled(
        payments.slice(i, i + CONCURRENCY).map((p) =>
          this.cancelPaymentForBooking(p.bookingId).catch((err) =>
            console.error("Auto-refund for expired booking failed", { paymentId: p.id, bookingId: p.bookingId, error: err })
          )
        )
      );
    }
  }
}
