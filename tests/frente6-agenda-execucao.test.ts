import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { Payment } from "mercadopago";
import { BookingStatus, PaymentStatus } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { BookingService } from "../src/modules/bookings/services/booking.service";
import { DisputeCaseService } from "../src/modules/admin/services/dispute-case.service";
import { env } from "../src/config/env";
import { toWeekdayInTimezone, toDateKeyInTimezone } from "../src/shared/utils/timezone";
import { redis } from "../src/config/redis";
import { ManualBlockService } from "../src/modules/providers/manual-blocks/services/manual-block.service";

// Frente 6 (segunda camada) — agenda e execução.

const bookingService = new BookingService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const bookingIds: string[] = [];

describe("Frente 6 (segunda camada) — agenda e execução (backend)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `F6_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Frente6 Cliente",
        email: `${uid("f6_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT",
        emailVerifiedAt: new Date()
      }
    });
    clientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });

    const providerUser = await prisma.user.create({
      data: {
        name: "Frente6 Profissional",
        email: `${uid("f6_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Frente6 Profissional",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222337",
        crefValidationStatus: "APPROVED",
        minBookingNoticeHours: 1
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
    await prisma.disputeCase.deleteMany({ where: { clientId } });
    await prisma.payment.deleteMany({ where: { booking: { id: { in: bookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.availability.deleteMany({ where: { providerId } });
    await prisma.providerCategory.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [clientId, providerUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  let dayOffset = 20;
  async function createConfirmedBooking() {
    const scheduled = new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000);
    dayOffset += 1;
    scheduled.setHours(10, 0, 0, 0);
    const booking = await bookingService.create(
      clientId, providerId, categoryId, scheduled.toISOString(), undefined, "CREDIT_CARD" as any
    );
    bookingIds.push(booking.id);
    await prisma.booking.update({ where: { id: booking.id }, data: { status: BookingStatus.CONFIRMED } });
    return booking;
  }

  it("Lote 1: reabrir a tela de código depois de validado não apaga a validação nem troca o código", async () => {
    const booking = await createConfirmedBooking();
    const validatedAt = new Date();
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        attendanceCode: "123456",
        attendanceCodeGeneratedAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
        attendanceCodeExpiresAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // já vencido
        attendanceCodeValidatedAt: validatedAt
      }
    });

    const result = await bookingService.getAttendanceCode(clientId, booking.id);
    expect(result.validated).toBe(true);

    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.attendanceCode).toBe("123456");
    expect(stored.attendanceCodeValidatedAt?.getTime()).toBe(validatedAt.getTime());
  });

  it("Lote 1: regenerar um código vencido (ainda não validado) usa a data da regeneração, não a data original da sessão", async () => {
    const booking = await createConfirmedBooking();
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        attendanceCode: "654321",
        attendanceCodeGeneratedAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
        attendanceCodeExpiresAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // já vencido
        attendanceCodeValidatedAt: null
      }
    });

    const result = await bookingService.getAttendanceCode(clientId, booking.id);
    expect(result.validated).toBe(false);

    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.attendanceCode).not.toBe("654321");
    expect(stored.attendanceCodeExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("Lote 1: reverificar um código já validado não falha com 'expirado'", async () => {
    const booking = await createConfirmedBooking();
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        attendanceCode: "111222",
        attendanceCodeGeneratedAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
        attendanceCodeExpiresAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // já vencido
        attendanceCodeValidatedAt: new Date()
      }
    });

    const result = await bookingService.verifyAttendanceCode(providerUserId, booking.id, "111222");
    expect(result.validated).toBe(true);
  });
});

