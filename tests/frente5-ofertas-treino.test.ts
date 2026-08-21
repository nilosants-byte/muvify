import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Payment, CardToken } from "mercadopago";
import { ConsultancyService } from "../src/modules/consultancy/services/consultancy.service";
import { BookingService } from "../src/modules/bookings/services/booking.service";
import { ProviderService } from "../src/modules/providers/services/provider.service";
import { prisma } from "../src/config/prisma";
import { encryptSensitiveText } from "../src/shared/utils/encryption";
import { env } from "../src/config/env";
import { ExerciseService } from "../src/modules/exercises/services/exercise.service";
import { CategoryService } from "../src/modules/categories/services/category.service";

// Frente 5 (segunda camada) — ofertas e treino.

const consultancyService = new ConsultancyService();
const bookingService = new BookingService();
const providerService = new ProviderService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const offerIds: string[] = [];
const bookingIds: string[] = [];

describe("Frente 5 (segunda camada) — ofertas e treino (backend)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `F5_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Frente5 Cliente",
        email: `${uid("f5_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}9`,
        role: "CLIENT",
        emailVerifiedAt: new Date()
      }
    });
    clientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });

    const providerUser = await prisma.user.create({
      data: {
        name: "Frente5 Profissional",
        email: `${uid("f5_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Frente5 Profissional",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        crefValidationStatus: "APPROVED",
        serviceMode: "BOTH",
        minBookingNoticeHours: 1,
        fixedLocations: [{ name: "Estúdio Central" }]
      }
    });
    providerId = provider.id;

    await prisma.availability.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        providerId,
        weekday,
        startTime: "00:00",
        endTime: "23:59",
        isActive: true
      }))
    });
    await prisma.providerCategory.create({ data: { providerId, categoryId } });
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { booking: { id: { in: bookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.availability.deleteMany({ where: { providerId } });
    await prisma.providerCategory.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [clientId, providerUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("Lote 1: criar oferta Combo com promoção é rejeitado (desconto não é ratejável entre as duas metades)", async () => {
    await expect(
      consultancyService.createProviderOffer(providerUserId, {
        kind: "COMBO" as any,
        billingCycle: "MONTHLY" as any,
        priceCents: 30000,
        comboPresentialDaysPerWeek: 2,
        comboOnlineDaysPerWeek: 2,
        comboPresentialShareCents: 20000,
        comboConsultancyShareCents: 10000,
        presentialPackageMode: "FLEXIBLE_CREDITS" as any,
        presentialSessionsPerCycle: 8,
        presentialHasFixedTerm: true,
        presentialTotalCycles: 3,
        isPromotion: true,
        promotionPriceCents: 25000,
        promotionEndsAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString()
      } as any)
    ).rejects.toThrow(/promoção não está disponível para ofertas do tipo combo/i);
  });

  it("Lote 1: criar oferta Combo sem promoção continua funcionando normalmente", async () => {
    const offer = await consultancyService.createProviderOffer(providerUserId, {
      kind: "COMBO" as any,
      billingCycle: "MONTHLY" as any,
      priceCents: 30000,
      comboPresentialDaysPerWeek: 2,
      comboOnlineDaysPerWeek: 2,
      comboPresentialShareCents: 20000,
      comboConsultancyShareCents: 10000,
      presentialPackageMode: "FLEXIBLE_CREDITS" as any,
      presentialSessionsPerCycle: 8,
      presentialHasFixedTerm: true,
      presentialTotalCycles: 3
    } as any);
    offerIds.push(offer.id);
    expect(offer.kind).toBe("COMBO");
  });

  it("Lote 2: agendar oferta PRESENTIAL_ONLY informando endereço a domicílio é rejeitado", async () => {
    const offer = await consultancyService.createProviderOffer(providerUserId, {
      kind: "PRESENTIAL" as any,
      title: "Sessão só no estúdio",
      billingCycle: "DAILY" as any,
      priceCents: 15000,
      offerServiceMode: "PRESENTIAL_ONLY" as any
    } as any);
    offerIds.push(offer.id);

    const scheduled = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000);
    scheduled.setHours(9, 0, 0, 0);

    await expect(
      bookingService.create(
        clientId,
        providerId,
        categoryId,
        scheduled.toISOString(),
        offer.id,
        "CREDIT_CARD" as any,
        undefined,
        "Rua da casa do cliente, 123"
      )
    ).rejects.toThrow(/só é atendida no local de atendimento/i);
  });

  it("Lote 2: agendar oferta PRESENTIAL_ONLY no local fixo do profissional funciona normalmente", async () => {
    const offer = await consultancyService.createProviderOffer(providerUserId, {
      kind: "PRESENTIAL" as any,
      title: "Sessão só no estúdio 2",
      billingCycle: "DAILY" as any,
      priceCents: 15000,
      offerServiceMode: "PRESENTIAL_ONLY" as any
    } as any);
    offerIds.push(offer.id);

    const scheduled = new Date(Date.now() + 26 * 24 * 60 * 60 * 1000);
    scheduled.setHours(9, 0, 0, 0);

    const booking = await bookingService.create(
      clientId,
      providerId,
      categoryId,
      scheduled.toISOString(),
      offer.id,
      "CREDIT_CARD" as any,
      undefined,
      "Estúdio Central"
    );
    bookingIds.push(booking.id);
    expect(booking.id).toBeTruthy();
  });

  it("Lote 2: agendar oferta HOME_VISIT_ONLY sem informar endereço é rejeitado", async () => {
    const offer = await consultancyService.createProviderOffer(providerUserId, {
      kind: "PRESENTIAL" as any,
      title: "Sessão só a domicílio",
      billingCycle: "DAILY" as any,
      priceCents: 15000,
      offerServiceMode: "HOME_VISIT_ONLY" as any
    } as any);
    offerIds.push(offer.id);

    const scheduled = new Date(Date.now() + 27 * 24 * 60 * 60 * 1000);
    scheduled.setHours(9, 0, 0, 0);

    await expect(
      bookingService.create(
        clientId,
        providerId,
        categoryId,
        scheduled.toISOString(),
        offer.id,
        "CREDIT_CARD" as any
      )
    ).rejects.toThrow(/só é atendida a domicílio/i);
  });

  it("Lote 5: mensagem de cooldown de preço vem em português, formato de data legível (não ISO técnico)", async () => {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "ONLINE_CONSULTANCY" as any,
        title: `Oferta ${uid("offer")}`,
        billingCycle: "MONTHLY" as any,
        priceCents: 10000,
        basePriceUpdatedAt: new Date() // cooldown recém-iniciado, ainda ativo
      }
    });
    offerIds.push(offer.id);

    await expect(
      consultancyService.updateProviderOffer(providerUserId, offer.id, { priceCents: 20000 } as any)
    ).rejects.toThrow(/Próxima alteração em \d{2}\/\d{2}\/\d{4}\./);
  });
});

describe("Frente 5 (segunda camada), Lote 3 — mudar duração da sessão revalida agendamentos futuros", () => {
  let l3ClientId = "";
  let l3ProviderUserId = "";
  let l3ProviderId = "";
  let l3CategoryId = "";
  const l3BookingIds: string[] = [];

  beforeAll(async () => {
    const category = await prisma.serviceCategory.create({
      data: { name: `F5L3dur_${Date.now()}`, description: "test" }
    });
    l3CategoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Frente5 Lote3 Cliente",
        email: `${uid("f5l3_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "CLIENT",
        emailVerifiedAt: new Date()
      }
    });
    l3ClientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId: l3ClientId, status: "COMPLETED", completedAt: new Date() } });

    const providerUser = await prisma.user.create({
      data: {
        name: "Frente5 Lote3 Profissional",
        email: `${uid("f5l3_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}3`,
        role: "PROVIDER"
      }
    });
    l3ProviderUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: l3ProviderUserId,
        displayName: "Frente5 Lote3 Profissional",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222334",
        crefValidationStatus: "APPROVED",
        minBookingNoticeHours: 1,
        sessionDurationMinutes: 15
      }
    });
    l3ProviderId = provider.id;

    await prisma.availability.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        providerId: l3ProviderId,
        weekday,
        startTime: "00:00",
        endTime: "23:59",
        isActive: true
      }))
    });
    await prisma.providerCategory.create({ data: { providerId: l3ProviderId, categoryId: l3CategoryId } });
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { booking: { id: { in: l3BookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: l3BookingIds } } });
    await prisma.availability.deleteMany({ where: { providerId: l3ProviderId } });
    await prisma.providerCategory.deleteMany({ where: { providerId: l3ProviderId } });
    await prisma.providerProfile.deleteMany({ where: { id: l3ProviderId } });
    await prisma.session.deleteMany({ where: { userId: { in: [l3ClientId, l3ProviderUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [l3ClientId, l3ProviderUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: l3CategoryId } });
  });

  it("aumentar a duração da sessão é rejeitado quando geraria sobreposição entre agendamentos futuros já marcados", async () => {
    const day = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    day.setHours(10, 0, 0, 0);
    const first = await bookingService.create(l3ClientId, l3ProviderId, l3CategoryId, day.toISOString(), undefined, "CREDIT_CARD" as any);
    l3BookingIds.push(first.id);

    const second = new Date(day.getTime() + 20 * 60 * 1000); // 20min depois — válido sob 15min, conflitaria sob 60min
    const secondBooking = await bookingService.create(l3ClientId, l3ProviderId, l3CategoryId, second.toISOString(), undefined, "CREDIT_CARD" as any);
    l3BookingIds.push(secondBooking.id);

    await expect(
      providerService.updateProfile(l3ProviderUserId, { sessionDurationMinutes: 60 } as any)
    ).rejects.toThrow(/passariam a se sobrepor/i);

    // Reduzir a duração (nunca cria sobreposição nova) continua permitido.
    const updated = await providerService.updateProfile(l3ProviderUserId, { sessionDurationMinutes: 10 } as any);
    expect(updated.sessionDurationMinutes).toBe(10);
  });
});

