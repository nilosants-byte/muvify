import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BookingStatus, PaymentMethod } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { BookingService } from "../src/modules/bookings/services/booking.service";
import { ManualBlockService } from "../src/modules/providers/manual-blocks/services/manual-block.service";
import { ProviderService } from "../src/modules/providers/services/provider.service";
import { sessionOverlapsRange } from "../src/shared/utils/time-range";

// Mesmo padrão de manual-block.service.ts (toDateKeyInTimezone): usar
// .toISOString().slice(0,10) pra achar "a data" de um Date é UTC puro e
// diverge do dia em horário de Brasília durante boa parte da noite.
function dateKeyInAppTimezone(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: env.APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

// Frente 4 (segunda camada) — gestão de alunos. Cobre os dois achados
// técnicos centrais: (1) sobreposição de horário por duração faltava em
// bloqueio manual x agendamento, nos dois sentidos; (2) escrita de
// avaliação física não respeitava a mesma janela de retenção de dado de
// saúde que a leitura já respeitava, podendo apagar histórico real de um
// aluno "antigo" por engano.

describe("sessionOverlapsRange (Lote 3) — sobreposição por duração", () => {
  it("sessão que começa antes do bloqueio mas invade seus primeiros minutos conflita", () => {
    // sessão de 60min às 10:15 termina 11:15; bloqueio 11:00-12:00.
    expect(sessionOverlapsRange("10:15", 60, "11:00", "12:00")).toBe(true);
  });

  it("sessão que começaria dentro de um bloqueio já existente conflita", () => {
    expect(sessionOverlapsRange("11:30", 60, "11:00", "12:00")).toBe(true);
  });

  it("sessão encostada (termina exatamente quando o bloqueio começa) não conflita", () => {
    expect(sessionOverlapsRange("10:00", 60, "11:00", "12:00")).toBe(false);
  });

  it("sessão bem depois do bloqueio não conflita", () => {
    expect(sessionOverlapsRange("13:00", 60, "11:00", "12:00")).toBe(false);
  });
});

const bookingService = new BookingService();
const manualBlockService = new ManualBlockService();
const providerService = new ProviderService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const bookingIds: string[] = [];
const manualBlockIds: string[] = [];
const extraClientIds: string[] = [];

describe("Frente 4 (segunda camada) — gestão de alunos (backend)", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({
      data: { name: `F4_${Date.now()}`, description: "test" }
    });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Frente4 Cliente",
        email: `${uid("f4_client")}@test.com`,
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
        name: "Frente4 Profissional",
        email: `${uid("f4_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: "PROVIDER"
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Frente4 Profissional",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        crefValidationStatus: "APPROVED",
        minBookingNoticeHours: 1,
        sessionDurationMinutes: 60
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
    await prisma.providerStudentAssessment.deleteMany({ where: { providerId } });
    await prisma.providerManualBlock.deleteMany({ where: { id: { in: manualBlockIds } } });
    await prisma.payment.deleteMany({ where: { booking: { id: { in: bookingIds } } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.availability.deleteMany({ where: { providerId } });
    await prisma.providerCategory.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.clientAnamnesis.deleteMany({ where: { clientId: { in: extraClientIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: [clientId, providerUserId, ...extraClientIds] } } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId, ...extraClientIds] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("Lote 3: criar bloqueio manual é rejeitado se invade uma sessão de 60min já confirmada", async () => {
    const scheduled = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    scheduled.setHours(10, 15, 0, 0);
    const booking = await bookingService.create(
      clientId, providerId, categoryId, scheduled.toISOString(), undefined, PaymentMethod.CREDIT_CARD
    );
    bookingIds.push(booking.id);

    const dateKey = dateKeyInAppTimezone(scheduled);
    // Sessão 10:15-11:15; bloqueio pedido 11:00-12:00 invade os últimos 15min da sessão.
    await expect(
      manualBlockService.create(providerUserId, { date: dateKey, startTime: "11:00", endTime: "12:00", label: "Teste" })
    ).rejects.toThrow(/já existe um agendamento/i);
  });

  it("Lote 3: criar agendamento é rejeitado se sua duração invade um bloqueio manual existente", async () => {
    const day = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
    const dateKey = dateKeyInAppTimezone(day);
    const block = await manualBlockService.create(providerUserId, {
      date: dateKey, startTime: "11:00", endTime: "12:00", label: "Compromisso"
    });
    manualBlockIds.push(block.id);

    // Sessão de 60min às 10:30 termina 11:30 — invade os primeiros 30min do bloqueio.
    const scheduled = new Date(day);
    scheduled.setHours(10, 30, 0, 0);
    await expect(
      bookingService.create(clientId, providerId, categoryId, scheduled.toISOString(), undefined, PaymentMethod.CREDIT_CARD)
    ).rejects.toThrow(/bloqueado/i);
  });

  it("Lote 1: escrita de avaliação física é bloqueada quando o vínculo com o aluno é antigo (>365 dias)", async () => {
    // Cliente dedicado (não o `clientId` compartilhado com os testes de
    // Lote 3 acima) — evita que um booking PENDING/CONFIRMED deixado por
    // outro teste satisfaça hasRecentHealthDataAccess independentemente do
    // vínculo antigo que este teste especificamente quer exercitar.
    const oldLinkClient = await prisma.user.create({
      data: {
        name: "Frente4 Cliente Vinculo Antigo",
        email: `${uid("f4_client_old")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}3`,
        role: "CLIENT",
        emailVerifiedAt: new Date()
      }
    });
    await prisma.clientAnamnesis.create({
      data: { clientId: oldLinkClient.id, status: "COMPLETED", completedAt: new Date() }
    });

    const oldBooking = await prisma.booking.create({
      data: {
        clientId: oldLinkClient.id,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
        priceCents: 10000,
        status: BookingStatus.COMPLETED,
        completedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000)
      }
    });
    bookingIds.push(oldBooking.id);
    extraClientIds.push(oldLinkClient.id);

    await expect(
      providerService.upsertStudentPhysicalAssessment(providerUserId, oldLinkClient.id, { weight: "80" })
    ).rejects.toThrow(/janela de retenção/i);

    const saved = await prisma.providerStudentAssessment.findUnique({
      where: { providerId_clientId: { providerId, clientId: oldLinkClient.id } }
    });
    expect(saved).toBeNull();
  });

  it("Lote 1: escrita de avaliação física funciona normalmente quando o vínculo é recente", async () => {
    const recentBooking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        priceCents: 10000,
        status: BookingStatus.COMPLETED,
        completedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      }
    });
    bookingIds.push(recentBooking.id);

    const saved = await providerService.upsertStudentPhysicalAssessment(providerUserId, clientId, { weight: "80" });
    expect(saved.weight).toBe("80");
  });
});
