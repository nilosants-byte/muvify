import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { PaymentRefund } from "mercadopago";
import { BookingStatus, PaymentMethod, PaymentStatus, UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { PaymentService } from "../src/modules/payments/services/payment.service";
import { DisputeCaseService } from "../src/modules/admin/services/dispute-case.service";
import { env } from "../src/config/env";

// Épico de Frentes, Frente 5 (Descoberta, agendamento e agenda), Lote 4:
// rating médio do profissional é recalculado (excluindo a review) quando o
// pagamento da sessão avaliada é estornado por completo depois — tanto pelo
// cancelamento direto de booking quanto pela resolução manual de uma
// disputa pelo admin.

const paymentService = new PaymentService();
const disputeCaseService = new DisputeCaseService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
let adminId = "";
const bookingIds: string[] = [];

async function makeCompletedBookingWithReview(rating: number) {
  const booking = await prisma.booking.create({
    data: {
      clientId,
      providerId,
      categoryId,
      scheduledAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      priceCents: 10000,
      status: BookingStatus.COMPLETED,
      completedAt: new Date()
    }
  });
  bookingIds.push(booking.id);

  const payment = await prisma.payment.create({
    data: {
      bookingId: booking.id,
      method: PaymentMethod.CREDIT_CARD,
      status: PaymentStatus.CAPTURED,
      amountCents: 10000,
      currency: "BRL",
      mpPaymentId: `mp_${uid("pay")}`,
      capturedAt: new Date()
    }
  });

  const review = await prisma.review.create({
    data: { bookingId: booking.id, userId: clientId, providerId, rating }
  });
  await prisma.providerProfile.update({
    where: { id: providerId },
    data: { averageRating: rating, totalReviews: 1 }
  });

  return { booking, payment, review };
}

describe("Frente 5, Lote 4 — rating recalculado após estorno total de sessão avaliada", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `F5L4_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Cinco Lote Quatro",
        email: `${uid("f5l4_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.CLIENT
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Cinco Lote Quatro",
        email: `${uid("f5l4_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Cinco Lote Quatro",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    const adminEmail = env.ADMIN_ALLOWED_EMAILS[0];
    let admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!admin) {
      admin = await prisma.user.create({
        data: {
          name: "Lote Quatro Admin",
          email: adminEmail,
          password: "x",
          phone: `11${Date.now().toString().slice(-9)}9`,
          role: "CLIENT"
        }
      });
    }
    adminId = admin.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.review.deleteMany({ where: { providerId } });
    await prisma.disputeCase.deleteMany({ where: { providerId } });
    await prisma.payment.deleteMany({ where: { booking: { id: { in: bookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [clientId, providerUserId] } } });
    // Frente 12 (segunda camada), Lote 4: NÃO apaga AdminAuditLog daqui —
    // adminId é a conta fixa compartilhada com dezenas de outros arquivos
    // rodando em paralelo; apagar aqui podia derrubar a asserção de outro
    // arquivo concorrente que ainda não tinha lido o próprio registro
    // (mesma classe de risco já reconhecida pra não apagar a conta admin
    // em si). AdminAuditLog é trilha de auditoria — crescimento no banco
    // de teste é aceitável, mesmo raciocínio já usado pra produção.
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("estornar totalmente uma sessão avaliada (cancelPaymentForBooking) recalcula o rating do profissional", async () => {
    const { booking } = await makeCompletedBookingWithReview(5);

    vi.spyOn(PaymentRefund.prototype, "create").mockResolvedValue({ id: 111 } as any);

    await paymentService.cancelPaymentForBooking(booking.id);

    const providerAfter = await prisma.providerProfile.findUniqueOrThrow({ where: { id: providerId } });
    expect(providerAfter.totalReviews).toBe(0);
    expect(providerAfter.averageRating).toBe(0);

    const paymentAfter = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(paymentAfter.status).toBe(PaymentStatus.REFUNDED);
  });

  it("admin resolvendo uma disputa com reembolso total de sessão avaliada recalcula o rating do profissional", async () => {
    const { booking } = await makeCompletedBookingWithReview(1);

    // Segunda review (5 estrelas) de outra sessão, pra confirmar que só a
    // avaliação do booking estornado sai da média, não todas.
    const otherBooking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        priceCents: 10000,
        status: BookingStatus.COMPLETED,
        completedAt: new Date()
      }
    });
    bookingIds.push(otherBooking.id);
    await prisma.review.create({
      data: { bookingId: otherBooking.id, userId: clientId, providerId, rating: 5 }
    });
    await prisma.providerProfile.update({
      where: { id: providerId },
      data: { averageRating: 3, totalReviews: 2 }
    });

    vi.spyOn(PaymentRefund.prototype, "create").mockResolvedValue({ id: 222 } as any);

    const disputeCase = await prisma.disputeCase.create({
      data: {
        type: "CHARGEBACK",
        clientId,
        providerId,
        bookingId: booking.id,
        amountCents: 10000,
        mpPaymentId: `mp_${uid("dispute")}`
      }
    });

    await disputeCaseService.resolveCase(adminId, disputeCase.id, {
      resolution: "REFUNDED",
      amountCents: 10000,
      note: "Reembolso total acordado."
    });

    const providerAfter = await prisma.providerProfile.findUniqueOrThrow({ where: { id: providerId } });
    expect(providerAfter.totalReviews).toBe(1);
    expect(providerAfter.averageRating).toBe(5);
  });
});