describe("Frente 5 (segunda camada), Lote 7 — integridade de oferta com histórico de venda", () => {
  let l7ClientId = "";
  let l7ProviderUserId = "";
  let l7ProviderId = "";
  let l7CategoryId = "";
  const l7OfferIds: string[] = [];
  const l7BookingIds: string[] = [];
  const l7RequestIds: string[] = [];

  beforeAll(async () => {
    const category = await prisma.serviceCategory.create({
      data: { name: `F5L7_${Date.now()}`, description: "test" }
    });
    l7CategoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Frente5 Lote7 Cliente",
        email: `${uid("f5l7_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}4`,
        role: "CLIENT",
        mpCustomerId: "cus_test_f5l7",
        emailVerifiedAt: new Date()
      }
    });
    l7ClientId = client.id;
    await prisma.customerPaymentMethod.create({
      data: {
        userId: l7ClientId,
        mpCustomerId: "cus_test_f5l7",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });
    await prisma.clientAnamnesis.create({ data: { clientId: l7ClientId, status: "COMPLETED", completedAt: new Date() } });

    const providerUser = await prisma.user.create({
      data: {
        name: "Frente5 Lote7 Profissional",
        email: `${uid("f5l7_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}5`,
        role: "PROVIDER"
      }
    });
    l7ProviderUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: l7ProviderUserId,
        displayName: "Frente5 Lote7 Profissional",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222335",
        mpAccessToken: encryptSensitiveText("fake_access_token"),
        crefValidationStatus: "APPROVED",
        minBookingNoticeHours: 1
      }
    });
    l7ProviderId = provider.id;

    await prisma.availability.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        providerId: l7ProviderId,
        weekday,
        startTime: "00:00",
        endTime: "23:59",
        isActive: true
      }))
    });
    await prisma.providerCategory.create({ data: { providerId: l7ProviderId, categoryId: l7CategoryId } });
  });

  afterAll(async () => {
    await prisma.disputeCase.deleteMany({ where: { clientId: l7ClientId } });
    await prisma.trainingPlan.deleteMany({ where: { providerId: l7ProviderId } });
    await prisma.consultancyContract.deleteMany({ where: { clientId: l7ClientId } });
    await prisma.consultancyRequest.deleteMany({ where: { id: { in: l7RequestIds } } });
    await prisma.payment.deleteMany({ where: { booking: { id: { in: l7BookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: l7BookingIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: l7OfferIds } } });
    await prisma.availability.deleteMany({ where: { providerId: l7ProviderId } });
    await prisma.providerCategory.deleteMany({ where: { providerId: l7ProviderId } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: l7ClientId } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId: l7ClientId } });
    await prisma.providerProfile.deleteMany({ where: { id: l7ProviderId } });
    await prisma.session.deleteMany({ where: { userId: { in: [l7ClientId, l7ProviderUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [l7ClientId, l7ProviderUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: l7CategoryId } });
  });

  it("excluir oferta com agendamento avulso vinculado (sem pacote/contrato) é rejeitado", async () => {
    const offer = await consultancyService.createProviderOffer(l7ProviderUserId, {
      kind: "PRESENTIAL" as any,
      title: "Sessão avulsa Lote 7",
      billingCycle: "DAILY" as any,
      priceCents: 12000
    } as any);
    l7OfferIds.push(offer.id);

    const scheduled = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000);
    scheduled.setHours(9, 0, 0, 0);
    const booking = await bookingService.create(
      l7ClientId, l7ProviderId, l7CategoryId, scheduled.toISOString(), offer.id, "CREDIT_CARD" as any
    );
    l7BookingIds.push(booking.id);

    await expect(
      consultancyService.deleteProviderOffer(l7ProviderUserId, offer.id)
    ).rejects.toThrow(/já tem agendamentos registrados/i);
  });

  it("trocar o tipo (kind) de uma oferta já vendida é rejeitado", async () => {
    const offer = await consultancyService.createProviderOffer(l7ProviderUserId, {
      kind: "PRESENTIAL" as any,
      title: "Sessão avulsa Lote 7 (kind)",
      billingCycle: "DAILY" as any,
      priceCents: 12000
    } as any);
    l7OfferIds.push(offer.id);

    const scheduled = new Date(Date.now() + 29 * 24 * 60 * 60 * 1000);
    scheduled.setHours(9, 0, 0, 0);
    const booking = await bookingService.create(
      l7ClientId, l7ProviderId, l7CategoryId, scheduled.toISOString(), offer.id, "CREDIT_CARD" as any
    );
    l7BookingIds.push(booking.id);

    await expect(
      consultancyService.updateProviderOffer(l7ProviderUserId, offer.id, { kind: "ONLINE_CONSULTANCY" } as any)
    ).rejects.toThrow(/já tem vendas registradas/i);

    // Sem venda histórica, trocar o tipo continua funcionando normalmente.
    const freshOffer = await consultancyService.createProviderOffer(l7ProviderUserId, {
      kind: "PRESENTIAL" as any,
      title: "Sessão sem venda",
      billingCycle: "DAILY" as any,
      priceCents: 9000
    } as any);
    l7OfferIds.push(freshOffer.id);
    const changed = await consultancyService.updateProviderOffer(l7ProviderUserId, freshOffer.id, {
      kind: "ONLINE_CONSULTANCY",
      billingCycle: "MONTHLY"
    } as any);
    expect(changed.kind).toBe("ONLINE_CONSULTANCY");
  });

  it("aceitar uma solicitação cotada cobra o preço promocional mais recente da oferta, não o preço no momento da cotação", async () => {
    vi.spyOn(CardToken.prototype, "create").mockResolvedValue({ id: "tok_test" } as any);
    vi.spyOn(Payment.prototype, "create").mockResolvedValue({ id: 12345, status: "authorized" } as any);

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId: l7ProviderId,
        kind: "ONLINE_CONSULTANCY" as any,
        title: `Consultoria Lote 7 ${uid("offer")}`,
        billingCycle: "MONTHLY" as any,
        priceCents: 20000
      }
    });
    l7OfferIds.push(offer.id);

    const consultancyRequest = await prisma.consultancyRequest.create({
      data: {
        providerId: l7ProviderId,
        clientId: l7ClientId,
        status: "RESPONDED",
        quotedOfferId: offer.id,
        responseDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        respondedAt: new Date()
      }
    });
    l7RequestIds.push(consultancyRequest.id);

    // Profissional ativa uma promoção na oferta DEPOIS de já ter cotado —
    // preço promocional não tem cooldown de 30 dias (diferente do preço
    // base), então essa janela é real.
    await prisma.providerServiceOffer.update({
      where: { id: offer.id },
      data: {
        isPromotion: true,
        promotionPriceCents: 8000,
        promotionEndsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
      }
    });

    const { contract } = await consultancyService.decideRequest(l7ClientId, consultancyRequest.id, {
      decision: "ACCEPT",
      paymentMethod: "CREDIT_CARD" as any,
      acknowledgedImmediateExecution: true
    });

    expect(contract!.paymentAmountCents).toBe(8000);
  });
});

