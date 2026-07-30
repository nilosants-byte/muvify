import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { Payment } from "mercadopago";
import { BookingStatus, PaymentStatus, UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { AdminService } from "../src/modules/admin/services/admin.service";
import { UserService } from "../src/modules/users/services/user.service";
import { BookingService } from "../src/modules/bookings/services/booking.service";
import { env } from "../src/config/env";
import { hashValue } from "../src/shared/utils/hash";

// Épico de Frentes, Frente 5 (Descoberta, agendamento e agenda), Lote 2:
// (1) suspender/excluir a conta do profissional agora cancela e reembolsa
//     agendamentos avulsos ativos (sem packageId), mesmo tratamento já dado
//     a pacotes/consultorias.
// (2) /bookings/me sempre inclui os agendamentos PENDING/CONFIRMED, mesmo
//     quando o histórico (concluído/cancelado) da conta ultrapassa o
//     limite de paginação.

const adminService = new AdminService();
const userService = new UserService();
const bookingService = new BookingService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let categoryId = "";
let adminId = "";
const userIdsToCleanup: string[] = [];
const providerIdsToCleanup: string[] = [];

async function createProvider(prefix: string) {
  const providerUser = await prisma.user.create({
    data: {
      name: `${prefix} Provider`,
      email: `${uid(prefix)}@test.com`,
      password: await hashValue("Test1234"),
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
      role: UserRole.PROVIDER
    }
  });
  const provider = await prisma.providerProfile.create({
    data: {
      userId: providerUser.id,
      displayName: `${prefix} Provider`,
      bio: "test",
      experienceYears: 3,
      priceCents: 10000,
      mpAccountId: `mp_${uid(prefix)}`,
      crefValidationStatus: "APPROVED"
    }
  });
  return { providerUserId: providerUser.id, providerId: provider.id };
}

async function createClient(prefix: string) {
  const client = await prisma.user.create({
    data: {
      name: `${prefix} Client`,
      email: `${uid(prefix)}@test.com`,
      password: "x",
      phone: `11${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`,
      role: UserRole.CLIENT
    }
  });
  return client.id;
}

describe("Frente 5, Lote 2 — booking avulso sem rede de segurança + paginação de /bookings/me", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const category = await prisma.serviceCategory.create({ data: { name: `F5L2_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const adminEmail = env.ADMIN_ALLOWED_EMAILS[0];
    let admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!admin) {
      admin = await prisma.user.create({
        data: {
          name: "Lote Dois Admin",
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
    await prisma.booking.deleteMany({ where: { providerId: { in: providerIdsToCleanup } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIdsToCleanup } } });
    await prisma.userNotification.deleteMany({ where: { userId: { in: userIdsToCleanup } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIdsToCleanup } } });
    await prisma.adminAuditLog.deleteMany({ where: { adminId } });
    await prisma.user.deleteMany({ where: { id: { in: userIdsToCleanup } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("suspender o profissional cancela e reembolsa um agendamento avulso ativo, e notifica o cliente", async () => {
    const { providerUserId, providerId } = await createProvider("l5l2_susp");
    userIdsToCleanup.push(providerUserId);
    providerIdsToCleanup.push(providerId);
    const clientId = await createClient("l5l2_susp_client");
    userIdsToCleanup.push(clientId);

    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        priceCents: 10000,
        status: BookingStatus.CONFIRMED
      }
    });
    await prisma.payment.create({
      data: {
        bookingId: booking.id,
        method: "CREDIT_CARD",
        status: PaymentStatus.AUTHORIZED,
        amountCents: 10000,
        currency: "BRL",
        mpPaymentId: "mp_pay_l5l2"
      }
    });

    vi.spyOn(Payment.prototype, "cancel").mockResolvedValue({} as any);

    await adminService.suspendUser(adminId, providerUserId, "Fraude confirmada — cascata de cancelamento de booking avulso.");

    const bookingAfter = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(bookingAfter.status).toBe(BookingStatus.CANCELLED);

    const paymentAfter = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(paymentAfter.status).toBe(PaymentStatus.CANCELED);

    const notification = await prisma.userNotification.findFirst({
      where: { userId: clientId, data: { path: ["type"], equals: "BOOKING_CANCELLED_PROVIDER_UNAVAILABLE" } }
    });
    expect(notification).toBeTruthy();
  });

  it("excluir a conta do profissional cancela um agendamento avulso ativo", async () => {
    const { providerUserId, providerId } = await createProvider("l5l2_del");
    userIdsToCleanup.push(providerUserId);
    providerIdsToCleanup.push(providerId);
    const clientId = await createClient("l5l2_del_client");
    userIdsToCleanup.push(clientId);

    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        priceCents: 8000,
        status: BookingStatus.PENDING
      }
    });

    const rawPassword = "Test1234";
    await prisma.user.update({ where: { id: providerUserId }, data: { password: await hashValue(rawPassword) } });
    await userService.deleteMe(providerUserId, rawPassword);

    const bookingAfter = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(bookingAfter.status).toBe(BookingStatus.CANCELLED);
  });

  it("/bookings/me sempre inclui agendamentos PENDING/CONFIRMED mesmo com histórico maior que o limite de paginação", async () => {
    const { providerUserId, providerId } = await createProvider("l5l2_page");
    userIdsToCleanup.push(providerUserId);
    providerIdsToCleanup.push(providerId);
    const clientId = await createClient("l5l2_page_client");
    userIdsToCleanup.push(clientId);

    const historyCount = 55;
    for (let i = 0; i < historyCount; i++) {
      await prisma.booking.create({
        data: {
          clientId,
          providerId,
          categoryId,
          scheduledAt: new Date(Date.now() - (historyCount - i) * 24 * 60 * 60 * 1000),
          priceCents: 5000,
          status: BookingStatus.COMPLETED,
          completedAt: new Date(Date.now() - (historyCount - i) * 24 * 60 * 60 * 1000)
        }
      });
    }

    const futureBooking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        priceCents: 12000,
        status: BookingStatus.CONFIRMED
      }
    });

    const result = await bookingService.listMyBookings(clientId, 0, 50);
    expect(result.some((b: any) => b.id === futureBooking.id)).toBe(true);

    const historyReturned = result.filter((b: any) => b.status === BookingStatus.COMPLETED);
    expect(historyReturned.length).toBe(50);
  });
});
