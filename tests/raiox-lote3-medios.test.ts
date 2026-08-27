import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { CardToken, Payment } from "mercadopago";
import {
  ConsultancyContractStatus,
  ConsultancyPaymentStatus,
  ConsultancyRequestStatus,
  ExternalStudentInviteChannel,
  ExternalStudentInviteStatus,
  OfferBillingCycle,
  ProviderSubscriptionStatus,
  ServiceOfferKind,
  BookingStatus
} from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { ProviderSubscriptionService } from "../src/modules/providers/services/provider-subscription.service";
import { AdminService } from "../src/modules/admin/services/admin.service";
import { UserService } from "../src/modules/users/services/user.service";
import { encryptSensitiveText } from "../src/shared/utils/encryption";

// Raio-X pós-épico — "Lote 3" (médios), 2026-08-25: cluster de "assinatura
// presa" (sem saída de auto-serviço, sem visibilidade admin), vazamento leve
// de status de cobrança pro cliente, notificações faltando em eventos do
// épico, gate de assinatura esquecido no check-in, dedupe de convite por
// telefone, e troca de serviço que não fechava vínculo avulso antigo.

const consultancyService = new ConsultancyService();
const providerSubscriptionService = new ProviderSubscriptionService();
const adminService = new AdminService();
const userService = new UserService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// notificationService.sendToUsers é chamada como fire-and-forget (`void`) em
// vários pontos do código de produção — precisa de uma folga pra concluir
// antes de checar o UserNotification (mesmo padrão base já usado em
// frente10-lote3-rate-limit-role-notify.test.ts, mas com poll em vez de
// sleep fixo — sob a suíte inteira rodando em paralelo, 150ms fixos
// flakaram uma vez por contenção de banco).
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForNotification(userId: string, type: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await prisma.userNotification.findFirst({ where: { userId, data: { path: ["type"], equals: type } } });
    if (found) return found;
    await sleep(100);
  }
  return null;
}

async function makeProvider(label: string, subscriptionStatus: ProviderSubscriptionStatus | null = ProviderSubscriptionStatus.ACTIVE) {
  const user = await prisma.user.create({
    data: {
      name: `RaioX ${label} Provider`,
      email: `${uid(`raiox3_${label}_prov`)}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}`,
      role: "PROVIDER"
    }
  });
  const profile = await prisma.providerProfile.create({
    data: {
      userId: user.id,
      displayName: `RaioX ${label} Provider`,
      bio: "test",
      experienceYears: 3,
      priceCents: 15000,
      mpAccountId: `${Math.floor(Math.random() * 1_000_000_000)}`,
      mpAccessToken: encryptSensitiveText("fake_access_token"),
      crefValidationStatus: "APPROVED"
    }
  });
  if (subscriptionStatus) {
    await prisma.providerSubscription.create({
      data: { providerId: profile.id, status: subscriptionStatus }
    });
  }
  return { userId: user.id, providerId: profile.id };
}

async function makeClient(label: string) {
  const user = await prisma.user.create({
    data: {
      name: `RaioX ${label} Client`,
      email: `${uid(`raiox3_${label}_client`)}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}`,
      role: "CLIENT",
      emailVerifiedAt: new Date()
    }
  });
  return user.id;
}

const userIdsToCleanup = new Set<string>();
const providerProfileIdsToCleanup = new Set<string>();
const offerIdsToCleanup = new Set<string>();
const categoryIdsToCleanup = new Set<string>();
const inviteIdsToCleanup = new Set<string>();

