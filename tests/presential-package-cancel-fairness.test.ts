import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Payment } from "mercadopago";
import {
  BookingStatus,
  PresentialPackageMode,
  PresentialPackageStatus,
  PaymentStatus,
  ConsultancyPaymentMethod
} from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { PresentialPackageService } from "../src/modules/presential-packages/services/presential-package.service";

// Raio-X de pagamentos (27/07/2026) — Lote 3: cancelar o PACOTE inteiro não
// pode mais ser um jeito de escapar da regra das 2h que já existia pra
// sessão avulsa isolada; e cancelar o pacote no modelo antigo (ciclo pago
// via Pix) precisa desmarcar as sessões já geradas daquele ciclo, não deixar
// elas "confirmadas" como se nada tivesse mudado.

const packageService = new PresentialPackageService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const packageIds: string[] = [];
const bookingIds: string[] = [];

describe("Cancelamento justo de pacote presencial (Lote 3 do raio-x)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `PF_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Cancel Fairness Client",
        email: `${uid("cf_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: "CLIENT"
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Cancel Fairness Provider",
        email: `${uid("cf_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Cancel Fairness Provider",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "666555444",
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;
  });

  afterAll(async () => {
    await prisma.disputeCase.deleteMany({ where: { clientId } });
    await prisma.payment.deleteMany({ where: { booking: { id: { in: bookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.presentialPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  async function createFlexiblePackageWithSessions() {
    const pkg = await prisma.presentialPackage.create({
      data: {
        providerId,
        clientId,
        offerId: (await prisma.providerServiceOffer.create({
          data: {
            providerId,
            kind: "PRESENTIAL",
            title: `Pacote ${uid("offer")}`,
            billingCycle: "MONTHLY",
            priceCents: 8000,
            presentialPackageMode: "FLEXIBLE_CREDITS",
            presentialSessionsPerCycle: 5,
            presentialHasFixedTerm: true,
            presentialTotalCycles: 1
          }
        })).id,
        categoryId,
        mode: PresentialPackageMode.FLEXIBLE_CREDITS,
        status: PresentialPackageStatus.ACTIVE,
        cycleAmountCents: 8000,
        billingCycle: "MONTHLY",
        sessionsPerCycle: 5,
        creditsRemainingThisCycle: 3,
        validFrom: new Date(),
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }
    });
    packageIds.push(pkg.id);

    async function createSession(hoursFromNow: number) {
      const booking = await prisma.booking.create({
        data: {
          clientId,
          providerId,
          categoryId,
          packageId: pkg.id,
          scheduledAt: new Date(Date.now() + hoursFromNow * 60 * 60 * 1000),
          priceCents: 8000,
          status: BookingStatus.CONFIRMED
        }
      });
      bookingIds.push(booking.id);
      await prisma.payment.create({
        data: {
          bookingId: booking.id,
          amountCents: 8000,
          currency: "BRL",
          method: "CREDIT_CARD",
          status: PaymentStatus.AUTHORIZED,
          mpPaymentId: `mp_${uid("pay")}`
        }
      });
      return booking;
    }

    const soonSession = await createSession(1); // <2h
    const laterSession = await createSession(72); // 2h+

    return { pkg, soonSession, laterSession };
  }

  it("cliente cancela o pacote: sessao a menos de 2h e cobrada (profissional mantem o valor), sessao mais distante so libera a reserva", async () => {
    // As sessoes ainda nao aconteceram - o pagamento esta so reservado
    // (AUTHORIZED), nunca capturado. Cancelar uma reserva libera o cartao
    // (Payment.cancel), nao estorna dinheiro que nunca foi cobrado de verdade
    // (PaymentRefund.create so se aplica a pagamento ja CAPTURED).
    vi.spyOn(Payment.prototype, "capture").mockResolvedValueOnce({ status: "approved", status_detail: "accredited" } as any);
    vi.spyOn(Payment.prototype, "cancel").mockResolvedValueOnce({} as any);

    const { pkg, soonSession, laterSession } = await createFlexiblePackageWithSessions();

    await packageService.cancelPackage(clientId, pkg.id);

    const soonPayment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: soonSession.id } });
    expect(soonPayment.status).toBe(PaymentStatus.CAPTURED);

    const laterPayment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: laterSession.id } });
    expect(laterPayment.status).toBe(PaymentStatus.CANCELED);

    const soonBooking = await prisma.booking.findUniqueOrThrow({ where: { id: soonSession.id } });
    expect(soonBooking.status).toBe(BookingStatus.CANCELLED);
  });

  it("profissional cancela o pacote: mesmo com sessao a menos de 2h, reserva do cliente e liberada (nao e culpa dele)", async () => {
    vi.spyOn(Payment.prototype, "cancel")
      .mockResolvedValueOnce({} as any)
      .mockResolvedValueOnce({} as any);

    const { pkg, soonSession, laterSession } = await createFlexiblePackageWithSessions();

    await packageService.cancelPackage(providerUserId, pkg.id);

    const soonPayment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: soonSession.id } });
    expect(soonPayment.status).toBe(PaymentStatus.CANCELED);

    const laterPayment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: laterSession.id } });
    expect(laterPayment.status).toBe(PaymentStatus.CANCELED);
  });

  it("cancelamento no modelo antigo (ciclo pago via Pix) desmarca as sessoes CONFIRMED do ciclo", async () => {
    const oldPkg = await prisma.presentialPackage.create({
      data: {
        providerId,
        clientId,
        offerId: (await prisma.providerServiceOffer.create({
          data: {
            providerId,
            kind: "PRESENTIAL",
            title: `Pacote antigo ${uid("offer")}`,
            billingCycle: "MONTHLY",
            priceCents: 40000,
            presentialPackageMode: "FIXED_RECURRING",
            presentialSessionsPerCycle: 4
          }
        })).id,
        categoryId,
        mode: PresentialPackageMode.FIXED_RECURRING,
        status: PresentialPackageStatus.ACTIVE,
        paymentMethod: ConsultancyPaymentMethod.PIX,
        cycleAmountCents: 40000,
        billingCycle: "MONTHLY",
        sessionsPerCycle: 4
      }
    });
    packageIds.push(oldPkg.id);

    const futureBooking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        packageId: oldPkg.id,
        scheduledAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        priceCents: 0,
        status: BookingStatus.CONFIRMED
      }
    });
    bookingIds.push(futureBooking.id);

    await packageService.cancelPackage(providerUserId, oldPkg.id);

    const afterBooking = await prisma.booking.findUniqueOrThrow({ where: { id: futureBooking.id } });
    expect(afterBooking.status).toBe(BookingStatus.CANCELLED);
  });

  it("sendFlexibleSessionPackExpiryReminders avisa quando falta pouco pra vencer e expira quando ja venceu", async () => {
    const soonToExpire = await prisma.presentialPackage.create({
      data: {
        providerId,
        clientId,
        offerId: (await prisma.providerServiceOffer.create({
          data: {
            providerId,
            kind: "PRESENTIAL",
            title: `Pacote vencendo ${uid("offer")}`,
            billingCycle: "MONTHLY",
            priceCents: 8000,
            presentialPackageMode: "FLEXIBLE_CREDITS",
            presentialSessionsPerCycle: 5,
            presentialHasFixedTerm: true,
            presentialTotalCycles: 1
          }
        })).id,
        categoryId,
        mode: PresentialPackageMode.FLEXIBLE_CREDITS,
        status: PresentialPackageStatus.ACTIVE,
        cycleAmountCents: 8000,
        billingCycle: "MONTHLY",
        sessionsPerCycle: 5,
        creditsRemainingThisCycle: 2,
        validFrom: new Date(),
        validUntil: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
      }
    });
    packageIds.push(soonToExpire.id);

    const alreadyExpired = await prisma.presentialPackage.create({
      data: {
        providerId,
        clientId,
        offerId: (await prisma.providerServiceOffer.create({
          data: {
            providerId,
            kind: "PRESENTIAL",
            title: `Pacote vencido ${uid("offer")}`,
            billingCycle: "MONTHLY",
            priceCents: 8000,
            presentialPackageMode: "FLEXIBLE_CREDITS",
            presentialSessionsPerCycle: 5,
            presentialHasFixedTerm: true,
            presentialTotalCycles: 1
          }
        })).id,
        categoryId,
        mode: PresentialPackageMode.FLEXIBLE_CREDITS,
        status: PresentialPackageStatus.ACTIVE,
        cycleAmountCents: 8000,
        billingCycle: "MONTHLY",
        sessionsPerCycle: 5,
        creditsRemainingThisCycle: 1,
        validFrom: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        validUntil: new Date(Date.now() - 24 * 60 * 60 * 1000)
      }
    });
    packageIds.push(alreadyExpired.id);

    await packageService.sendFlexibleSessionPackExpiryReminders();

    const afterSoon = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: soonToExpire.id } });
    expect(afterSoon.status).toBe(PresentialPackageStatus.ACTIVE);
    expect(afterSoon.expiryReminderSentAt).not.toBeNull();

    const afterExpired = await prisma.presentialPackage.findUniqueOrThrow({ where: { id: alreadyExpired.id } });
    expect(afterExpired.status).toBe(PresentialPackageStatus.EXPIRED);
  });
});
