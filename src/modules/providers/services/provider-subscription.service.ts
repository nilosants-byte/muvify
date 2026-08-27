import { Prisma, ProviderSubscriptionStatus, WaitlistAudience } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import * as Sentry from "@sentry/node";
import { CardToken, Payment } from "mercadopago";
import { mp } from "../../../config/mercadopago";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { NotificationService } from "../../notifications/services/notification.service";

const mpPaymentClient = new Payment(mp);
const mpCardTokenClient = new CardToken(mp);
const notificationService = new NotificationService();

// Bloco 5 (assinatura do profissional). Realinhamento com o Will (sócio),
// 2026-08-26: preço único R$29,90 pra todo mundo virou 3 faixas por posição
// na lista de espera (mesmo rank que já era calculado pra decidir fundador —
// só o limiar mudou de 1 corte pra 2):
//   - rank 0-99   (fundador): 90 dias trial, depois R$29,90/mês por 12
//     meses, depois R$39,90/mês (preço base) pra sempre.
//   - rank 100-199: 30 dias trial, depois R$39,90/mês direto (sem fase
//     promocional intermediária).
//   - rank 200+ (ou nunca esteve na lista de espera): sem trial,
//     R$39,90/mês desde o dia 1 — mesma extrapolação que o não-fundador já
//     tinha antes desta mudança.
const BASE_PRICE_CENTS = 3990;
const FOUNDER_PROMO_PRICE_CENTS = 2990;
const FOUNDER_TRIAL_DAYS = 90;
const FOUNDER_TRIAL_MS = FOUNDER_TRIAL_DAYS * 24 * 60 * 60 * 1000;
const EARLY_TRIAL_DAYS = 30;
const EARLY_TRIAL_MS = EARLY_TRIAL_DAYS * 24 * 60 * 60 * 1000;
const FOUNDER_SLOT_LIMIT = 100;
const EARLY_SLOT_LIMIT = 200;
const BILLING_CYCLE_DAYS = 30;
const BILLING_CYCLE_MS = BILLING_CYCLE_DAYS * 24 * 60 * 60 * 1000;
// Mesma convenção de "ano = 365 dias" já usada em billingCycleDurationDays
// (shared/utils/consultancy-validity.ts) pro ciclo ANNUAL. Só o fundador
// (preço promocional) precisa dessa trava — early/standard já nascem no
// preço base, não têm fase pra "vencer".
const PRICE_LOCK_MS = 365 * 24 * 60 * 60 * 1000;
// Sem card na mão / cobrança recusada: tenta de novo amanhã. Sem limite de
// tentativas nesta fase (dunning de verdade não é escopo do Bloco 5).
const RETRY_MS = 24 * 60 * 60 * 1000;

// Bloco 6 (bloqueio por assinatura inativa): única fonte de verdade da regra
// "assinatura permite usar o app" — TRIALING e ACTIVE liberam, PENDING_PAYMENT/
// PAST_DUE/CANCELED bloqueiam. `status` ausente (nenhum ProviderSubscription
// encontrado) libera de propósito: todo ProviderProfile real nasce com uma
// assinatura junto, atomicamente, dentro da mesma transação de
// createProfile (ver ProviderSubscriptionService.createSubscriptionForProvider)
// — a ÚNICA forma de um provider existir sem essa linha é um fixture de
// teste antigo que cria ProviderProfile direto via prisma (não passa por
// createProfile), de antes deste bloco existir. Bloquear esse caso quebraria
// esses testes sem representar nenhum risco real de produção (app ainda não
// lançado, sem dado legado pra migrar).
export function isProviderSubscriptionActive(status: ProviderSubscriptionStatus | null | undefined) {
  if (status == null) return true;
  return status === ProviderSubscriptionStatus.TRIALING || status === ProviderSubscriptionStatus.ACTIVE;
}

export function normalizePhoneDigits(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8) return null;
  // Últimos 10-11 dígitos — tolera DDI (+55) e formatação diferente entre o
  // que a pessoa digitou na landing page e no cadastro real.
  return digits.slice(-11);
}

type SignupTier = "FOUNDER" | "EARLY" | "STANDARD";