describe("Frente 6 (segunda camada), Lote 2 — resolução de disputa de no-show/deadlock", () => {
  const disputeCaseService = new DisputeCaseService();
  let l2ClientId = "";
  let l2ProviderUserId = "";
  let l2ProviderId = "";
  let l2CategoryId = "";
  let l2AdminId = "";
  const l2BookingIds: string[] = [];

  beforeAll(async () => {
    const category = await prisma.serviceCategory.create({
      data: { name: `F6L2_${Date.now()}`, description: "test" }
    });
    l2CategoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Frente6 Lote2 Cliente",
        email: `${uid("f6l2_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}3`,
        role: "CLIENT",
        emailVerifiedAt: new Date()
      }
    });
    l2ClientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Frente6 Lote2 Profissional",
        email: `${uid("f6l2_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}4`,
        role: "PROVIDER"
      }
    });
    l2ProviderUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: l2ProviderUserId,
        displayName: "Frente6 Lote2 Profissional",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222338",
        crefValidationStatus: "APPROVED"
      }
    });
    l2ProviderId = provider.id;

    // E-mail admin compartilhado com outros arquivos rodando em paralelo —
    // reaproveita se outro arquivo já registrou primeiro (mesmo padrão já
    // usado em tests/dispute-cases.test.ts).
    const adminReg = await prisma.user
      .create({
        data: {
          name: "Frente6 Lote2 Admin",
          email: env.ADMIN_ALLOWED_EMAILS[0],
          password: "x",
          phone: `11${Date.now().toString().slice(-9)}5`,
          role: "CLIENT",
          emailVerifiedAt: new Date()
        }
      })
      .catch(() => prisma.user.findUniqueOrThrow({ where: { email: env.ADMIN_ALLOWED_EMAILS[0] } }));
    l2AdminId = adminReg.id;
  });

  afterAll(async () => {
    await prisma.debtRecord.deleteMany({ where: { providerId: l2ProviderId } });
    await prisma.disputeCase.deleteMany({ where: { clientId: l2ClientId } });
    await prisma.payment.deleteMany({ where: { booking: { id: { in: l2BookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: l2BookingIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: l2ProviderId } });
    await prisma.session.deleteMany({ where: { userId: { in: [l2ClientId, l2ProviderUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [l2ClientId, l2ProviderUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: l2CategoryId } });
  });

  async function makeUncapturedDisputeCase(type: "NO_SHOW_CONTESTED" | "CONFIRMATION_DEADLOCK") {
    const booking = await prisma.booking.create({
      data: {
        clientId: l2ClientId,
        providerId: l2ProviderId,
        categoryId: l2CategoryId,
        scheduledAt: new Date(Date.now() - 50 * 60 * 60 * 1000),
        priceCents: 10000,
        status: BookingStatus.CANCELLED
      }
    });
    l2BookingIds.push(booking.id);

    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        amountCents: 10000,
        providerAmountCents: 8500,
        platformFeeCents: 1500,
        status: PaymentStatus.AUTHORIZED,
        mpPaymentId: `mp_${uid("pay")}`
      }
    });

    const disputeCase = await prisma.disputeCase.create({
      data: {
        type,
        clientId: l2ClientId,
        providerId: l2ProviderId,
        amountCents: 10000,
        mpPaymentId: payment.mpPaymentId,
        bookingId: booking.id
      }
    });

    return { booking, payment, disputeCase };
  }

  it("resolver a favor do cliente (REFUNDED) libera a pré-autorização em vez de tentar estornar uma cobrança que nunca existiu", async () => {
    const cancelSpy = vi.spyOn(Payment.prototype, "cancel").mockResolvedValue({} as any);
    const { payment, disputeCase } = await makeUncapturedDisputeCase("NO_SHOW_CONTESTED");

    const resolved = await disputeCaseService.resolveCase(l2AdminId, disputeCase.id, {
      resolution: "REFUNDED",
      note: "Profissional não compareceu."
    });

    expect(resolved.resolution).toBe("REFUNDED");
    expect(cancelSpy).toHaveBeenCalledTimes(1);

    const updatedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(updatedPayment.status).toBe(PaymentStatus.CANCELED);

    // Sem dívida pro profissional — ele nunca chegou a receber esse dinheiro.
    const debt = await prisma.debtRecord.findFirst({ where: { disputeCaseId: disputeCase.id } });
    expect(debt).toBeNull();

    cancelSpy.mockRestore();
  });

  it("resolver a favor do profissional (DENIED) captura o pagamento pela primeira vez, em vez de nunca cobrar", async () => {
    const captureSpy = vi.spyOn(Payment.prototype, "capture").mockResolvedValue({ status: "approved", status_detail: "accredited" } as any);
    const { payment, disputeCase } = await makeUncapturedDisputeCase("CONFIRMATION_DEADLOCK");

    const resolved = await disputeCaseService.resolveCase(l2AdminId, disputeCase.id, {
      resolution: "DENIED",
      note: "Sessão confirmada pelas duas partes e presença validada."
    });

    expect(resolved.resolution).toBe("DENIED");
    expect(captureSpy).toHaveBeenCalledTimes(1);

    const updatedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(updatedPayment.status).toBe(PaymentStatus.CAPTURED);

    captureSpy.mockRestore();
  });
});