describe("Frente 5 (segunda camada), Lote 8 — proteção do exercício pré-montado em uso", () => {
  const exerciseService = new ExerciseService();

  let l8ClientId = "";
  let l8ProviderUserId = "";
  let l8ProviderId = "";
  let l8CategoryId = "";
  let l8AdminId = "";
  const l8OfferIds: string[] = [];
  const l8ExerciseIds: string[] = [];

  beforeAll(async () => {
    const category = await prisma.serviceCategory.create({
      data: { name: `F5L8_${Date.now()}`, description: "test" }
    });
    l8CategoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Frente5 Lote8 Cliente",
        email: `${uid("f5l8_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}6`,
        role: "CLIENT",
        mpCustomerId: "cus_test_f5l8",
        emailVerifiedAt: new Date()
      }
    });
    l8ClientId = client.id;
    await prisma.customerPaymentMethod.create({
      data: {
        userId: l8ClientId,
        mpCustomerId: "cus_test_f5l8",
        mpCardId: `card_${uid("c")}`,
        nickname: "Cartão de teste",
        brand: "visa",
        last4: "4242",
        funding: "CREDIT"
      }
    });

    const providerUser = await prisma.user.create({
      data: {
        name: "Frente5 Lote8 Profissional",
        email: `${uid("f5l8_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}7`,
        role: "PROVIDER"
      }
    });
    l8ProviderUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: l8ProviderUserId,
        displayName: "Frente5 Lote8 Profissional",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222336",
        mpAccessToken: encryptSensitiveText("fake_access_token"),
        crefValidationStatus: "APPROVED"
      }
    });
    l8ProviderId = provider.id;

    // E-mail admin compartilhado com outros arquivos rodando em paralelo —
    // reaproveita se outro arquivo já registrou primeiro (mesmo padrão já
    // usado em frente3-lote4-categorias.test.ts).
    const adminReg = await prisma.user
      .create({
        data: {
          name: "Frente5 Lote8 Admin",
          email: env.ADMIN_ALLOWED_EMAILS[0],
          password: "x",
          phone: `11${Date.now().toString().slice(-9)}8`,
          role: "CLIENT",
          emailVerifiedAt: new Date()
        }
      })
      .catch(() => prisma.user.findUniqueOrThrow({ where: { email: env.ADMIN_ALLOWED_EMAILS[0] } }));
    l8AdminId = adminReg.id;
  });

  afterAll(async () => {
    await prisma.trainingPlan.deleteMany({ where: { providerId: l8ProviderId } });
    await prisma.consultancyContract.deleteMany({ where: { clientId: l8ClientId } });
    await prisma.consultancyRequest.deleteMany({ where: { clientId: l8ClientId } });
    await prisma.exercise.deleteMany({ where: { id: { in: l8ExerciseIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: { in: l8OfferIds } } });
    await prisma.customerPaymentMethod.deleteMany({ where: { userId: l8ClientId } });
    await prisma.providerProfile.deleteMany({ where: { id: l8ProviderId } });
    await prisma.session.deleteMany({ where: { userId: { in: [l8ClientId, l8ProviderUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [l8ClientId, l8ProviderUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: l8CategoryId } });
  });

  async function makeActiveTrainingPlan(exerciseId: string) {
    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId: l8ProviderId,
        kind: "ONLINE_CONSULTANCY" as any,
        title: `Consultoria Lote 8 ${uid("offer")}`,
        billingCycle: "MONTHLY" as any,
        priceCents: 20000,
        fichaValidityDays: 30
      }
    });
    l8OfferIds.push(offer.id);

    const req = await prisma.consultancyRequest.create({
      data: {
        providerId: l8ProviderId,
        clientId: l8ClientId,
        status: "ACCEPTED",
        quotedOfferId: offer.id,
        responseDeadlineAt: new Date(),
        respondedAt: new Date(),
        clientDecisionAt: new Date()
      }
    });
    const contract = await prisma.consultancyContract.create({
      data: {
        requestId: req.id,
        providerId: l8ProviderId,
        clientId: l8ClientId,
        offerId: offer.id,
        status: "ACTIVE",
        paymentMethod: "CREDIT_CARD",
        paymentStatus: "CAPTURED",
        paymentAmountCents: 20000,
        providerAmountCents: 18000,
        platformAmountCents: 2000,
        billingCycle: offer.billingCycle,
        kind: offer.kind,
        fichaValidityDays: offer.fichaValidityDays,
        deliveryDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        immediateExecutionAcknowledgedAt: new Date()
      }
    });

    await consultancyService.deliverContract(l8ProviderUserId, contract.id, {
      title: "Ficha Lote 8",
      exercises: [{ exerciseId, name: "Nome placeholder", repetitionsSets: "3x10", load: "40kg" }]
    });
  }

  it("excluir exercício pré-montado (admin) em uso numa ficha ativa é bloqueado", async () => {
    const prebuilt = await exerciseService.createPrebuilt(l8AdminId, {
      name: `Agachamento Livre ${uid("ex")}`,
      category: "Pernas"
    });
    l8ExerciseIds.push(prebuilt.id);

    await makeActiveTrainingPlan(prebuilt.id);

    await expect(exerciseService.deletePrebuilt(l8AdminId, prebuilt.id)).rejects.toThrow(/ficha\(s\) ativa\(s\)/i);

    const stillExists = await prisma.exercise.findUnique({ where: { id: prebuilt.id } });
    expect(stillExists).not.toBeNull();
  });
});