// Bate o e-mail/WhatsApp do profissional recém-cadastrado contra a lista de
// espera (audience PROFESSIONAL) pra decidir a faixa de preço/trial. Roda
// dentro da MESMA transação de ProviderService.createProfile — reivindicar
// o registro (claimedByProviderId) e criar o perfil precisam ser atômicos,
// senão duas criações de perfil quase simultâneas com o mesmo e-mail de
// waitlist poderiam reivindicar a mesma vaga duas vezes.
async function resolveSignupTier(
  tx: Prisma.TransactionClient,
  providerId: string,
  input: { email: string; phone: string | null }
): Promise<SignupTier> {
  let candidate = await tx.waitlistSignup.findFirst({
    where: { audience: WaitlistAudience.PROFESSIONAL, claimedByProviderId: null, email: input.email }
  });

  if (!candidate) {
    const normalizedPhone = normalizePhoneDigits(input.phone);
    if (normalizedPhone) {
      // whatsapp na waitlist é texto livre (sem formatação garantida) —
      // compara normalizado em memória em vez de tentar bater string bruta
      // no banco (evita falso-negativo por espaço/parêntese/DDI diferente).
      const unclaimed = await tx.waitlistSignup.findMany({
        where: { audience: WaitlistAudience.PROFESSIONAL, claimedByProviderId: null, whatsapp: { not: null } },
        select: { id: true, whatsapp: true }
      });
      const match = unclaimed.find((row) => normalizePhoneDigits(row.whatsapp) === normalizedPhone);
      if (match) {
        candidate = await tx.waitlistSignup.findUnique({ where: { id: match.id } });
      }
    }
  }

  // Nunca esteve na lista de espera (ou não bateu e-mail/WhatsApp): sem
  // benefício nenhum pra reivindicar, mesmo tratamento que rank 200+.
  if (!candidate) return "STANDARD";

  const rank = await tx.waitlistSignup.count({
    where: { audience: WaitlistAudience.PROFESSIONAL, createdAt: { lt: candidate.createdAt } }
  });
  const tier: SignupTier = rank < FOUNDER_SLOT_LIMIT ? "FOUNDER" : rank < EARLY_SLOT_LIMIT ? "EARLY" : "STANDARD";
  // STANDARD não ganha trial nem preço diferente — não precisa reivindicar
  // (nada a proteger de reivindicação dupla).
  if (tier === "STANDARD") return "STANDARD";

  // Raio-X pós-épico (achado médio-alto): antes era um `update` incondicional
  // — sob READ COMMITTED, duas transações concorrentes batendo no MESMO
  // candidate (ex: dois cadastros com o mesmo WhatsApp, já que User.phone
  // não é @unique) liam `claimedByProviderId: null` antes de qualquer uma
  // commitar, e as DUAS reivindicavam a mesma vaga. `updateMany` com a
  // condição repetida no `where` + checagem de `count` é uma trava atômica
  // de verdade (compare-and-swap) — mesmo padrão já usado corretamente em
  // claimExternalStudentInvite (consultancy.service.ts).
  const claimed = await tx.waitlistSignup.updateMany({
    where: { id: candidate.id, claimedByProviderId: null },
    data: { claimedByProviderId: providerId, claimedAt: new Date() }
  });
  // Perdeu a corrida (outro cadastro reivindicou primeiro): sem benefício,
  // mesmo tratamento de quem nunca esteve na lista.
  return claimed.count === 1 ? tier : "STANDARD";
}

type ChargeableSubscription = {
  id: string;
  providerId: string;
  status: ProviderSubscriptionStatus;
  priceCents: number;
  priceLockedUntil: Date | null;
  consecutiveFailedCharges: number;
  billingCycleIndex: number;
};

type ChargeableUser = {
  id: string;
  email: string;
  mpCustomerId: string | null;
};