describe("Frente 6 (segunda camada), Lote 10 — paridade do profissional em disputas", () => {
  const disputeCaseService = new DisputeCaseService();
  let l10ClientId = "";
  let l10ProviderUserId = "";
  let l10ProviderId = "";

  beforeAll(async () => {
    const client = await prisma.user.create({
      data: {
        name: "Frente6 Lote10 Aluno",
        email: `${uid("f6l10_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}4`,
        role: "CLIENT"
      }
    });
    l10ClientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Frente6 Lote10 Profissional",
        email: `${uid("f6l10_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}5`,
        role: "PROVIDER"
      }
    });
    l10ProviderUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: l10ProviderUserId,
        displayName: "Frente6 Lote10 Profissional",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222343",
        crefValidationStatus: "APPROVED"
      }
    });
    l10ProviderId = provider.id;

    await prisma.disputeCase.create({
      data: {
        type: "NO_SHOW_CONTESTED",
        clientId: l10ClientId,
        providerId: l10ProviderId,
        amountCents: 10000
      }
    });
  });

  afterAll(async () => {
    await prisma.disputeCase.deleteMany({ where: { clientId: l10ClientId } });
    await prisma.providerProfile.deleteMany({ where: { id: l10ProviderId } });
    await prisma.session.deleteMany({ where: { userId: { in: [l10ClientId, l10ProviderUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [l10ClientId, l10ProviderUserId] } } });
  });

  it("listMyDisputes traz o nome do cliente — o profissional agora usa a mesma tela e precisa saber com quem é a disputa", async () => {
    const disputes = await disputeCaseService.listMyDisputes(l10ProviderUserId);
    expect(disputes.length).toBeGreaterThan(0);
    expect(disputes[0].client.name).toBe("Frente6 Lote10 Aluno");
  });
});

