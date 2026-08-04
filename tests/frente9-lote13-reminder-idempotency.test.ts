import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { CrefValidationStatus, PresentialPackageMode, PresentialPackageStatus } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { BookingService } from "../src/modules/bookings/services/booking.service";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";
import { NotificationService } from "../src/modules/notifications/services/notification.service";
import { hashValue } from "../src/shared/utils/hash";

// Épico de Frentes, Frente 9, Lote 13: idempotência dos jobs de lembrete.
// (1) sendFlexibleSessionPackExpiryReminders/sendPresentialPackageBillingReminders
//     notificavam ANTES de marcar - se o processo caísse entre as duas
//     operações (ou, equivalente pro teste, se o envio falhar), o próximo
//     run encontrava o campo *SentAt ainda null e notificava de novo.
// (2) sendSessionReminders trocou a janela fixa de ±5min por um modelo de
//     cruzamento de limiar, auto-recuperável pra qualquer atraso do job.

const bookingService = new BookingService();
const presentialPackageService = new PresentialPackageService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let categoryId = "";
let clientId = "";
let providerUserId = "";
let providerId = "";
let offerId = "";
const createdUserIds: string[] = [];
const packageIds: string[] = [];
const bookingIds: string[] = [];

describe("Frente 9, Lote 13 — idempotência dos jobs de lembrete", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `F9L13_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Frente Nove Lote Treze Client",
        email: `${uid("f9l13_client")}@test.com`,
        password: await hashValue("Test1234"),
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;
    createdUserIds.push(clientId);

    const providerUser = await prisma.user.create({
      data: {
        name: "Frente Nove Lote Treze Provider",
        email: `${uid("f9l13_provider")}@test.com`,
        password: await hashValue("Test1234"),
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;
    createdUserIds.push(providerUserId);

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "F9L13 Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: `mp_${uid("f9l13")}`,
        crefValidationStatus: CrefValidationStatus.APPROVED
      }
    });
    providerId = provider.id;

    const offer = await prisma.providerServiceOffer.create({
      data: {
        providerId,
        kind: "PRESENTIAL",
        title: "Pacote de teste F9L13",
        billingCycle: "MONTHLY",
        priceCents: 30000,
        presentialPackageMode: "FIXED_RECURRING",
        presentialHasFixedTerm: false,
        presentialSessionsPerCycle: 4
      }
    });
    offerId = offer.id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.presentialPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.providerServiceOffer.deleteMany({ where: { id: offerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("marca expiryReminderSentAt mesmo quando o envio da notificação falha (mark-before-notify)", async () => {
    vi.spyOn(NotificationService.prototype, "sendToUsers").mockRejectedValue(new Error("push failed"));

    const pkg = await prisma.presentialPackage.create({
      data: {
        clientId,
        providerId,
        offerId,
        categoryId,
        mode: PresentialPackageMode.FLEXIBLE_CREDITS,
        status: PresentialPackageStatus.ACTIVE,
        cycleAmountCents: 30000,
        billingCycle: "MONTHLY",
        sessionsPerCycle: 4,
        creditsRemainingThisCycle: 3,
        validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
    packageIds.push(pkg.id);

    await presentialPackageService.sendFlexibleSessionPackExpiryReminders();

    const stored = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(stored.expiryReminderSentAt).not.toBeNull();
  });

  it("marca status EXPIRED mesmo quando o envio da notificação falha", async () => {
    vi.spyOn(NotificationService.prototype, "sendToUsers").mockRejectedValue(new Error("push failed"));

    const pkg = await prisma.presentialPackage.create({
      data: {
        clientId,
        providerId,
        offerId,
        categoryId,
        mode: PresentialPackageMode.FLEXIBLE_CREDITS,
        status: PresentialPackageStatus.ACTIVE,
        cycleAmountCents: 30000,
        billingCycle: "MONTHLY",
        sessionsPerCycle: 4,
        creditsRemainingThisCycle: 2,
        validUntil: new Date(Date.now() - 60 * 60 * 1000)
      }
    });
    packageIds.push(pkg.id);

    await presentialPackageService.sendFlexibleSessionPackExpiryReminders();

    const stored = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(stored.status).toBe(PresentialPackageStatus.EXPIRED);
  });

  it("marca billingReminderSentAt mesmo quando o envio da notificação falha", async () => {
    vi.spyOn(NotificationService.prototype, "sendToUsers").mockRejectedValue(new Error("push failed"));

    const pkg = await prisma.presentialPackage.create({
      data: {
        clientId,
        providerId,
        offerId,
        categoryId,
        mode: PresentialPackageMode.FIXED_RECURRING,
        status: PresentialPackageStatus.ACTIVE,
        cycleAmountCents: 30000,
        billingCycle: "MONTHLY",
        sessionsPerCycle: 4,
        nextBillingAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
    packageIds.push(pkg.id);

    await presentialPackageService.sendPresentialPackageBillingReminders();

    const stored = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(stored.billingReminderSentAt).not.toBeNull();
  });

  async function makeConfirmedBooking(scheduledAt: Date) {
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt,
        priceCents: 10000,
        status: "CONFIRMED"
      }
    });
    bookingIds.push(booking.id);
    return booking;
  }

  it("sessão a 55min de distância recebe o lembrete de 1h (dentro do limiar normal)", async () => {
    vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
    const booking = await makeConfirmedBooking(new Date(Date.now() + 55 * 60 * 1000));

    await bookingService.sendSessionReminders();

    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.reminder60SentAt).not.toBeNull();
    expect(stored.reminder30SentAt).toBeNull();
  });

  it("job atrasado (sessão já a 20min de distância, nunca recebeu o lembrete de 1h) recupera direto com o lembrete de 30min, sem lembrete de 1h atrasado e incorreto", async () => {
    vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
    // Simula o catch-up: o job nunca rodou enquanto a sessão estava na
    // janela de 1h (reminder60SentAt segue null), e agora já está a 20min -
    // dentro da janela de 30min.
    const booking = await makeConfirmedBooking(new Date(Date.now() + 20 * 60 * 1000));

    await bookingService.sendSessionReminders();

    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.reminder30SentAt).not.toBeNull();
    // O lembrete de 1h não é mandado atrasado e com texto errado ("em 1
    // hora" quando faltam 20min) - fica sem ser enviado, o de 30min já
    // cobre o aviso.
    expect(stored.reminder60SentAt).toBeNull();
  });

  it("sessão que já passou não recebe nenhum lembrete novo", async () => {
    vi.spyOn(NotificationService.prototype, "sendToUsers").mockResolvedValue(undefined as any);
    const booking = await makeConfirmedBooking(new Date(Date.now() - 5 * 60 * 1000));

    await bookingService.sendSessionReminders();

    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.reminder60SentAt).toBeNull();
    expect(stored.reminder30SentAt).toBeNull();
  });
});