// Raio-X pós-épico (achado alto): se `mpPaymentClient.create` lança por erro
// de rede/timeout, não dá pra saber se a MP chegou a processar a cobrança
// antes da resposta se perder — assumir "falhou" direto e tentar de novo
// amanhã (com idempotencyKey nova, já que consecutiveFailedCharges muda)
// cobraria em dobro se a cobrança original tiver sido aprovada de verdade.
// `external_reference` é estável por CICLO (não por tentativa), então
// qualquer tentativa aprovada dentro do mesmo ciclo aparece aqui não importa
// quantas tentativas incertas aconteceram antes.
// Raio-X focado (realinhamento com o Will, achado médio-alto): antes,
// "achei um pagamento" e "a própria busca falhou" devolviam o MESMO `null`
// pro chamador — indistinguíveis. Isso importa porque nesse meio-tempo o
// preço pode ter mudado (fundador cruzando a trava de 12 meses): se a busca
// realmente não achou nada, é seguro tratar como falha normal (nada foi
// cobrado, avança o contador, amanhã tenta de novo com valor atualizado).
// Mas se a BUSCA em si falhou (erro de rede na verificação, não só na
// cobrança original), continuamos sem saber se a cobrança original foi
// aprovada — tratar como falha normal geraria uma idempotencyKey NOVA
// amanhã, reabrindo o mesmo risco de cobrança em dobro (possivelmente com
// valores diferentes) que esta função inteira existe pra evitar.
type VerifyChargeResult =
  | { outcome: "found"; id: unknown; status?: string }
  | { outcome: "not_found" }
  | { outcome: "search_failed" };

async function verifyChargeAfterUncertainError(
  externalReference: string,
  subscriptionId: string
): Promise<VerifyChargeResult> {
  try {
    const result = await mpPaymentClient.search({
      options: { external_reference: externalReference, sort: "date_created", criteria: "desc" }
    });
    const found = result.results?.[0];
    return found ? { outcome: "found", id: found.id, status: found.status } : { outcome: "not_found" };
  } catch (searchError) {
    console.error("Provider subscription charge verify-after-error failed:", { subscriptionId, searchError });
    Sentry.captureException(searchError, {
      tags: { area: "provider-subscription-billing", phase: "verify_after_uncertain_error_failed" },
      extra: { subscriptionId, externalReference }
    });
    return { outcome: "search_failed" };
  }
}

// Raio-X focado (realinhamento com o Will, achado alto): único ponto que
// decide "qual preço vale agora" — antes só existia dentro de attemptCharge,
// calculado na hora de cobrar. `getMySubscription` devolvia `priceCents` cru
// do banco (só atualizado no sucesso da PRÓXIMA cobrança), então o app podia
// mostrar "R$29,90" pro fundador por até ~29 dias depois da trava de 12
// meses já ter vencido (365 dias não é múltiplo do ciclo de 30) — inclusive
// no exato momento em que o `chargeNow` automático ia cobrar R$39,90, sem
// nenhum aviso prévio na tela. Agora os dois (exibição e cobrança) usam a
// mesma função.
function computeEffectivePriceCents(
  priceCents: number,
  priceLockedUntil: Date | null,
  referenceDate: Date
): number {
  if (priceLockedUntil && referenceDate >= priceLockedUntil && priceCents < BASE_PRICE_CENTS) {
    return BASE_PRICE_CENTS;
  }
  return priceCents;
}