describe("Frente 6 (segunda camada), Lote 3 — corridas de concorrência sem trava", () => {
  let l3ClientId = "";
  let l3ProviderUserId = "";
  let l3ProviderId = "";
  let l3CategoryId = "";
  let l3OfferId = "";
  const l3BookingIds: string[] = [];
  const l3PackageIds: string[] = [];

  beforeAll(async () => {
    const category = await prisma.serviceCategory.create({
      data: { name: `F6L3_${Date.now()}`, description: "test" }
    });
    l3CategoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Frente6 Lote3 Cliente",
        email: `${uid("f6l3_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}6`,
        role: "CLIENT",
        emailVerifiedAt: new Date()
      }
    });
    l3ClientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId: l3ClientId, status: "COMPLETED", completedAt: new Date() } });

    const providerUser = await prisma.user.create({
      data: {
        name: "Frente6 Lote3 Profissional",
        email: `${uid("f6l3_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}7`,
        role: "PROVIDER"
      }
    });
    l3ProviderUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: l3ProviderUserId,
        displayName: "Frente6 Lote3 Profissional",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222339",
        crefValidationStatus: "APPROVED"
      }
    });
    l3ProviderId = provider.id;

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId: l3ProviderId,
        kind: "PRESENTIAL",
        title: "Pacote Lote 3",
        billingCycle: "MONTHLY",
        priceCents: 40000,
        presentialPackageMode: "FLEXIBLE_CREDITS",
        presentialSessionsPerCycle: 4
      }
    });
    l3OfferId = offer.id;
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { booking: { id: { in: l3BookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: l3BookingIds } } });
    await prisma.presentialPackage.deleteMany({ where: { id: { in: l3PackageIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: l3OfferId } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId: l3ClientId } });
    await prisma.providerProfile.deleteMany({ where: { id: l3ProviderId } });
    await prisma.session.deleteMany({ where: { userId: { in: [l3ClientId, l3ProviderUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [l3ClientId, l3ProviderUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: l3CategoryId } });
  });

  it("cancelar duas vezes quase ao mesmo tempo (duplo toque) não devolve o crédito do pacote em dobro", async () => {
    const pkg = await prisma.presentialPackage.create({
      data: {
        providerId: l3ProviderId,
        clientId: l3ClientId,
        offerId: l3OfferId,
        categoryId: l3CategoryId,
        mode: "FLEXIBLE_CREDITS",
        status: "ACTIVE",
        cycleAmountCents: 40000,
        billingCycle: "MONTHLY",
        sessionsPerCycle: 4,
        creditsRemainingThisCycle: 2
      }
    });
    l3PackageIds.push(pkg.id);

    const booking = await prisma.booking.create({
      data: {
        clientId: l3ClientId,
        providerId: l3ProviderId,
        categoryId: l3CategoryId,
        packageId: pkg.id,
        scheduledAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        priceCents: 10000,
        status: BookingStatus.CONFIRMED
      }
    });
    l3BookingIds.push(booking.id);
    await prisma.payment.create({
      data: { bookingId: booking.id, amountCents: 10000, status: PaymentStatus.AUTHORIZED }
    });

    const [resultA, resultB] = await Promise.allSettled([
      bookingService.updateStatus(l3ClientId, booking.id, BookingStatus.CANCELLED),
      bookingService.updateStatus(l3ClientId, booking.id, BookingStatus.CANCELLED)
    ]);

    const fulfilled = [resultA, resultB].filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBe(1);

    const updatedPkg = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    // Começou com 2, deveria terminar com 3 (só uma devolução), nunca 4.
    expect(updatedPkg.creditsRemainingThisCycle).toBe(3);
  });

  it("cancelar e confirmar conclusão quase ao mesmo tempo (após presença validada) não deixam o booking em estado inconsistente", async () => {
    const scheduled = new Date(Date.now() - 60 * 60 * 1000);
    const booking = await prisma.booking.create({
      data: {
        clientId: l3ClientId,
        providerId: l3ProviderId,
        categoryId: l3CategoryId,
        scheduledAt: scheduled,
        priceCents: 10000,
        status: BookingStatus.CONFIRMED,
        attendanceCodeValidatedAt: new Date()
      }
    });
    l3BookingIds.push(booking.id);
    await prisma.payment.create({
      data: { bookingId: booking.id, amountCents: 10000, status: PaymentStatus.AUTHORIZED, mpPaymentId: `mp_${uid("pay")}` }
    });

    const TINY_JPEG_BASE64 =
      "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=";
    const completionProof = {
      imageBase64: `data:image/jpeg;base64,${TINY_JPEG_BASE64}`,
      mimeType: "image/jpeg" as const,
      cameraFacing: "FRONT" as const
    };

    const [cancelResult, completeResult] = await Promise.allSettled([
      bookingService.updateStatus(l3ClientId, booking.id, BookingStatus.CANCELLED),
      bookingService.updateStatus(l3ProviderUserId, booking.id, BookingStatus.COMPLETED, completionProof)
    ]);

    const outcomes = [cancelResult, completeResult];
    const fulfilledCount = outcomes.filter((r) => r.status === "fulfilled").length;
    // Uma das duas ações vence a corrida; a outra recebe um erro claro em
    // vez de escrever por cima silenciosamente.
    expect(fulfilledCount).toBe(1);

    const finalBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect([BookingStatus.CANCELLED, BookingStatus.COMPLETED]).toContain(finalBooking.status);
  });
});

