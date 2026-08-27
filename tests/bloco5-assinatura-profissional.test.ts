import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { CardToken, Payment } from "mercadopago";
import { ProviderSubscriptionStatus, WaitlistAudience } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { ProviderService } from "../src/modules/providers/services/provider.service";
import { ProviderSubscriptionService } from "../src/modules/providers/services/provider-subscription.service";

// Bloco 5 (assinatura do profissional). Realinhamento com o Will (sócio),
// 2026-08-26: preço único virou 3 faixas por posição na lista de espera —
// rank 0-99 (fundador): 90 dias trial, R$29,90/mês por 12 meses, depois
// R$39,90/mês (preço base); rank 100-199: 30 dias trial, R$39,90/mês direto;
// rank 200+ (ou nunca esteve na waitlist): sem trial, R$39,90/mês desde o
// dia 1.

const providerService = new ProviderService();
const providerSubscriptionService = new ProviderSubscriptionService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function makeProviderUser(label: string, overrides: Partial<{ email: string; phone: string }> = {}) {
  const user = await prisma.user.create({
    data: {
      name: `Sub ${label}`,
      email: overrides.email ?? `${uid(`sub_${label}`)}@test.com`,
      password: "x",
      phone: overrides.phone ?? `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}`,
      role: "CLIENT"
    }
  });
  return user;
}

async function createProfileFor(userId: string, label: string) {
  return providerService.createProfile({
    userId,
    displayName: `Sub ${label} Provider`,
    bio: "test",
    experienceYears: 3,
    priceCents: 15000
  });
}

const userIdsToCleanup = new Set<string>();
const providerProfileIdsToCleanup = new Set<string>();
const waitlistIdsToCleanup = new Set<string>();

