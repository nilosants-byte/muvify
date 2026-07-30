import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BookingStatus, UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { BookingService } from "../src/modules/bookings/services/booking.service";

// Épico de Frentes, Frente 5 (Descoberta, agendamento e agenda), Lote 9:
// (1) cancelar um booking já cancelado continua caindo em "Transição de
//     status inválida." — é esse texto que o catch de handleCancel, no
//     app, usa pra detectar estado obsoleto e mostrar mensagem
//     diferenciada + refetch.
// (2) reportar falta num booking que não está mais CONFIRMED (ou que já
//     foi reportado) usa mensagens distintas — o catch de
//     handleReportNoShow precisa reconhecer as duas.
// (3) listMyBookings devolve noShowReport com contestDeadlineAt pro
//     cliente, dado que o badge de "disputa" da lista depende disso.

const bookingService = new BookingService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const bookingIds: string[] = [];

describe("Frente 5, Lote 9 — mensagens de estado obsoleto e dados de disputa na listagem", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `F5L9_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Cinco Lote Nove",
        email: `${uid("f5l9_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.CLIENT,
        emailVerifiedAt: new Date()
      }
    });
    clientId = client.id;
    await prisma.clientAnamnesis.create({ data: { clientId, status: "COMPLETED", completedAt: new Date() } });

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Cinco Lote Nove",
        email: `${uid("f5l9_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Cinco Lote Nove",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;
  });

  afterAll(async () => {
    await prisma.noShowReport.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [providerUserId, clientId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [providerUserId, clientId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("cancelar um booking já cancelado retorna 'Transição de status inválida.'", async () => {
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        priceCents: 10000,
        status: BookingStatus.CANCELLED
      }
    });
    bookingIds.push(booking.id);

    let caughtMessage = "";
    try {
      await bookingService.updateStatus(clientId, booking.id, BookingStatus.CANCELLED);
    } catch (error) {
      caughtMessage = error instanceof Error ? error.message : String(error);
    }
    expect(caughtMessage).toBe("Transição de status inválida.");
  });

  it("reportar falta num booking que não está CONFIRMED retorna 'Apenas agendamentos confirmados podem ser reportados.'", async () => {
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 60 * 60 * 1000),
        priceCents: 10000,
        status: BookingStatus.PENDING
      }
    });
    bookingIds.push(booking.id);

    let caughtMessage = "";
    try {
      await bookingService.reportNoShow(clientId, booking.id);
    } catch (error) {
      caughtMessage = error instanceof Error ? error.message : String(error);
    }
    expect(caughtMessage).toBe("Apenas agendamentos confirmados podem ser reportados.");
  });

  it("duas tentativas concorrentes de reportar falta no mesmo booking: uma vence, a outra retorna 'Este agendamento já foi reportado.'", async () => {
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 60 * 60 * 1000),
        priceCents: 10000,
        status: BookingStatus.CONFIRMED
      }
    });
    bookingIds.push(booking.id);

    // A checagem de status (CONFIRMED) roda fora da transação — só a
    // checagem de "já existe report" roda dentro dela. Chamando os dois
    // reportes ao mesmo tempo (em vez de sequencialmente), ambos passam
    // pela checagem de status antes de qualquer um commitar, reproduzindo
    // a corrida real que a mensagem "já foi reportado" protege.
    const results = await Promise.allSettled([
      bookingService.reportNoShow(clientId, booking.id),
      bookingService.reportNoShow(providerUserId, booking.id)
    ]);

    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason?.message).toBe("Este agendamento já foi reportado.");
  });

  it("listMyBookings do cliente inclui noShowReport com contestDeadlineAt (dado que o badge de disputa da lista precisa)", async () => {
    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 60 * 60 * 1000),
        priceCents: 10000,
        status: BookingStatus.CONFIRMED
      }
    });
    bookingIds.push(booking.id);

    await bookingService.reportNoShow(providerUserId, booking.id);

    const bookings = await bookingService.listMyBookings(clientId);
    const found = bookings.find((b: any) => b.id === booking.id) as any;
    expect(found).toBeTruthy();
    expect(found.status).toBe(BookingStatus.CANCELLED);
    expect(found.noShowReport).toBeTruthy();
    expect(found.noShowReport.status).toBe("PENDING");
    expect(found.noShowReport.reportedUserId).toBe(clientId);
    expect(new Date(found.noShowReport.contestDeadlineAt).getTime()).toBeGreaterThan(Date.now());
  });
});