// Tenta cobrar UM ciclo da assinatura — reutilizada tanto pelo job diário
// (runSubscriptionBilling) quanto pela tentativa manual depois de salvar
// cartão novo (chargeNow). Cobrança direta pra plataforma, sem
// collector/marketplace_fee — mesmo formato que DebtService.payDebt usa
// pro caso "isProviderDebt" (profissional pagando a própria pendência, sem
// nenhum repasse envolvido).
async function attemptCharge(
  subscription: ChargeableSubscription,
  user: ChargeableUser,
  referenceDate: Date
): Promise<boolean> {
  const wasActive = subscription.status === ProviderSubscriptionStatus.ACTIVE ||
    subscription.status === ProviderSubscriptionStatus.PAST_DUE;

  // Realinhamento com o Will (2026-08-26): a trava de 12 meses do fundador
  // (priceLockedUntil) era gravada desde o Bloco 5 original mas nunca lida
  // em lugar nenhum — o preço promocional nunca subia de verdade. Calculado
  // aqui (não persistido antes de cobrar) pra cobrar o valor certo e
  // persistir só depois de confirmado — early/standard já nascem no preço
  // base, a condição `priceCents < BASE_PRICE_CENTS` nunca bate pra eles.
  const effectivePriceCents = computeEffectivePriceCents(
    subscription.priceCents,
    subscription.priceLockedUntil,
    referenceDate
  );

  const card = user.mpCustomerId
    ? await prisma.customerPaymentMethod.findFirst({
        where: { userId: user.id, isActive: true, funding: "CREDIT" },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
      })
    : null;

  let mpPay: Awaited<ReturnType<Payment["create"]>> | { id: unknown; status?: string } | null = null;
  // true só quando a VERIFICAÇÃO pós-erro-incerto em si falhou (não quando
  // ela rodou e genuinamente não achou nada) — ver comentário de
  // verifyChargeAfterUncertainError.
  let verifySearchFailed = false;

  // Estável por ciclo (não por tentativa) — usado tanto no idempotencyKey
  // quanto na verificação pós-erro-incerto abaixo.
  const externalReference = `provider-subscription:${subscription.id}:cycle:${subscription.billingCycleIndex}`;

  if (card && user.mpCustomerId) {
    try {
      const tokenResult = await mpCardTokenClient.create({
        body: { customer_id: user.mpCustomerId, card_id: card.mpCardId }
      });
      mpPay = await mpPaymentClient.create({
        body: {
          transaction_amount: effectivePriceCents / 100,
          token: String(tokenResult.id),
          installments: 1,
          payer: { type: "customer", id: user.mpCustomerId, email: user.email },
          description: "Assinatura Muvify",
          external_reference: externalReference,
          metadata: { domain: "PROVIDER_SUBSCRIPTION", subscriptionId: subscription.id }
        },
        requestOptions: {
          // Raio-X pós-épico: cycle muda só em sucesso, attempt muda a cada
          // falha — juntos garantem uma chave nova por ciclo de cobrança
          // real, nunca reaproveitando a chave do mês anterior (mesmo
          // padrão de presential-package.service.ts::chargeCycle).
          idempotencyKey: `${externalReference}:attempt:${subscription.consecutiveFailedCharges}`
        }
      });
    } catch (error) {
      console.error("Provider subscription charge failed (MP error):", { subscriptionId: subscription.id, error });
      // Erro incerto (rede/timeout) — confere na própria MP antes de
      // assumir que nada foi cobrado (ver comentário de
      // verifyChargeAfterUncertainError acima).
      const verifyResult = await verifyChargeAfterUncertainError(externalReference, subscription.id);
      if (verifyResult.outcome === "found") {
        mpPay = { id: verifyResult.id, status: verifyResult.status };
      } else if (verifyResult.outcome === "search_failed") {
        mpPay = null;
        verifySearchFailed = true;
      } else {
        mpPay = null;
      }
    }
  }

  if (mpPay && mpPay.status === "approved") {
    await prisma.providerSubscription.update({
      where: { id: subscription.id },
      data: {
        status: ProviderSubscriptionStatus.ACTIVE,
        lastChargeAt: referenceDate,
        lastChargeStatus: "SUCCESS",
        lastMpPaymentId: String(mpPay.id),
        nextBillingAt: new Date(referenceDate.getTime() + BILLING_CYCLE_MS),
        consecutiveFailedCharges: 0,
        billingCycleIndex: subscription.billingCycleIndex + 1,
        // Persiste o valor de verdade cobrado agora — se a trava de 12
        // meses do fundador acabou de vencer, isso grava o preço base pra
        // sempre (o cálculo acima não precisa se repetir nos próximos
        // ciclos).
        priceCents: effectivePriceCents,
        priceLockedUntil: subscription.priceLockedUntil ?? new Date(referenceDate.getTime() + PRICE_LOCK_MS)
      }
    });
    void notificationService
      .sendToUsers([user.id], {
        preferenceType: "PAYMENTS",
        title: wasActive ? "Assinatura renovada" : "Assinatura ativada",
        body: `Cobramos R$ ${(effectivePriceCents / 100).toFixed(2).replace(".", ",")} da sua assinatura Muvify.`,
        data: { type: "PROVIDER_SUBSCRIPTION_CHARGED", subscriptionId: subscription.id }
      })
      .catch((e) => console.error("Provider subscription charged notice failed:", e));
    return true;
  }

  // Raio-X pós-épico (achado baixo, mesma família do achado alto do Lote 2):
  // "in_process"/"pending" é uma resposta SÍNCRONA da própria MP, não um
  // erro de rede — mas ainda não é um resultado final (comum em análise
  // antifraude). Se tratássemos como falha definitiva, o
  // consecutiveFailedCharges avançaria e a idempotencyKey de amanhã seria
  // NOVA — se a cobrança de hoje for aprovada de forma assíncrona E a
  // tentativa de amanhã também for aprovada, cobra em dobro no mesmo ciclo.
  // Não avançar o contador aqui mantém a MESMA idempotencyKey amanhã, então
  // um retry só recupera o resultado final desta mesma cobrança (aprovada
  // ou rejeitada de vez), nunca cria uma nova.
  //
  // Raio-X focado (achado médio-alto): `verifySearchFailed` entra na MESMA
  // categoria — se a verificação pós-erro-incerto não conseguiu nem
  // CONFIRMAR que nada foi cobrado, ainda estamos incertos, não numa falha
  // genuína. Sem isso, o contador avançava mesmo sem confirmação nenhuma, e
  // se o preço tivesse acabado de subir (trava de 12 meses vencendo no meio
  // do caminho), o retry de amanhã cobraria um valor DIFERENTE do original
  // com uma idempotencyKey nova — reabrindo o mesmo risco de cobrança em
  // dobro que a verificação existe pra evitar, só que com valores diferentes
  // um do outro (mais difícil de detectar numa reconciliação).
  const isUncertainPendingOutcome =
    verifySearchFailed || (mpPay !== null && (mpPay.status === "in_process" || mpPay.status === "pending"));

  await prisma.providerSubscription.update({
    where: { id: subscription.id },
    data: {
      status: wasActive ? ProviderSubscriptionStatus.PAST_DUE : ProviderSubscriptionStatus.PENDING_PAYMENT,
      lastChargeAt: referenceDate,
      lastChargeStatus: isUncertainPendingOutcome ? "PENDING" : "FAILED",
      nextBillingAt: new Date(referenceDate.getTime() + RETRY_MS),
      consecutiveFailedCharges: isUncertainPendingOutcome
        ? subscription.consecutiveFailedCharges
        : subscription.consecutiveFailedCharges + 1
    }
  });
  void notificationService
    .sendToUsers([user.id], {
      preferenceType: "PAYMENTS",
      title: isUncertainPendingOutcome
        ? "Sua cobrança está em análise"
        : card
          ? "Não conseguimos cobrar sua assinatura"
          : "Adicione um cartão para ativar sua assinatura",
      body: isUncertainPendingOutcome
        ? "A cobrança da sua assinatura Muvify está em análise. Assim que for confirmada, avisamos por aqui."
        : card
          ? "A cobrança da sua assinatura Muvify falhou. Verifique seu cartão para tentarmos de novo."
          : "Sua assinatura Muvify está aguardando um cartão para ser ativada.",
      data: {
        type: isUncertainPendingOutcome ? "PROVIDER_SUBSCRIPTION_CHARGE_PENDING" : "PROVIDER_SUBSCRIPTION_CHARGE_FAILED",
        subscriptionId: subscription.id
      }
    })
    .catch((e) => console.error("Provider subscription charge-failed notice failed:", e));
  return false;
}

