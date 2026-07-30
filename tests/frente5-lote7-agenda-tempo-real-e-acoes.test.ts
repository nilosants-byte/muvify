import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BookingStatus, UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { BookingService } from "../src/modules/bookings/services/booking.service";

// Épico de Frentes, Frente 5 (Descoberta, agendamento e agenda), Lote 7:
// listMyBookings passa a devolver crefValidationStatus e suspendedAt do
// profissional junto do booking, pra a tela do profissional poder avisar
// (sem bloquear) quando a própria conta está com CREF rejeitado/suspensa
// ao gerenciar um agendamento já existente.

const bookingService = new BookingService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
let bookingId = "";

describe("Frente 5, Lote 7 — dados de CREF/suspensão do profissional expostos no booking", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `F5L7_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Cinco Lote Sete",
        email: `${uid("f5l7_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.CLIENT
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Cinco Lote Sete",
        email: `${uid("f5l7_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Cinco Lote Sete",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;

    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        priceCents: 10000,
        status: BookingStatus.CONFIRMED
      }
    });
    bookingId = booking.id;
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { id: bookingId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [providerUserId, clientId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [providerUserId, clientId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("com o profissional em dia, o booking mostra crefValidationStatus APPROVED e suspendedAt null", async () => {
    const bookings = await bookingService.listMyBookings(providerUserId);
    const found = bookings.find((b: any) => b.id === bookingId) as any;
    expect(found).toBeTruthy();
    expect(found.provider.crefValidationStatus).toBe("APPROVED");
    expect(found.provider.user.suspendedAt).toBeNull();
  });

  it("com CREF rejeitado e conta suspensa, o booking reflete isso no payload", async () => {
    await prisma.providerProfile.update({ where: { id: providerId }, data: { crefValidationStatus: "REJECTED" } });
    await prisma.user.update({ where: { id: providerUserId }, data: { suspendedAt: new Date() } });

    const bookings = await bookingService.listMyBookings(providerUserId);
    const found = bookings.find((b: any) => b.id === bookingId) as any;
    expect(found.provider.crefValidationStatus).toBe("REJECTED");
    expect(found.provider.user.suspendedAt).not.toBeNull();

    await prisma.providerProfile.update({ where: { id: providerId }, data: { crefValidationStatus: "APPROVED" } });
    await prisma.user.update({ where: { id: providerUserId }, data: { suspendedAt: null } });
  });
});
