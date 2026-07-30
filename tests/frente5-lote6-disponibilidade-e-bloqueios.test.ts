import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import { BookingStatus, UserRole } from "@prisma/client";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { AvailabilityService } from "../src/modules/availability/services/availability.service";
import { createManualBlockSchema } from "../src/modules/providers/manual-blocks/validators/manual-block.validator";

// Épico de Frentes, Frente 5 (Descoberta, agendamento e agenda), Lote 6:
// (1) excluir disponibilidade recorrente com agendamento futuro marcado
//     dentro do horário avisa (409) em vez de excluir silenciosamente —
//     só segue com force=true.
// (2) criar bloqueio manual para "hoje" no fim da noite (horário de
//     Brasília) não é rejeitado por causa do UTC já ter virado o dia
//     seguinte.

const availabilityService = new AvailabilityService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerToken = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";

describe("Frente 5, Lote 6 — disponibilidade e bloqueios do profissional", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `F5L6_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Cinco Lote Seis",
        email: `${uid("f5l6_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.CLIENT
      }
    });
    clientId = client.id;

    const reg = await request(app).post("/api/auth/register").send({
      name: "Profissional Frente Cinco Lote Seis",
      email: `${uid("f5l6_provider")}@test.com`,
      password: "Test1234",
      phone: `11${Date.now().toString().slice(-9)}2`,
      role: "PROVIDER",
      termsVersion: "2026.05",
      consentAccepted: true
    });
    providerToken = reg.body.accessToken;
    providerUserId = reg.body.user.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Cinco Lote Seis",
        bio: "test",
        experienceYears: 3,
        priceCents: 10000,
        mpAccountId: "111222333",
        crefValidationStatus: "APPROVED"
      }
    });
    providerId = provider.id;
    await prisma.providerCategory.create({ data: { providerId, categoryId } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { providerId } });
    await prisma.availability.deleteMany({ where: { providerId } });
    await prisma.providerManualBlock.deleteMany({ where: { providerId } });
    await prisma.providerCategory.deleteMany({ where: { providerId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [providerUserId, clientId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [providerUserId, clientId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("remover disponibilidade sem agendamento futuro é imediato, sem aviso", async () => {
    const availability = await prisma.availability.create({
      data: { providerId, weekday: 3, startTime: "08:00", endTime: "12:00", isActive: true }
    });

    await expect(availabilityService.deleteAvailability(providerUserId, availability.id)).resolves.toBeUndefined();

    const stillThere = await prisma.availability.findUnique({ where: { id: availability.id } });
    expect(stillThere).toBeNull();
  });

  it("remover disponibilidade com agendamento futuro dentro do horário avisa (409) e só remove com force", async () => {
    const availability = await prisma.availability.create({
      data: { providerId, weekday: 3, startTime: "08:00", endTime: "12:00", isActive: true }
    });

    // Próxima quarta-feira (weekday 3) às 09:00 — dentro da faixa 08:00-12:00.
    const nextWednesday = new Date();
    const daysUntilWednesday = (3 - nextWednesday.getDay() + 7) % 7 || 7;
    nextWednesday.setDate(nextWednesday.getDate() + daysUntilWednesday);
    nextWednesday.setHours(9, 0, 0, 0);

    const booking = await prisma.booking.create({
      data: {
        clientId,
        providerId,
        categoryId,
        scheduledAt: nextWednesday,
        priceCents: 10000,
        status: BookingStatus.CONFIRMED
      }
    });

    await expect(availabilityService.deleteAvailability(providerUserId, availability.id)).rejects.toThrow(
      /agendamento.*futuro|1 agendamento/i
    );

    const stillActive = await prisma.availability.findUnique({ where: { id: availability.id } });
    expect(stillActive).not.toBeNull();

    await expect(
      availabilityService.deleteAvailability(providerUserId, availability.id, true)
    ).resolves.toBeUndefined();

    const removed = await prisma.availability.findUnique({ where: { id: availability.id } });
    expect(removed).toBeNull();

    await prisma.booking.delete({ where: { id: booking.id } });
  });

  it("valida bloqueio manual para 'hoje' às 22h de Brasília, mesmo já sendo o dia seguinte em UTC", () => {
    // 01:30 UTC do dia seguinte = 22:30 no dia anterior em America/Sao_Paulo (UTC-3).
    const utcInstant = new Date("2026-08-02T01:30:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(utcInstant);

    const result = createManualBlockSchema.safeParse({
      body: { date: "2026-08-01", startTime: "23:00", endTime: "23:59", label: "Teste fuso" }
    });

    expect(result.success).toBe(true);

    // Confirmação de que o bug antigo (UTC puro) teria rejeitado essa mesma data.
    const utcTodayKey = new Date().toISOString().slice(0, 10);
    expect(utcTodayKey).toBe("2026-08-02");

    vi.useRealTimers();
  });
});