describe("Frente 6 (segunda camada), Lote 4 — conflito com aluno financeiro manual", () => {
  let l4ClientId = "";
  let l4ProviderUserId = "";
  let l4ProviderId = "";
  let l4CategoryId = "";
  const l4BookingIds: string[] = [];
  const l4StudentIds: string[] = [];

  beforeAll(async () => {
    const category = await prisma.serviceCategory.create({
      data: { name: `F6L4_${Date.now()}`, description: "test" }
    });
    l4CategoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Frente6 Lote4 Cliente",
        email: `${uid("f6l4_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}8`,
        role: "CLIENT",
        emailVerifiedAt: new Date()
      }
    });
    l4ClientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId: l4ClientId, status: "COMPLETED", completedAt: new Date() } });

    const providerUser = await prisma.user.create({
      data: {
        name: "Frente6 Lote4 Profissional",
        email: `${uid("f6l4_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}9`,
        role: "PROVIDER"
      }
    });
    l4ProviderUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: l4ProviderUserId,
        displayName: "Frente6 Lote4 Profissional",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222340",
        crefValidationStatus: "APPROVED",
        minBookingNoticeHours: 1
      }
    });
    l4ProviderId = provider.id;

    await prisma.availability.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        providerId: l4ProviderId,
        weekday,
        startTime: "00:00",
        endTime: "23:59",
        isActive: true
      }))
    });
    await prisma.providerCategory.create({ data: { providerId: l4ProviderId, categoryId: l4CategoryId } });
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { booking: { id: { in: l4BookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: l4BookingIds } } });
    await prisma.financialStudent.deleteMany({ where: { id: { in: l4StudentIds } } });
    await prisma.availability.deleteMany({ where: { providerId: l4ProviderId } });
    await prisma.providerCategory.deleteMany({ where: { providerId: l4ProviderId } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId: l4ClientId } });
    await prisma.providerProfile.deleteMany({ where: { id: l4ProviderId } });
    await prisma.session.deleteMany({ where: { userId: { in: [l4ClientId, l4ProviderUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [l4ClientId, l4ProviderUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: l4CategoryId } });
  });

  it("agendar por cima do horário de um aluno financeiro manual (fora do app) é rejeitado", async () => {
    const scheduled = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000);
    scheduled.setHours(10, 0, 0, 0);
    const weekday = toWeekdayInTimezone(scheduled, env.APP_TIMEZONE);

    const student = await prisma.financialStudent.create({
      data: {
        providerId: l4ProviderId,
        name: `Aluno fora do app ${uid("x")}`,
        monthlyValueCents: 30000,
        type: "PRESENTIAL",
        isActive: true,
        startDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        weeklySchedule: [{ dayOfWeek: weekday, startTime: "09:30", endTime: "10:30" }]
      }
    });
    l4StudentIds.push(student.id);

    await expect(
      bookingService.create(l4ClientId, l4ProviderId, l4CategoryId, scheduled.toISOString(), undefined, "CREDIT_CARD" as any)
    ).rejects.toThrow(/ocupado por outro aluno/i);
  });

  it("agendar num horário sem conflito com aluno financeiro manual continua funcionando normalmente", async () => {
    const scheduled = new Date(Date.now() + 26 * 24 * 60 * 60 * 1000);
    scheduled.setHours(14, 0, 0, 0);

    const booking = await bookingService.create(
      l4ClientId, l4ProviderId, l4CategoryId, scheduled.toISOString(), undefined, "CREDIT_CARD" as any
    );
    l4BookingIds.push(booking.id);
    expect(booking.id).toBeTruthy();
  });
});

