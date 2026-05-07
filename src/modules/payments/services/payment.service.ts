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
import { Customer, CustomerCard, CardToken, Payment, PaymentRefund } from "mercadopago";
import { mp } from "../../../config/mercadopago";
import { env } from "../../../config/env";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { platformFeeAmount, providerSplitAmount } from "../../../shared/utils/platform-fee";
import { NotificationService } from "../../notifications/services/notification.service";

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
};

// MP payment statuses
const MP_STATUS_AUTHORIZED = "authorized";
const MP_STATUS_APPROVED = "approved";
const MP_STATUS_PENDING = "pending";
const MP_STATUS_REJECTED = "rejected";
const MP_STATUS_CANCELLED = "cancelled";
const MP_STATUS_REFUNDED = "refunded";
const MP_STATUS_IN_PROCESS = "in_process";
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
  }): BookingPaymentPublicView {
    return {
      id: payment.id,
      bookingId: payment.bookingId,
      amountCents: payment.amountCents,
      currency: payment.currency,
      method: payment.method,
      status: payment.status
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

    // Backward compatibility with previous plain format: provider:<providerId>
    if (trimmed.startsWith("provider:")) {
      const providerId = trimmed.slice("provider:".length).trim();
      return providerId || null;
    }

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
    await prisma.user.update({
      where: { id: user.id },
      data: { mpCustomerId: customerId }
    });

    return { user, customerId };
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

    return {
      configured: Boolean(user.mpCustomerId && user.mpDefaultCardId),
      hasCustomer: Boolean(user.mpCustomerId),
      hasDefaultPaymentMethod: Boolean(user.mpDefaultCardId)
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

    if (input.method === "PIX") {
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
    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: { method: selectedMethod, mpCardToken: card.mpCardId }
    });
    return this.toPublicBookingPayment(updated);
  }

  async createProviderConnectAccount(userId: string, returnUrl?: string, refreshUrl?: string) {
    const connectUrls = this.resolveConnectUrls(returnUrl, refreshUrl);
    const provider = await prisma.providerProfile.findFirst({ where: { userId } });
    if (!provider) throw new AppError("Perfil profissional não encontrado.", StatusCodes.NOT_FOUND);

    if (provider.crefValidationStatus !== CrefValidationStatus.APPROVED) {
      throw new AppError(
        "Seu CREF ainda não foi aprovado. Esta funcionalidade ficará disponível quando seu CREF for aprovado.",
        StatusCodes.BAD_REQUEST
      );
    }

    // Generate MP OAuth authorization URL for provider to connect their account
    const appId = env.MP_APP_ID?.trim();
    if (!appId) {
      throw new AppError(
        "Integracao Mercado Pago incompleta. Configure MP_APP_ID para onboarding.",
        StatusCodes.INTERNAL_SERVER_ERROR
      );
    }
    const state = this.createMpOauthState(provider.id);
    const oauthUrl = `https://auth.mercadopago.com.br/authorization?client_id=${appId}&response_type=code&platform_id=mp&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(connectUrls.returnUrl)}`;

    return {
      accountId: provider.mpAccountId ?? null,
      onboardingUrl: oauthUrl
    };
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
    return {
      hasAccount: Boolean(provider?.mpAccountId),
      accountId: provider?.mpAccountId ?? null,
      chargesEnabled: Boolean(provider?.mpAccountId),
      payoutsEnabled: Boolean(provider?.mpAccountId)
    };
  }

  async completeProviderOnboardingCallback(code: string, state: string) {
    const providerId = this.parseMpOauthState(state);
    if (!providerId) {
      throw new AppError("State de onboarding invalido ou expirado.", StatusCodes.BAD_REQUEST);
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
        "Nao foi possivel identificar a conta Mercado Pago conectada.",
        StatusCodes.BAD_GATEWAY
      );
    }

    const provider = await prisma.providerProfile.findUnique({ where: { id: providerId } });
    if (!provider) {
      throw new AppError("Profissional nao encontrado para concluir onboarding.", StatusCodes.NOT_FOUND);
    }

    await prisma.providerProfile.update({
      where: { id: provider.id },
      data: { mpAccountId }
    });

    return { providerId: provider.id, mpAccountId };
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
      throw new AppError("Este agendamento não esta configurado para pagamento via PIX.", StatusCodes.BAD_REQUEST);
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
          }
        },
        requestOptions: {
          idempotencyKey: `booking:${payment.bookingId}:pix:${payment.attempts + 1}`
        }
      });

      await prisma.payment.update({
        where: { id: payment.id },
        data: { mpPaymentId: String(mpPay.id), failureReason: null }
      });
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
      include: { booking: { include: { client: true, provider: true } } }
    });

    for (const payment of payments) {
      try {
        await this.authorizePayment(payment.id);
      } catch (error) {
        console.error("Failed to authorize payment", { paymentId: payment.id, error });
      }
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

    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.AUTHORIZING, attempts: { increment: 1 } }
    });

    try {
      // Create server-side token from saved card for off-session charge
      const tokenResult = await mpCardToken.create({
        body: { customer_id: customerId, card_id: selectedCardId }
      });
      const cardToken = String(tokenResult.id);

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
          }
        },
        requestOptions: {
          idempotencyKey: `booking:${payment.bookingId}:auth:${payment.attempts + 1}`
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
          failureReason: null
        }
      });
      await this.notifyBookingUsers(payment.bookingId, {
        title: "Pagamento pré-autorizado",
        body: "Pre-autorização concluída com sucesso para este agendamento.",
        data: { type: "PAYMENT_AUTHORIZED" }
      });
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

    if (payment.status === PaymentStatus.CAPTURED && payment.mpPaymentId) {
      const refund = await mpRefund.create({
        payment_id: payment.mpPaymentId,
        body: {}
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
      await mpPayment.cancel({ id: payment.mpPaymentId });
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
  }

  async capturePaymentForBooking(bookingId: string) {
    const payment = await prisma.payment.findUnique({ where: { bookingId } });
    if (!payment) throw new AppError("Pagamento não encontrado.", StatusCodes.NOT_FOUND);
    if (payment.status === PaymentStatus.CAPTURED) return payment;
    if (payment.status !== PaymentStatus.AUTHORIZED || !payment.mpPaymentId) {
      throw new AppError("Pagamento ainda não autorizado para captura.", StatusCodes.BAD_REQUEST);
    }

    await mpPayment.capture({
      id: payment.mpPaymentId,
      transaction_amount: payment.amountCents / 100
    });

    const capturedPayment = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.CAPTURED,
        capturedAt: new Date(),
        mpChargeId: payment.mpPaymentId
      }
    });
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
    return capturedPayment;
  }

  async captureIfAuthorizedForBooking(bookingId: string) {
    const payment = await prisma.payment.findUnique({ where: { bookingId } });
    if (!payment || payment.status !== PaymentStatus.AUTHORIZED) return null;
    return this.capturePaymentForBooking(bookingId);
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
      }
    });

    for (const booking of bookings) {
      await prisma.booking.update({
        where: { id: booking.id },
        data: { status: BookingStatus.COMPLETED, completedAt: referenceDate }
      });
      await this.capturePaymentForBooking(booking.id);
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
    if (!payment) throw new AppError("Pagamento não encontrado.", StatusCodes.NOT_FOUND);
    const canRead = payment.booking.clientId === userId || payment.booking.provider.userId === userId;
    if (!canRead) throw new AppError("Sem permissao para visualizar este pagamento.", StatusCodes.FORBIDDEN);
    return this.toPublicBookingPayment(payment);
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
      throw new AppError("Payload de webhook invalido.", StatusCodes.BAD_REQUEST);
    }

    const bodyDataId = String(
      (body["data"] as Record<string, unknown> | undefined)?.["id"] ?? body["id"] ?? ""
    );
    const queryDataIdRaw = queryParams?.["data.id"] ?? queryParams?.["id"];
    const queryDataId = Array.isArray(queryDataIdRaw) ? queryDataIdRaw[0] : queryDataIdRaw;
    const dataId = queryDataId ?? bodyDataId;

    if (env.MP_WEBHOOK_SECRET) {
      if (!signature || Array.isArray(signature)) {
        throw new AppError("Assinatura de webhook invalida.", StatusCodes.BAD_REQUEST);
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
        throw new AppError("Assinatura de webhook invalida.", StatusCodes.BAD_REQUEST);
      }

      const message = `id:${dataId};request-id:${requestId};ts:${ts};`;
      const expected = createHmac("sha256", env.MP_WEBHOOK_SECRET).update(message).digest("hex");
      const expectedBuffer = Buffer.from(expected, "utf8");
      const receivedBuffer = Buffer.from(v1, "utf8");
      const isValid =
        expectedBuffer.length === receivedBuffer.length &&
        timingSafeEqual(expectedBuffer, receivedBuffer);

      if (!isValid) {
        throw new AppError("Assinatura de webhook invalida.", StatusCodes.BAD_REQUEST);
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
    } catch {
      return;
    }

    const mpStatus = mpPay.status;

    // Find booking payment
    const payment = await prisma.payment.findFirst({
      where: { mpPaymentId: String(mpPay.id) },
      select: { id: true, bookingId: true, status: true }
    });

    // Find consultancy contract
    const consultancyContract = await prisma.consultancyContract.findFirst({
      where: { mpPaymentId: String(mpPay.id) },
      select: {
        id: true, requestId: true, clientId: true, paymentStatus: true,
        provider: { select: { userId: true } }
      }
    });

    if (mpStatus === MP_STATUS_APPROVED) {
      if (payment && payment.status !== PaymentStatus.CAPTURED) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.CAPTURED,
            authorizedAt: new Date(),
            capturedAt: new Date(),
            failureReason: null
          }
        });
        await this.notifyBookingUsers(payment.bookingId, {
          title: "Pagamento confirmado",
          body: "Pagamento confirmado com sucesso para este agendamento.",
          data: { type: "PAYMENT_CAPTURED" }
        });
      }

      if (consultancyContract && consultancyContract.paymentStatus !== ConsultancyPaymentStatus.CAPTURED) {
        await prisma.consultancyContract.update({
          where: { id: consultancyContract.id },
          data: {
            paymentStatus: ConsultancyPaymentStatus.CAPTURED,
            paymentCapturedAt: new Date(),
            status: ConsultancyContractStatus.ACTIVE
          }
        });
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

    if (mpStatus === MP_STATUS_REJECTED || mpStatus === MP_STATUS_CANCELLED) {
      const newStatus = mpStatus === MP_STATUS_CANCELLED ? PaymentStatus.CANCELED : PaymentStatus.FAILED;

      if (payment) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: newStatus, failureReason: String(mpPay.status_detail ?? mpStatus) }
        });
        await this.notifyBookingUsers(payment.bookingId, {
          title: newStatus === PaymentStatus.CANCELED ? "Pagamento cancelado" : "Falha no pagamento",
          body: "Não foi possível confirmar o pagamento deste agendamento.",
          data: { type: "PAYMENT_AUTH_FAILED" }
        });
      }

      if (consultancyContract) {
        await prisma.$transaction(async (tx) => {
          await tx.consultancyContract.update({
            where: { id: consultancyContract.id },
            data: {
              paymentStatus: ConsultancyPaymentStatus.FAILED,
              status: ConsultancyContractStatus.PENDING_PAYMENT
            }
          });
          await tx.consultancyRequest.update({
            where: { id: consultancyContract.requestId },
            data: { status: ConsultancyRequestStatus.RESPONDED, clientDecisionAt: null }
          });
        });
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

    if (mpStatus === "charged_back") {
      void writeAuditLog({
        paymentId: payment?.id ?? null,
        fromStatus: payment?.status ?? null,
        toStatus: "DISPUTED",
        triggeredBy: "mp_webhook:charged_back",
        metadata: { mpPaymentId: String(mpPay.id) }
      });

      if (payment) {
        this.notifyBookingUsers(payment.bookingId, {
          title: "Contestação de pagamento aberta",
          body: "Uma contestação foi aberta para um pagamento deste agendamento.",
          data: { type: "PAYMENT_DISPUTED" }
        }).catch((error) => console.error("Dispute notification failed:", error));
      }

      if (consultancyContract) {
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
      }
    }
  }

  async autoRefundExpiredBookings() {
    const payments = await prisma.payment.findMany({
      where: {
        status: { in: [PaymentStatus.AUTHORIZED, PaymentStatus.CAPTURED] },
        booking: { status: BookingStatus.CANCELLED }
      },
      select: { id: true, bookingId: true }
    });

    for (const payment of payments) {
      try {
        await this.cancelPaymentForBooking(payment.bookingId);
      } catch (error) {
        console.error("Auto-refund for expired booking failed", {
          paymentId: payment.id,
          bookingId: payment.bookingId,
          error
        });
      }
    }
  }
}