describe("Frente 5 (segunda camada), Lote 11 — categoria duplicada ignora inativas", () => {
  const categoryService = new CategoryService();
  let l11AdminId = "";
  const l11CategoryIds: string[] = [];

  beforeAll(async () => {
    // E-mail admin compartilhado com outros arquivos rodando em paralelo —
    // mesmo padrão já usado no Lote 8 acima e em frente3-lote4-categorias.test.ts.
    const adminReg = await prisma.user
      .create({
        data: {
          name: "Frente5 Lote11 Admin",
          email: env.ADMIN_ALLOWED_EMAILS[0],
          password: "x",
          phone: `11${Date.now().toString().slice(-9)}9`,
          role: "CLIENT",
          emailVerifiedAt: new Date()
        }
      })
      .catch(() => prisma.user.findUniqueOrThrow({ where: { email: env.ADMIN_ALLOWED_EMAILS[0] } }));
    l11AdminId = adminReg.id;
  });

  afterAll(async () => {
    await prisma.serviceCategory.deleteMany({ where: { id: { in: l11CategoryIds } } });
  });

  it("recriar categoria com acento diferente de uma já desativada é rejeitado (antes só considerava ativas)", async () => {
    const name = `Dedup Inativa ${uid("x")}`;
    const created = await categoryService.create(l11AdminId, name);
    l11CategoryIds.push(created.id);
    await categoryService.deactivate(l11AdminId, created.id);

    await expect(
      categoryService.create(l11AdminId, name.replace("Dedup Inativa", "Dédup Inativa"))
    ).rejects.toThrow(/já existe/i);
  });
});