describe("Frente 6 (segunda camada), Lote 8 — cobrança/reembolso pós-horário sem presença validada", () => {
  let l8ClientId = "";
  let l8ProviderUserId = "";
  let l8ProviderId = "";
  let l8CategoryId = "";
  const l8BookingIds: string[] = [];

  beforeAll(async () => {
    const category = await prisma.serviceCategory.create({
      data: { name: `F6L8_${Date.now()}`, description: "test" }
    });
    l8CategoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Frente6 Lote8 Cliente",
        email: `${uid("f6l8_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}0`,
        role: "CLIENT",
        emailVerifiedAt: new Date()
      }
    });
    l8ClientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Frente6 Lote8 Profissional",
        email: `${uid("f6l8_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "PROVIDER"
      }
    });
    l8ProviderUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: l8ProviderUserId,
        displayName: "Frente6 Lote8 Profissional",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222341",
        crefValidationStatus: "APPROVED"
      }
    });
    l8ProviderId = provider.id;
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { booking: { id: { in: l8BookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: l8BookingIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: l8ProviderId } });
    await prisma.session.deleteMany({ where: { userId: { in: [l8ClientId, l8ProviderUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [l8ClientId, l8ProviderUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: l8CategoryId } });
  });

  async function makePastUnvalidatedBooking() {
    const booking = await prisma.booking.create({
      data: {
        clientId: l8ClientId,
        providerId: l8ProviderId,
        categoryId: l8CategoryId,
        scheduledAt: new Date(Date.now() - 60 * 60 * 1000),
        priceCents: 10000,
        status: BookingStatus.CONFIRMED
      }
    });
    l8BookingIds.push(booking.id);
    await prisma.payment.create({
      data: { bookingId: booking.id, amountCents: 10000, status: PaymentStatus.AUTHORIZED }
    });
    return booking;
  }

  it("cliente não consegue mais se auto-cancelar (e ser cobrado na hora) depois do horário sem contestação — precisa reportar falta", async () => {
    const booking = await makePastUnvalidatedBooking();
    await expect(
      bookingService.updateStatus(l8ClientId, booking.id, BookingStatus.CANCELLED)
    ).rejects.toThrow(/reportar falta/i);

    const stillConfirmed = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stillConfirmed.status).toBe(BookingStatus.CONFIRMED);
  });

  it("profissional não consegue mais reembolsar sem querer um cliente que faltou usando o cancelamento simples — precisa reportar falta", async () => {
    const booking = await makePastUnvalidatedBooking();
    await expect(
      bookingService.updateStatus(l8ProviderUserId, booking.id, BookingStatus.CANCELLED)
    ).rejects.toThrow(/reportar falta/i);

    const stillConfirmed = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stillConfirmed.status).toBe(BookingStatus.CONFIRMED);
  });

  it("cancelar antes do horário continua funcionando normalmente, mesmo sem presença validada (ainda nem chegou a hora)", async () => {
    const scheduled = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
    const booking = await prisma.booking.create({
      data: {
        clientId: l8ClientId,
        providerId: l8ProviderId,
        categoryId: l8CategoryId,
        scheduledAt: scheduled,
        priceCents: 10000,
        status: BookingStatus.CONFIRMED
      }
    });
    l8BookingIds.push(booking.id);
    await prisma.payment.create({
      data: { bookingId: booking.id, amountCents: 10000, status: PaymentStatus.AUTHORIZED }
    });

    const cancelled = await bookingService.updateStatus(l8ClientId, booking.id, BookingStatus.CANCELLED);
    expect(cancelled.status).toBe(BookingStatus.CANCELLED);
  });
});

describe("Frente 6 (segunda camada), Lote 9 — prazo de confirmação síncrono e rate limit sem Redis", () => {
  let l9ClientId = "";
  let l9ProviderUserId = "";
  let l9ProviderId = "";
  let l9CategoryId = "";
  const l9BookingIds: string[] = [];
  const originalRedisStatus = redis.status;

  beforeAll(async () => {
    const category = await prisma.serviceCategory.create({
      data: { name: `F6L9_${Date.now()}`, description: "test" }
    });
    l9CategoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Frente6 Lote9 Cliente",
        email: `${uid("f6l9_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "CLIENT",
        emailVerifiedAt: new Date()
      }
    });
    l9ClientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Frente6 Lote9 Profissional",
        email: `${uid("f6l9_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}3`,
        role: "PROVIDER"
      }
    });
    l9ProviderUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: l9ProviderUserId,
        displayName: "Frente6 Lote9 Profissional",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222342",
        crefValidationStatus: "APPROVED"
      }
    });
    l9ProviderId = provider.id;
  });

  afterEach(() => {
    redis.status = originalRedisStatus;
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { booking: { id: { in: l9BookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: l9BookingIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: l9ProviderId } });
    await prisma.session.deleteMany({ where: { userId: { in: [l9ClientId, l9ProviderUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [l9ClientId, l9ProviderUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: l9CategoryId } });
  });

  it("confirmar um agendamento depois do prazo já vencido é rejeitado na hora, não só pelo job periódico", async () => {
    const booking = await prisma.booking.create({
      data: {
        clientId: l9ClientId,
        providerId: l9ProviderId,
        categoryId: l9CategoryId,
        scheduledAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        priceCents: 10000,
        status: BookingStatus.PENDING,
        confirmationDeadlineAt: new Date(Date.now() - 60 * 60 * 1000)
      }
    });
    l9BookingIds.push(booking.id);

    await expect(
      bookingService.updateStatus(l9ProviderUserId, booking.id, BookingStatus.CONFIRMED)
    ).rejects.toThrow(/prazo para confirmar/i);

    const stillPending = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stillPending.status).toBe(BookingStatus.PENDING);
  });

  it("limite de tentativas do código de presença continua valendo quando o Redis não está pronto (fallback em memória)", async () => {
    const booking = await prisma.booking.create({
      data: {
        clientId: l9ClientId,
        providerId: l9ProviderId,
        categoryId: l9CategoryId,
        scheduledAt: new Date(Date.now() + 11 * 24 * 60 * 60 * 1000),
        priceCents: 10000,
        status: BookingStatus.CONFIRMED,
        attendanceCode: "999888"
      }
    });
    l9BookingIds.push(booking.id);

    redis.status = "end";

    for (let i = 0; i < 10; i++) {
      await expect(
        bookingService.verifyAttendanceCode(l9ProviderUserId, booking.id, "000000")
      ).rejects.toThrow(/código de presença inválido/i);
    }

    await expect(
      bookingService.verifyAttendanceCode(l9ProviderUserId, booking.id, "999888")
    ).rejects.toThrow(/muitas tentativas/i);
  });
});