describe("Bloco 5 — assinatura do profissional", () => {
  beforeAll(async () => {
    await prisma.$connect();
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
  });

  afterAll(async () => {
    await prisma.providerSubscription.deleteMany({ where: { providerId: { in: Array.from(providerProfileIdsToCleanup) } } });
    await prisma.providerCategory.deleteMany({ where: { providerId: { in: Array.from(providerProfileIdsToCleanup) } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: Array.from(providerProfileIdsToCleanup) } } });
    await prisma.waitlistSignup.deleteMany({ where: { id: { in: Array.from(waitlistIdsToCleanup) } } });
    await prisma.user.deleteMany({ where: { id: { in: Array.from(userIdsToCleanup) } } });
    await prisma.$disconnect();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
  });

  it("createProfile SEM nenhum match na waitlist nasce PENDING_PAYMENT, sem trial, no preço base", async () => {
    const user = await makeProviderUser("nomatch1");
    userIdsToCleanup.add(user.id);

    const profile = await createProfileFor(user.id, "nomatch1");
    providerProfileIdsToCleanup.add(profile.id);

    const sub = await prisma.providerSubscription.findUniqueOrThrow({ where: { providerId: profile.id } });
    expect(sub.status).toBe(ProviderSubscriptionStatus.PENDING_PAYMENT);
    expect(sub.isFounder).toBe(false);
    expect(sub.trialEndsAt).toBeNull();
    expect(sub.priceCents).toBe(3990);
  });

  it("createProfile com e-mail batendo um dos 100 primeiros da waitlist nasce TRIALING fundador", async () => {
    const email = `${uid("founder_match")}@test.com`;
    const waitlist = await prisma.waitlistSignup.create({
      data: { email, audience: WaitlistAudience.PROFESSIONAL, name: "Fundador Teste" }
    });
    waitlistIdsToCleanup.add(waitlist.id);

    const user = await makeProviderUser("founder1", { email });
    userIdsToCleanup.add(user.id);

    const profile = await createProfileFor(user.id, "founder1");
    providerProfileIdsToCleanup.add(profile.id);

    const sub = await prisma.providerSubscription.findUniqueOrThrow({ where: { providerId: profile.id } });
    expect(sub.status).toBe(ProviderSubscriptionStatus.TRIALING);
    expect(sub.isFounder).toBe(true);
    expect(sub.priceCents).toBe(2990);
    expect(sub.trialEndsAt).not.toBeNull();
    const diffDays = (sub.trialEndsAt!.getTime() - sub.createdAt.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeCloseTo(90, 1);

    const reloadedWaitlist = await prisma.waitlistSignup.findUniqueOrThrow({ where: { id: waitlist.id } });
    expect(reloadedWaitlist.claimedByProviderId).toBe(profile.id);
    expect(reloadedWaitlist.claimedAt).not.toBeNull();
  });

  it("createProfile bate por WhatsApp normalizado quando o e-mail é diferente", async () => {
    const rawPhone = "+55 (11) 91234-5678";
    const waitlist = await prisma.waitlistSignup.create({
      data: {
        email: `${uid("founder_wa")}@waitlist-only.com`,
        audience: WaitlistAudience.PROFESSIONAL,
        whatsapp: rawPhone
      }
    });
    waitlistIdsToCleanup.add(waitlist.id);

    const user = await makeProviderUser("founder_wa", { phone: "(11) 9 1234-5678" });
    userIdsToCleanup.add(user.id);

    const profile = await createProfileFor(user.id, "founder_wa");
    providerProfileIdsToCleanup.add(profile.id);

    const sub = await prisma.providerSubscription.findUniqueOrThrow({ where: { providerId: profile.id } });
    expect(sub.isFounder).toBe(true);
  });

  it("não reivindica o mesmo registro da waitlist duas vezes (segundo profissional com o mesmo telefone normalizado não vira fundador)", async () => {
    const rawPhone = "11987654321";
    const waitlist = await prisma.waitlistSignup.create({
      data: {
        email: `${uid("founder_dup")}@waitlist-only.com`,
        audience: WaitlistAudience.PROFESSIONAL,
        whatsapp: rawPhone
      }
    });
    waitlistIdsToCleanup.add(waitlist.id);

    const userA = await makeProviderUser("dup_a", { phone: rawPhone });
    userIdsToCleanup.add(userA.id);
    const profileA = await createProfileFor(userA.id, "dup_a");
    providerProfileIdsToCleanup.add(profileA.id);
    const subA = await prisma.providerSubscription.findUniqueOrThrow({ where: { providerId: profileA.id } });
    expect(subA.isFounder).toBe(true);

    const userB = await makeProviderUser("dup_b", { phone: rawPhone });
    userIdsToCleanup.add(userB.id);
    const profileB = await createProfileFor(userB.id, "dup_b");
    providerProfileIdsToCleanup.add(profileB.id);
    const subB = await prisma.providerSubscription.findUniqueOrThrow({ where: { providerId: profileB.id } });
    expect(subB.isFounder).toBe(false);
    expect(subB.status).toBe(ProviderSubscriptionStatus.PENDING_PAYMENT);
  });

  it("createProfile com rank 100-199 (2ª faixa) nasce TRIALING de 30 dias, sem selo de fundador, no preço base", async () => {
    // Cria 100 registros PROFESSIONAL mais antigos (rank 0-99) antes do
    // nosso candidato — ele vira o 101º (rank 100), 1ª posição da 2ª faixa.
    const now = Date.now();
    const oldSignups = await Promise.all(
      Array.from({ length: 100 }).map((_, i) =>
        prisma.waitlistSignup.create({
          data: {
            email: `${uid(`rank_filler_${i}`)}@test.com`,
            audience: WaitlistAudience.PROFESSIONAL,
            createdAt: new Date(now - (200 - i) * 60 * 1000)
          }
        })
      )
    );
    oldSignups.forEach((s) => waitlistIdsToCleanup.add(s.id));

    const email = `${uid("rank101")}@test.com`;
    const waitlist = await prisma.waitlistSignup.create({
      data: { email, audience: WaitlistAudience.PROFESSIONAL, createdAt: new Date(now) }
    });
    waitlistIdsToCleanup.add(waitlist.id);

    const user = await makeProviderUser("rank101", { email });
    userIdsToCleanup.add(user.id);

    const profile = await createProfileFor(user.id, "rank101");
    providerProfileIdsToCleanup.add(profile.id);

    const sub = await prisma.providerSubscription.findUniqueOrThrow({ where: { providerId: profile.id } });
    expect(sub.isFounder).toBe(false);
    expect(sub.status).toBe(ProviderSubscriptionStatus.TRIALING);
    expect(sub.priceCents).toBe(3990);
    expect(sub.trialEndsAt).not.toBeNull();
    const diffDays = (sub.trialEndsAt!.getTime() - sub.createdAt.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeCloseTo(30, 1);

    // 2ª faixa também ganha benefício real (trial) — precisa proteger contra
    // reivindicação dupla igual ao fundador, diferente de rank 200+.
    const reloadedWaitlist = await prisma.waitlistSignup.findUniqueOrThrow({ where: { id: waitlist.id } });
    expect(reloadedWaitlist.claimedByProviderId).toBe(profile.id);

    // Limpa os 100 registros de preenchimento na hora — se ficarem até o
    // afterAll, poluem o rank calculado pelos testes seguintes deste mesmo
    // arquivo (rank é sempre contado sobre TODOS os WaitlistSignup
    // audience=PROFESSIONAL do banco, não só os deste teste).
    await prisma.waitlistSignup.deleteMany({ where: { id: { in: oldSignups.map((s) => s.id) } } });
  });

  it("createProfile com rank >= 200 (3ª faixa, mesmo estando na waitlist) nasce PENDING_PAYMENT, sem trial", async () => {
    // 200 registros mais antigos (rank 0-199, faixas 1 e 2 inteiras
    // preenchidas) — nosso candidato vira o 201º (rank 200), 1ª posição
    // fora de qualquer promoção.
    const now = Date.now();
    const oldSignups = await Promise.all(
      Array.from({ length: 200 }).map((_, i) =>
        prisma.waitlistSignup.create({
          data: {
            email: `${uid(`rank_filler2_${i}`)}@test.com`,
            audience: WaitlistAudience.PROFESSIONAL,
            createdAt: new Date(now - (400 - i) * 60 * 1000)
          }
        })
      )
    );
    oldSignups.forEach((s) => waitlistIdsToCleanup.add(s.id));

    const email = `${uid("rank201")}@test.com`;
    const waitlist = await prisma.waitlistSignup.create({
      data: { email, audience: WaitlistAudience.PROFESSIONAL, createdAt: new Date(now) }
    });
    waitlistIdsToCleanup.add(waitlist.id);

    const user = await makeProviderUser("rank201", { email });
    userIdsToCleanup.add(user.id);

    const profile = await createProfileFor(user.id, "rank201");
    providerProfileIdsToCleanup.add(profile.id);

    const sub = await prisma.providerSubscription.findUniqueOrThrow({ where: { providerId: profile.id } });
    expect(sub.isFounder).toBe(false);
    expect(sub.status).toBe(ProviderSubscriptionStatus.PENDING_PAYMENT);
    expect(sub.trialEndsAt).toBeNull();
    expect(sub.priceCents).toBe(3990);

    // Sem benefício nenhum a proteger — não precisa reivindicar a linha.
    const reloadedWaitlist = await prisma.waitlistSignup.findUniqueOrThrow({ where: { id: waitlist.id } });
    expect(reloadedWaitlist.claimedByProviderId).toBeNull();

    await prisma.waitlistSignup.deleteMany({ where: { id: { in: oldSignups.map((s) => s.id) } } });
  });

  it("cancelSubscription em TRIALING cancela na hora; em ACTIVE agenda pro fim do período", async () => {
    const userTrial = await makeProviderUser("cancel_trial");
    userIdsToCleanup.add(userTrial.id);
    const email = `${uid("cancel_founder")}@test.com`;
    const waitlist = await prisma.waitlistSignup.create({
      data: { email, audience: WaitlistAudience.PROFESSIONAL }
    });
    waitlistIdsToCleanup.add(waitlist.id);
    const userWithEmail = await makeProviderUser("cancel_trial2", { email });
    userIdsToCleanup.add(userWithEmail.id);
    const profileTrial = await createProfileFor(userWithEmail.id, "cancel_trial2");
    providerProfileIdsToCleanup.add(profileTrial.id);

    const canceledTrial = await providerSubscriptionService.cancelSubscription(userWithEmail.id);
    expect(canceledTrial.status).toBe(ProviderSubscriptionStatus.CANCELED);

    const userActive = await makeProviderUser("cancel_active");
    userIdsToCleanup.add(userActive.id);
    const profileActive = await createProfileFor(userActive.id, "cancel_active");
    providerProfileIdsToCleanup.add(profileActive.id);
    await prisma.providerSubscription.update({
      where: { providerId: profileActive.id },
      data: { status: ProviderSubscriptionStatus.ACTIVE, nextBillingAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000) }
    });

    const canceledActive = await providerSubscriptionService.cancelSubscription(userActive.id);
    expect(canceledActive.status).toBe(ProviderSubscriptionStatus.ACTIVE);
    expect(canceledActive.cancelAtPeriodEnd).toBe(true);

    const reactivated = await providerSubscriptionService.reactivateSubscription(userActive.id);
    expect(reactivated.cancelAtPeriodEnd).toBe(false);
    expect(reactivated.canceledAt).toBeNull();
  });

  it("runSubscriptionBilling cobra com sucesso (mock aprovado), ativa e trava o preço por 12 meses", async () => {
    vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 5001, status: "approved" } as any);

    const user = await makeProviderUser("bill_ok");
    userIdsToCleanup.add(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { mpCustomerId: "cus_test_sub" } });
    await prisma.customerPaymentMethod.create({
      data: {
        userId: user.id,
        mpCustomerId: "cus_test_sub",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });
    const profile = await createProfileFor(user.id, "bill_ok");
    providerProfileIdsToCleanup.add(profile.id);
    await prisma.providerSubscription.update({
      where: { providerId: profile.id },
      data: { status: ProviderSubscriptionStatus.PENDING_PAYMENT, nextBillingAt: new Date(Date.now() - 60 * 1000) }
    });

    await providerSubscriptionService.runSubscriptionBilling(new Date());

    const sub = await prisma.providerSubscription.findUniqueOrThrow({ where: { providerId: profile.id } });
    expect(sub.status).toBe(ProviderSubscriptionStatus.ACTIVE);
    expect(sub.lastChargeStatus).toBe("SUCCESS");
    expect(sub.priceLockedUntil).not.toBeNull();
    const lockDiffDays = (sub.priceLockedUntil!.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(lockDiffDays).toBeGreaterThan(360);
  });

  // Realinhamento com o Will (2026-08-26): priceLockedUntil era gravado
  // desde o Bloco 5 original mas nunca lido em lugar nenhum — a trava de 12
  // meses do fundador nunca subia o preço de verdade. Este teste cobre a
  // ativação real desse mecanismo.
  it("fundador com priceLockedUntil vencido é cobrado no preço BASE (R$39,90), não mais no promocional", async () => {
    // Raio-X focado (2026-08-26): não depende mais de virar fundador via
    // waitlist/rank — sob a suíte inteira em paralelo, outros arquivos
    // também criam WaitlistSignup PROFESSIONAL, e o rank é sempre contado
    // sobre TODOS os registros do banco de teste, não só os deste arquivo
    // (mesmo aviso já documentado nos testes de rank 100-199/200+ acima).
    // Esse teste testa o MECANISMO de cobrança/reajuste, não a resolução de
    // faixa (já coberta pelos testes de rank dedicados) — seta o estado de
    // fundador direto, sem depender de rank nenhum.
    const user = await makeProviderUser("lock_expired");
    userIdsToCleanup.add(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { mpCustomerId: "cus_test_lockexp" } });
    await prisma.customerPaymentMethod.create({
      data: {
        userId: user.id,
        mpCustomerId: "cus_test_lockexp",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });
    const profile = await createProfileFor(user.id, "lock_expired");
    providerProfileIdsToCleanup.add(profile.id);

    // Simula: é fundador, já pagou o preço promocional por um ciclo
    // (priceLockedUntil setado) e agora a trava de 12 meses já venceu.
    await prisma.providerSubscription.update({
      where: { providerId: profile.id },
      data: {
        isFounder: true,
        priceCents: 2990,
        status: ProviderSubscriptionStatus.ACTIVE,
        nextBillingAt: new Date(Date.now() - 60 * 1000),
        priceLockedUntil: new Date(Date.now() - 24 * 60 * 60 * 1000)
      }
    });

    const chargeSpy = vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 5011, status: "approved" } as any);
    await providerSubscriptionService.runSubscriptionBilling(new Date());

    const chargedAmount = (chargeSpy.mock.calls[0][0] as any).body.transaction_amount;
    expect(chargedAmount).toBe(3990 / 100);

    const subAfter = await prisma.providerSubscription.findUniqueOrThrow({ where: { providerId: profile.id } });
    expect(subAfter.status).toBe(ProviderSubscriptionStatus.ACTIVE);
    expect(subAfter.priceCents).toBe(3990);
  });

  it("early adopter (2ª faixa) sempre cobra no preço base, sem nenhuma trava/reajuste", async () => {
    const now = Date.now();
    const oldSignups = await Promise.all(
      Array.from({ length: 100 }).map((_, i) =>
        prisma.waitlistSignup.create({
          data: {
            email: `${uid(`early_filler_${i}`)}@test.com`,
            audience: WaitlistAudience.PROFESSIONAL,
            createdAt: new Date(now - (200 - i) * 60 * 1000)
          }
        })
      )
    );
    oldSignups.forEach((s) => waitlistIdsToCleanup.add(s.id));

    const email = `${uid("early_bill")}@test.com`;
    const ownSignup = await prisma.waitlistSignup.create({
      data: { email, audience: WaitlistAudience.PROFESSIONAL, createdAt: new Date(now) }
    });
    // Raio-X focado (2026-08-26): faltava aqui — o próprio registro do
    // candidato nunca era limpo (só os fillers), vazando 1 linha
    // PROFESSIONAL a cada execução pro banco de teste. Como o rank é
    // contado sobre TODOS os registros, esse vazamento acumulado ao longo
    // de várias rodadas já bastou pra inflar o rank de OUTROS testes deste
    // mesmo arquivo o suficiente pra fazer alguns falharem. Adicionado no
    // Set de limpeza ANTES de qualquer coisa que possa falhar depois.
    waitlistIdsToCleanup.add(ownSignup.id);

    const user = await makeProviderUser("early_bill", { email });
    userIdsToCleanup.add(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { mpCustomerId: "cus_test_early" } });
    await prisma.customerPaymentMethod.create({
      data: {
        userId: user.id,
        mpCustomerId: "cus_test_early",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });
    const profile = await createProfileFor(user.id, "early_bill");
    providerProfileIdsToCleanup.add(profile.id);
    await prisma.providerSubscription.update({
      where: { providerId: profile.id },
      data: { status: ProviderSubscriptionStatus.PENDING_PAYMENT, nextBillingAt: new Date(Date.now() - 60 * 1000) }
    });

    const chargeSpy = vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 5021, status: "approved" } as any);
    await providerSubscriptionService.runSubscriptionBilling(new Date());

    const chargedAmount = (chargeSpy.mock.calls[0][0] as any).body.transaction_amount;
    expect(chargedAmount).toBe(3990 / 100);

    const sub = await prisma.providerSubscription.findUniqueOrThrow({ where: { providerId: profile.id } });
    expect(sub.priceCents).toBe(3990);

    await prisma.waitlistSignup.deleteMany({ where: { id: { in: [...oldSignups.map((s) => s.id), ownSignup.id] } } });
  });

  it("runSubscriptionBilling sem cartão mantém PENDING_PAYMENT e incrementa falhas", async () => {
    const user = await makeProviderUser("bill_nocard");
    userIdsToCleanup.add(user.id);
    const profile = await createProfileFor(user.id, "bill_nocard");
    providerProfileIdsToCleanup.add(profile.id);
    await prisma.providerSubscription.update({
      where: { providerId: profile.id },
      data: { status: ProviderSubscriptionStatus.PENDING_PAYMENT, nextBillingAt: new Date(Date.now() - 60 * 1000) }
    });

    await providerSubscriptionService.runSubscriptionBilling(new Date());

    const sub = await prisma.providerSubscription.findUniqueOrThrow({ where: { providerId: profile.id } });
    expect(sub.status).toBe(ProviderSubscriptionStatus.PENDING_PAYMENT);
    expect(sub.lastChargeStatus).toBe("FAILED");
    expect(sub.consecutiveFailedCharges).toBe(1);
  });

  it("runSubscriptionBilling numa assinatura ACTIVE que falha vira PAST_DUE", async () => {
    vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 5002, status: "rejected" } as any);

    const user = await makeProviderUser("bill_pastdue");
    userIdsToCleanup.add(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { mpCustomerId: "cus_test_sub2" } });
    await prisma.customerPaymentMethod.create({
      data: {
        userId: user.id,
        mpCustomerId: "cus_test_sub2",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "1111",
        funding: "CREDIT"
      }
    });
    const profile = await createProfileFor(user.id, "bill_pastdue");
    providerProfileIdsToCleanup.add(profile.id);
    await prisma.providerSubscription.update({
      where: { providerId: profile.id },
      data: {
        status: ProviderSubscriptionStatus.ACTIVE,
        nextBillingAt: new Date(Date.now() - 60 * 1000),
        priceLockedUntil: new Date(Date.now() + 300 * 24 * 60 * 60 * 1000)
      }
    });

    await providerSubscriptionService.runSubscriptionBilling(new Date());

    const sub = await prisma.providerSubscription.findUniqueOrThrow({ where: { providerId: profile.id } });
    expect(sub.status).toBe(ProviderSubscriptionStatus.PAST_DUE);
    expect(sub.consecutiveFailedCharges).toBe(1);
  });

  it("runSubscriptionBilling finaliza cancelAtPeriodEnd sem cobrar", async () => {
    const chargeSpy = vi.spyOn(Payment.prototype, "create");

    const user = await makeProviderUser("bill_cancelend");
    userIdsToCleanup.add(user.id);
    const profile = await createProfileFor(user.id, "bill_cancelend");
    providerProfileIdsToCleanup.add(profile.id);
    await prisma.providerSubscription.update({
      where: { providerId: profile.id },
      data: {
        status: ProviderSubscriptionStatus.ACTIVE,
        cancelAtPeriodEnd: true,
        nextBillingAt: new Date(Date.now() - 60 * 1000)
      }
    });

    await providerSubscriptionService.runSubscriptionBilling(new Date());

    const sub = await prisma.providerSubscription.findUniqueOrThrow({ where: { providerId: profile.id } });
    expect(sub.status).toBe(ProviderSubscriptionStatus.CANCELED);
    expect(chargeSpy).not.toHaveBeenCalled();
  });
});