export class ProviderSubscriptionService {
  // Chamado de dentro da transação de ProviderService.createProfile, logo
  // depois de criar o ProviderProfile.
  async createSubscriptionForProvider(
    tx: Prisma.TransactionClient,
    providerId: string,
    input: { email: string; phone: string | null }
  ) {
    const tier = await resolveSignupTier(tx, providerId, input);
    const now = new Date();

    if (tier === "FOUNDER") {
      const trialEndsAt = new Date(now.getTime() + FOUNDER_TRIAL_MS);
      return tx.providerSubscription.create({
        data: {
          providerId,
          status: ProviderSubscriptionStatus.TRIALING,
          isFounder: true,
          priceCents: FOUNDER_PROMO_PRICE_CENTS,
          trialEndsAt,
          nextBillingAt: trialEndsAt
        }
      });
    }

    if (tier === "EARLY") {
      const trialEndsAt = new Date(now.getTime() + EARLY_TRIAL_MS);
      return tx.providerSubscription.create({
        data: {
          providerId,
          status: ProviderSubscriptionStatus.TRIALING,
          isFounder: false,
          priceCents: BASE_PRICE_CENTS,
          trialEndsAt,
          nextBillingAt: trialEndsAt
        }
      });
    }

    return tx.providerSubscription.create({
      data: {
        providerId,
        status: ProviderSubscriptionStatus.PENDING_PAYMENT,
        isFounder: false,
        priceCents: BASE_PRICE_CENTS,
        nextBillingAt: now
      }
    });
  }