describe("Frente 6 (segunda camada), Lote 14 — bloqueio manual cruzando a meia-noite", () => {
  const manualBlockService = new ManualBlockService();
  let l14ClientId = "";
  let l14ProviderUserId = "";
  let l14ProviderId = "";
  let l14CategoryId = "";
  const l14BookingIds: string[] = [];
  const l14BlockIds: string[] = [];

  beforeAll(async () => {
    const category = await prisma.serviceCategory.create({
      data: { name: `F6L14_${Date.now()}`, description: "test" }
    });
    l14CategoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Frente6 Lote14 Cliente",
        email: `${uid("f6l14_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}6`,
        role: "CLIENT",
        emailVerifiedAt: new Date()
      }
    });
    l14ClientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId: l14ClientId, status: "COMPLETED", completedAt: new Date() } });

    const providerUser = await prisma.user.create({
      data: {
        name: "Frente6 Lote14 Profissional",
        email: `${uid("f6l14_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}7`,
        role: "PROVIDER"
      }
    });
    l14ProviderUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: l14ProviderUserId,
        displayName: "Frente6 Lote14 Profissional",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222344",
        crefValidationStatus: "APPROVED",
        minBookingNoticeHours: 1,
        sessionDurationMinutes: 60
      }
    });
    l14ProviderId = provider.id;

    await prisma.availability.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        providerId: l14ProviderId,
        weekday,
        startTime: "00:00",
        endTime: "23:59",
        isActive: true
      }))
    });
    await prisma.providerCategory.create({ data: { providerId: l14ProviderId, categoryId: l14CategoryId } });
  });

  afterAll(async () => {
    await prisma.providerManualBlock.deleteMany({ where: { id: { in: l14BlockIds } } });
    await prisma.payment.deleteMany({ where: { booking: { id: { in: l14BookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: l14BookingIds } } });
    await prisma.availability.deleteMany({ where: { providerId: l14ProviderId } });
    await prisma.providerCategory.deleteMany({ where: { providerId: l14ProviderId } });
    await prisma.providerProfile.deleteMany({ where: { id: l14ProviderId } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId: l14ClientId } });
    await prisma.session.deleteMany({ where: { userId: { in: [l14ClientId, l14ProviderUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [l14ClientId, l14ProviderUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: l14CategoryId } });
  });

  it("bloqueio manual no início do dia seguinte é rejeitado se colide com sessão que atravessou a meia-noite", async () => {
    const day = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    day.setHours(23, 30, 0, 0); // sessão de 60min: 23:30 → 00:30 do dia seguinte
    const booking = await bookingService.create(
      l14ClientId, l14ProviderId, l14CategoryId, day.toISOString(), undefined, "CREDIT_CARD" as any
    );
    l14BookingIds.push(booking.id);

    const nextDay = new Date(day.getTime() + 24 * 60 * 60 * 1000);
    const nextDayKey = toDateKeyInTimezone(nextDay, env.APP_TIMEZONE);

    await expect(
      manualBlockService.create(l14ProviderUserId, {
        date: nextDayKey,
        startTime: "00:00",
        endTime: "01:00",
        label: "Compromisso de manhã cedo"
      })
    ).rejects.toThrow(/já existe um agendamento/i);
  });

  it("bloqueio manual bem depois da sessão que atravessou a meia-noite continua funcionando normalmente", async () => {
    const day = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    day.setHours(23, 30, 0, 0);
    const booking = await bookingService.create(
      l14ClientId, l14ProviderId, l14CategoryId, day.toISOString(), undefined, "CREDIT_CARD" as any
    );
    l14BookingIds.push(booking.id);

    const nextDay = new Date(day.getTime() + 24 * 60 * 60 * 1000);
    const nextDayKey = toDateKeyInTimezone(nextDay, env.APP_TIMEZONE);

    const block = await manualBlockService.create(l14ProviderUserId, {
      date: nextDayKey,
      startTime: "10:00",
      endTime: "11:00",
      label: "Compromisso à tarde"
    });
    l14BlockIds.push(block.id);
    expect(block.id).toBeTruthy();
  });
});