describe("Raio-X pós-épico — Lote 3 (médios)", () => {
  beforeAll(async () => {
    await prisma.$connect();
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
  });

  afterAll(async () => {
    const userIds = Array.from(userIdsToCleanup);
    const providerIds = Array.from(providerProfileIdsToCleanup);
    await prisma.booking.deleteMany({ where: { OR: [{ clientId: { in: userIds } }, { providerId: { in: providerIds } }] } });
    const requestIds = (
      await prisma.consultancyRequest.findMany({
        where: { OR: [{ clientId: { in: userIds } }, { providerId: { in: providerIds } }] },
        select: { id: true }
      })
    ).map((r) => r.id);
    await prisma.trainingPlan.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.consultancyContract.deleteMany({
      where: { OR: [{ clientId: { in: userIds } }, { providerId: { in: providerIds } }] }
    });
    await prisma.consultancyRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: Array.from(offerIdsToCleanup) } } });
    await prisma.externalStudentInvite.deleteMany({ where: { id: { in: Array.from(inviteIdsToCleanup) } } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.providerSubscription.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.serviceCategory.deleteMany({ where: { id: { in: Array.from(categoryIdsToCleanup) } } });
    await prisma.$disconnect();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
  });

  it("[Médio] createConsultancyRequest/listClientRequests/getMyTraining não vazam subscription.status pro cliente", async () => {
    const provider = await makeProvider("leak1");
    providerProfileIdsToCleanup.add(provider.providerId);
    const client = await makeClient("leak1");
    userIdsToCleanup.add(client);
    await prisma.onlineConsultancySetting.create({ data: { providerId: provider.providerId, enabled: true } });
    const requestOffer = await prisma.providerServiceOffer.create({
      data: {
        providerId: provider.providerId,
        kind: ServiceOfferKind.ONLINE_CONSULTANCY,
        title: "Oferta ativa (pré-requisito de createConsultancyRequest)",
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 8000
      }
    });
    offerIdsToCleanup.add(requestOffer.id);

    const request = await consultancyService.createConsultancyRequest(client, { providerId: provider.providerId });
    expect((request.provider as any).subscription).toBeUndefined();
    expect((request.provider as any).isFounder).toBe(false);

    const listed = await consultancyService.listClientRequests(client);
    expect(listed.length).toBeGreaterThan(0);
    for (const r of listed) {
      expect((r.provider as any).subscription).toBeUndefined();
    }

    // getMyTraining: só contratos com ficha ativa entram em `contracts`
    // (o campo que carrega o objeto `provider` completo) — cria a ficha
    // direto via prisma, sem passar pelo fluxo de entrega completo.
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId: provider.providerId,
        kind: ServiceOfferKind.ONLINE_CONSULTANCY,
        title: "Oferta leak test",
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 10000
      }
    });
    offerIdsToCleanup.add(offer.id);
    const now = new Date();
    const req2 = await prisma.consultancyRequest.create({
      data: {
        providerId: provider.providerId,
        clientId: client,
        status: ConsultancyRequestStatus.RESPONDED,
        quotedOfferId: offer.id,
        responseDeadlineAt: now,
        respondedAt: now
      }
    });
    const contract = await prisma.consultancyContract.create({
      data: {
        requestId: req2.id,
        providerId: provider.providerId,
        clientId: client,
        offerId: offer.id,
        status: ConsultancyContractStatus.ACTIVE,
        paymentInstallments: 1,
        paymentStatus: ConsultancyPaymentStatus.CAPTURED,
        paymentAmountCents: 10000,
        providerAmountCents: 9000,
        platformAmountCents: 1000,
        paymentCapturedAt: now,
        deliveryDeadlineAt: now,
        immediateExecutionAcknowledgedAt: now,
        billingCycle: OfferBillingCycle.MONTHLY,
        kind: ServiceOfferKind.ONLINE_CONSULTANCY
      }
    });
    await prisma.trainingPlan.create({
      data: {
        providerId: provider.providerId,
        contractId: contract.id,
        title: "Ficha leak test",
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }
    });

    const myTraining = await consultancyService.getMyTraining(client);
    expect(myTraining.contracts.length).toBeGreaterThan(0);
    for (const c of myTraining.contracts) {
      expect((c.provider as any).subscription).toBeUndefined();
      expect(typeof (c.provider as any).isFounder).toBe("boolean");
    }
  });

  it("[Médio] confirmExternalCheckIn bloqueia profissional com assinatura inativa", async () => {
    const provider = await makeProvider("checkin1", ProviderSubscriptionStatus.PAST_DUE);
    providerProfileIdsToCleanup.add(provider.providerId);
    const client = await makeClient("checkin1");
    userIdsToCleanup.add(client);

    const now = new Date();
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId: provider.providerId,
        kind: ServiceOfferKind.ONLINE_CONSULTANCY,
        title: "Consultoria externa (cadastro manual)",
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 0,
        isActive: false
      }
    });
    offerIdsToCleanup.add(offer.id);
    const request = await prisma.consultancyRequest.create({
      data: {
        providerId: provider.providerId,
        clientId: client,
        status: ConsultancyRequestStatus.RESPONDED,
        quotedOfferId: offer.id,
        responseDeadlineAt: now,
        respondedAt: now
      }
    });
    const contract = await prisma.consultancyContract.create({
      data: {
        requestId: request.id,
        providerId: provider.providerId,
        clientId: client,
        offerId: offer.id,
        origin: "EXTERNAL",
        status: ConsultancyContractStatus.ACTIVE,
        paymentInstallments: 1,
        paymentStatus: ConsultancyPaymentStatus.CAPTURED,
        paymentAmountCents: 0,
        providerAmountCents: 0,
        platformAmountCents: 0,
        paymentCapturedAt: now,
        deliveryDeadlineAt: now,
        immediateExecutionAcknowledgedAt: now,
        billingCycle: OfferBillingCycle.MONTHLY,
        kind: ServiceOfferKind.ONLINE_CONSULTANCY,
        externalCheckInDueAt: now
      }
    });

    await expect(consultancyService.confirmExternalCheckIn(provider.userId, contract.id)).rejects.toThrow(
      /assinatura está inativa/i
    );
  });

  it("[Médio] reenvio de convite com telefone formatado diferente cancela o convite pendente antigo", async () => {
    const provider = await makeProvider("invite1");
    providerProfileIdsToCleanup.add(provider.providerId);

    const rawPhone = "11987654321";
    const first = await consultancyService.createExternalStudentInvite(provider.userId, {
      studentName: "Aluno Teste",
      channel: ExternalStudentInviteChannel.WHATSAPP,
      phone: rawPhone
    });
    inviteIdsToCleanup.add(first.invite.id);

    const second = await consultancyService.createExternalStudentInvite(provider.userId, {
      studentName: "Aluno Teste",
      channel: ExternalStudentInviteChannel.WHATSAPP,
      phone: "(11) 98765-4321"
    });
    inviteIdsToCleanup.add(second.invite.id);

    const firstAfter = await prisma.externalStudentInvite.findUniqueOrThrow({ where: { id: first.invite.id } });
    expect(firstAfter.status).toBe(ExternalStudentInviteStatus.CANCELLED);
    expect(second.invite.status).toBe(ExternalStudentInviteStatus.PENDING);
  });

  it("[Médio] switchOrAddOffer cancela o Booking avulso antigo ao trocar de serviço", async () => {
    const provider = await makeProvider("switch1");
    providerProfileIdsToCleanup.add(provider.providerId);
    const client = await makeClient("switch1");
    userIdsToCleanup.add(client);
    await prisma.user.update({ where: { id: client }, data: { mpCustomerId: "cus_test_raiox3_switch" } });
    await prisma.customerPaymentMethod.create({
      data: {
        userId: client,
        mpCustomerId: "cus_test_raiox3_switch",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT",
        isDefault: true
      }
    });

    const category = await prisma.serviceCategory.create({ data: { name: `RaioX3_${Date.now()}`, description: "t" } });
    categoryIdsToCleanup.add(category.id);
    const oldBooking = await prisma.booking.create({
      data: {
        clientId: client,
        providerId: provider.providerId,
        categoryId: category.id,
        scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        priceCents: 12000,
        status: BookingStatus.CONFIRMED
      }
    });

    const newOffer = await prisma.providerServiceOffer.create({
      data: {
        providerId: provider.providerId,
        kind: ServiceOfferKind.ONLINE_CONSULTANCY,
        title: "Novo plano online",
        billingCycle: OfferBillingCycle.MONTHLY,
        priceCents: 9000
      }
    });
    offerIdsToCleanup.add(newOffer.id);

    vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 555, status: "authorized" } as any);

    await userService.switchOrAddOffer(client, {
      newOfferId: newOffer.id,
      paymentMethod: "CREDIT_CARD" as any,
      acknowledgedImmediateExecution: true
    });

    const bookingAfter = await prisma.booking.findUniqueOrThrow({ where: { id: oldBooking.id } });
    expect(bookingAfter.status).toBe(BookingStatus.CANCELLED);
  });

  it("[Médio] cancelSubscription cancela imediatamente a partir de PENDING_PAYMENT e PAST_DUE", async () => {
    const providerPending = await makeProvider("cancel-pending", ProviderSubscriptionStatus.PENDING_PAYMENT);
    providerProfileIdsToCleanup.add(providerPending.providerId);
    const resultPending = await providerSubscriptionService.cancelSubscription(providerPending.userId);
    expect(resultPending.status).toBe(ProviderSubscriptionStatus.CANCELED);

    const providerPastDue = await makeProvider("cancel-pastdue", ProviderSubscriptionStatus.PAST_DUE);
    providerProfileIdsToCleanup.add(providerPastDue.providerId);
    const resultPastDue = await providerSubscriptionService.cancelSubscription(providerPastDue.userId);
    expect(resultPastDue.status).toBe(ProviderSubscriptionStatus.CANCELED);
  });

  it("[Médio] job de cobrança reseta cancelAtPeriodEnd ao finalizar cancelamento agendado (sem mensagem contraditória)", async () => {
    const provider = await makeProvider("resetflag1", ProviderSubscriptionStatus.ACTIVE);
    providerProfileIdsToCleanup.add(provider.providerId);

    await providerSubscriptionService.cancelSubscription(provider.userId);
    await prisma.providerSubscription.update({
      where: { providerId: provider.providerId },
      data: { nextBillingAt: new Date(Date.now() - 60 * 1000) }
    });
    await providerSubscriptionService.runSubscriptionBilling(new Date());

    const after = await prisma.providerSubscription.findUniqueOrThrow({ where: { providerId: provider.providerId } });
    expect(after.status).toBe(ProviderSubscriptionStatus.CANCELED);
    expect(after.cancelAtPeriodEnd).toBe(false);
  });

  it("[Médio] deliverExternalPlan notifica o aluno externo sobre a ficha entregue", async () => {
    const provider = await makeProvider("notify1");
    providerProfileIdsToCleanup.add(provider.providerId);
    const client = await makeClient("notify1");
    userIdsToCleanup.add(client);

    const contract = await consultancyService.createExternalStudentContract(provider.userId, { clientId: client });
    await consultancyService.deliverExternalPlan(provider.userId, contract.id, {
      title: "Ficha 1",
      exercises: []
    });

    const notification = await waitForNotification(client, "CONSULTANCY_TRAINING_DELIVERED");
    expect(notification).not.toBeNull();
  });

  it("[Médio] auto-cancelamento por check-in vencido notifica também o aluno, não só o profissional", async () => {
    const provider = await makeProvider("notify2");
    providerProfileIdsToCleanup.add(provider.providerId);
    const client = await makeClient("notify2");
    userIdsToCleanup.add(client);

    const contract = await consultancyService.createExternalStudentContract(provider.userId, { clientId: client });
    await prisma.consultancyContract.update({
      where: { id: contract.id },
      data: { externalCheckInDueAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) }
    });

    await consultancyService.sendExternalCheckInReminders(new Date());

    const contractAfter = await prisma.consultancyContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(contractAfter.status).toBe("CANCELLED");

    const clientNotification = await waitForNotification(client, "EXTERNAL_STUDENT_CHECK_IN_AUTO_CANCELLED");
    expect(clientNotification).not.toBeNull();
  });

  it("[Médio] suspensão de conta pelo admin cancela a assinatura do profissional suspenso", async () => {
    // PAST_DUE cancela imediatamente (sem período pago em aberto pra
    // honrar, mesmo racional do achado "cancelSubscription" acima) —
    // asserção direta em status === CANCELED. Pra ACTIVE, o mesmo
    // cancelSubscription() só agenda cancelAtPeriodEnd (comportamento já
    // coberto no teste de cancelamento acima); o que importa aqui é que
    // ALGUMA forma de parar a cobrança seja acionada na suspensão.
    const provider = await makeProvider("suspend1", ProviderSubscriptionStatus.PAST_DUE);
    providerProfileIdsToCleanup.add(provider.providerId);

    const adminEmail = env.ADMIN_ALLOWED_EMAILS[0];
    let admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!admin) {
      admin = await prisma.user.create({
        data: {
          name: "RaioX Admin",
          email: adminEmail,
          password: "x",
          phone: `11${Date.now().toString().slice(-9)}9`,
          role: "ADMIN",
          emailVerifiedAt: new Date()
        }
      });
    } else if (!admin.emailVerifiedAt) {
      admin = await prisma.user.update({ where: { id: admin.id }, data: { emailVerifiedAt: new Date() } });
    }

    await adminService.suspendUser(admin.id, provider.userId, "Teste Raio-X Lote 3");

    const subAfter = await prisma.providerSubscription.findUniqueOrThrow({ where: { providerId: provider.providerId } });
    expect(subAfter.status).toBe(ProviderSubscriptionStatus.CANCELED);
  });

  it("[Médio] getUserDetail do admin expõe o status de assinatura do profissional", async () => {
    const provider = await makeProvider("admindetail1", ProviderSubscriptionStatus.PAST_DUE);
    providerProfileIdsToCleanup.add(provider.providerId);

    const adminEmail = env.ADMIN_ALLOWED_EMAILS[0];
    let admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!admin) {
      admin = await prisma.user.create({
        data: {
          name: "RaioX Admin",
          email: adminEmail,
          password: "x",
          phone: `11${Date.now().toString().slice(-9)}8`,
          role: "ADMIN",
          emailVerifiedAt: new Date()
        }
      });
    } else if (!admin.emailVerifiedAt) {
      admin = await prisma.user.update({ where: { id: admin.id }, data: { emailVerifiedAt: new Date() } });
    }

    const detail = await adminService.getUserDetail(admin.id, provider.userId);
    expect(detail.provider?.subscription?.status).toBe(ProviderSubscriptionStatus.PAST_DUE);
  });
});