  private async subscriptionForUser(userId: string) {
    const provider = await prisma.providerProfile.findFirst({
      where: { userId },
      select: { id: true, subscription: true }
    });
    if (!provider) {
      throw new AppError("Perfil profissional não encontrado.", StatusCodes.NOT_FOUND);
    }
    if (!provider.subscription) {
      throw new AppError("Assinatura não encontrada.", StatusCodes.NOT_FOUND);
    }
    return provider.subscription;
  }

  async getMySubscription(userId: string) {
    const subscription = await this.subscriptionForUser(userId);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        customerPaymentMethods: {
          where: { isActive: true, funding: "CREDIT" },
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
          select: { brand: true, last4: true }
        }
      }
    });
    const card = user.customerPaymentMethods[0] ?? null;
    return {
      status: subscription.status,
      isFounder: subscription.isFounder,
      // Raio-X focado (achado alto): antes devolvia `subscription.priceCents`
      // cru — o valor da ÚLTIMA cobrança bem-sucedida, não o que vale agora.
      // Recalcula com a mesma função que attemptCharge usa, pra nunca mostrar
      // um preço que já venceu.
      priceCents: computeEffectivePriceCents(subscription.priceCents, subscription.priceLockedUntil, new Date()),
      // Realinhamento com o Will (2026-08-26): mobile precisa saber "pra
      // qual preço isso vai subir depois do preço promocional acabar" sem
      // precisar cravar o valor no próprio app — só faz sentido mostrar
      // quando isFounder && priceCents < basePriceCents (ainda não subiu).
      basePriceCents: BASE_PRICE_CENTS,
      priceLockedUntil: subscription.priceLockedUntil,
      trialEndsAt: subscription.trialEndsAt,
      nextBillingAt: subscription.nextBillingAt,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      // Raio-X focado (achado baixo-médio): faltava aqui — cancelSubscription/
      // reactivateSubscription passaram a devolver esse shape (em vez do
      // registro cru do Prisma) e precisam continuar expondo esse campo.
      canceledAt: subscription.canceledAt,
      lastChargeAt: subscription.lastChargeAt,
      lastChargeStatus: subscription.lastChargeStatus,
      hasCard: Boolean(card),
      cardBrand: card?.brand ?? null,
      cardLast4: card?.last4 ?? null
    };
  }

  async cancelSubscription(userId: string) {
    const subscription = await this.subscriptionForUser(userId);
    if (subscription.status === ProviderSubscriptionStatus.ACTIVE) {
      await prisma.providerSubscription.update({
        where: { id: subscription.id },
        data: { cancelAtPeriodEnd: true, canceledAt: new Date() }
      });
      // Raio-X focado (achado baixo-médio): antes devolvia o registro cru
      // do Prisma, sem os campos extras (basePriceCents/hasCard/cardBrand/
      // cardLast4) que o tipo ProviderSubscription do mobile promete —
      // inofensivo hoje porque MySubscriptionScreen ignora o corpo dessas
      // mutations e só invalida a query, mas quebraria silenciosamente se
      // algum código futuro passasse a ler `.data`. `chargeNow` já devolve
      // getMySubscription() por esse mesmo motivo — os três endpoints agora
      // são consistentes.
      return this.getMySubscription(userId);
    }
    // Raio-X pós-épico (achado médio): antes só TRIALING cancelava na hora —
    // PENDING_PAYMENT/PAST_DUE não tinham NENHUM caminho de auto-serviço pra
    // sair (nem o botão aparecia no mobile), o profissional ficava recebendo
    // "não conseguimos cobrar" a cada 24h pra sempre sem conseguir cancelar.
    // Cancelamento imediato faz sentido nos três: nenhum tem período já pago
    // em aberto pra honrar (TRIALING nunca cobrou, PENDING_PAYMENT nunca
    // cobrou, PAST_DUE já falhou a cobrança do ciclo atual).
    if (
      subscription.status === ProviderSubscriptionStatus.TRIALING ||
      subscription.status === ProviderSubscriptionStatus.PENDING_PAYMENT ||
      subscription.status === ProviderSubscriptionStatus.PAST_DUE
    ) {
      await prisma.providerSubscription.update({
        where: { id: subscription.id },
        data: { status: ProviderSubscriptionStatus.CANCELED, canceledAt: new Date() }
      });
      return this.getMySubscription(userId);
    }
    throw new AppError("Não há assinatura ativa para cancelar.", StatusCodes.BAD_REQUEST);
  }

  async reactivateSubscription(userId: string) {
    const subscription = await this.subscriptionForUser(userId);
    // Raio-X pós-épico (achado crítico): antes só desfazia a flag
    // `cancelAtPeriodEnd`, sem checar se o job diário já tinha convertido
    // pra CANCELED de verdade (nextBillingAt já passou) — o profissional
    // via "reativado com sucesso" mas continuava 100% bloqueado, porque
    // `status` nunca voltava de CANCELED. Reabrir depois de já cancelada
    // exige uma cobrança nova (mesma lógica de "sem exceção" do resto do
    // épico) — não finge que o período anterior ainda vale.
    if (subscription.status === ProviderSubscriptionStatus.CANCELED) {
      await prisma.providerSubscription.update({
        where: { id: subscription.id },
        data: {
          status: ProviderSubscriptionStatus.PENDING_PAYMENT,
          cancelAtPeriodEnd: false,
          canceledAt: null,
          nextBillingAt: new Date()
        }
      });
      // Raio-X focado (achado baixo-médio): mesmo motivo do cancelSubscription
      // acima — devolve o shape completo (getMySubscription), não o registro
      // cru do Prisma, pra bater com o tipo que o mobile espera.
      return this.getMySubscription(userId);
    }
    if (!subscription.cancelAtPeriodEnd) {
      throw new AppError("Não há cancelamento agendado para desfazer.", StatusCodes.BAD_REQUEST);
    }
    await prisma.providerSubscription.update({
      where: { id: subscription.id },
      data: { cancelAtPeriodEnd: false, canceledAt: null }
    });
    return this.getMySubscription(userId);
  }

  async chargeNow(userId: string) {
    const subscription = await this.subscriptionForUser(userId);
    if (
      subscription.status !== ProviderSubscriptionStatus.PENDING_PAYMENT &&
      subscription.status !== ProviderSubscriptionStatus.PAST_DUE
    ) {
      throw new AppError("Esta assinatura não está aguardando pagamento.", StatusCodes.BAD_REQUEST);
    }
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, mpCustomerId: true }
    });
    const success = await attemptCharge(subscription, user, new Date());
    if (!success) {
      throw new AppError(
        "Não foi possível cobrar sua assinatura. Verifique o cartão cadastrado e tente novamente.",
        StatusCodes.BAD_REQUEST
      );
    }
    return this.getMySubscription(userId);
  }

  // Sub-job do reminder.job.ts — roda a cada tick do job (~60s), mas cada
  // assinatura só é tocada quando nextBillingAt <= referenceDate de verdade.
  async runSubscriptionBilling(referenceDate = new Date()) {
    const due = await prisma.providerSubscription.findMany({
      where: {
        nextBillingAt: { lte: referenceDate },
        status: {
          in: [
            ProviderSubscriptionStatus.TRIALING,
            ProviderSubscriptionStatus.ACTIVE,
            ProviderSubscriptionStatus.PENDING_PAYMENT,
            ProviderSubscriptionStatus.PAST_DUE
          ]
        }
      },
      include: { provider: { select: { userId: true } } },
      take: 200
    });

    for (const subscription of due) {
      if (subscription.cancelAtPeriodEnd) {
        await prisma.providerSubscription.update({
          where: { id: subscription.id },
          // Raio-X pós-épico (achado médio): `cancelAtPeriodEnd` continuava
          // true depois do job finalizar — a tela de assinatura mostrava
          // "CANCELADA" no topo E "Cancelamento agendado para [data já
          // passada]" com botão "Desfazer" logo abaixo, duas narrativas
          // contraditórias na mesma tela financeira.
          data: { status: ProviderSubscriptionStatus.CANCELED, cancelAtPeriodEnd: false }
        });
        void notificationService
          .sendToUsers([subscription.provider.userId], {
            preferenceType: "PAYMENTS",
            title: "Assinatura cancelada",
            body: "Sua assinatura Muvify foi encerrada, como você pediu.",
            data: { type: "PROVIDER_SUBSCRIPTION_CANCELED", subscriptionId: subscription.id }
          })
          .catch((e) => console.error("Provider subscription canceled notice failed:", e));
        continue;
      }

      const user = await prisma.user.findUnique({
        where: { id: subscription.provider.userId },
        select: { id: true, email: true, mpCustomerId: true }
      });
      if (!user) continue;
      await attemptCharge(subscription, user, referenceDate);
    }
  }
}
