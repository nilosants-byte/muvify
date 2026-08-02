import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BookingStatus, UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { FinancialService } from "../src/modules/financial/services/financial.service";

// Épico de Frentes, Frente 7 (Tela Financeiro do profissional), Lote 6:
// "Aulas por semana" era alimentada por FinancialClassSession, uma tabela
// que nenhuma tela do app nunca escrevia - a meta ficava sempre em 0%. A
// métrica passa a contar sessões reais já rastreadas pelo app: bookings
// presenciais concluídos + entregas de ficha de consultoria (TrainingPlan).

const financialService = new FinancialService();

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let categoryId = "";
let clientId = "";
let providerUserId = "";
let providerId = "";
const bookingIds: string[] = [];
const trainingPlanIds: string[] = [];

describe("Frente 7, Lote 6 — aulas por semana conta sessões reais, não FinancialClassSession", () => {
  beforeAll(async () => {
    await prisma.$connect();

    const category = await prisma.serviceCategory.create({ data: { name: `F7L6_${Date.now()}`, description: "test" } });
    categoryId = category.id;

    const client = await prisma.user.create({
      data: {
        name: "Cliente Frente Sete Lote Seis",
        email: `${uid("f7l6_client")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}1`,
        role: UserRole.CLIENT
      }
    });
    clientId = client.id;

    const providerUser = await prisma.user.create({
      data: {
        name: "Profissional Frente Sete Lote Seis",
        email: `${uid("f7l6_provider")}@test.com`,
        password: "x",
        phone: `11${Date.now().toString().slice(-9)}2`,
        role: UserRole.PROVIDER
      }
    });
    providerUserId = providerUser.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUserId,
        displayName: "Profissional Frente Sete Lote Seis",
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
    await prisma.trainingPlan.deleteMany({ where: { id: { in: trainingPlanIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.session.deleteMany({ where: { userId: { in: [providerUserId, clientId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [providerUserId, clientId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("weeklyClasses e totalClassesThisMonth contam bookings concluídos + entregas de ficha, não ficam travados em 0", async () => {
    const now = new Date();

    const booking1 = await prisma.booking.create({
      data: { clientId, providerId, categoryId, scheduledAt: now, priceCents: 10000, status: BookingStatus.COMPLETED, completedAt: now }
    });
    bookingIds.push(booking1.id);

    const booking2 = await prisma.booking.create({
      data: { clientId, providerId, categoryId, scheduledAt: now, priceCents: 10000, status: BookingStatus.COMPLETED, completedAt: now }
    });
    bookingIds.push(booking2.id);

    const plan = await prisma.trainingPlan.create({
      data: { providerId, title: "Ficha entregue essa semana" }
    });
    trainingPlanIds.push(plan.id);

    const dashboard = await financialService.getDashboard(providerUserId);

    expect(dashboard.weeklyClasses).toBeGreaterThanOrEqual(3);
    expect(dashboard.totalClassesThisMonth).toBeGreaterThanOrEqual(3);
    expect(dashboard.avgClassesPerDay).toBeGreaterThan(0);
  });

  it("relatório mensal (getReport) também conta sessões reais por mês, não fica travado em 0", async () => {
    const report = await financialService.getReport(providerUserId, 1);
    const thisMonthEntry = report.months[report.months.length - 1];
    expect(thisMonthEntry.classes).toBeGreaterThanOrEqual(3);
  });
});
