import { BookingStatus, FinancialExpenseCategory, FinancialStudentType, PaymentStatus, Prisma } from "@prisma/client";
import { platformFeeAmount, providerSplitAmount } from "../../../shared/utils/platform-fee";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const from = new Date(y, m - 1, 1);
  const to = new Date(y, m, 0, 23, 59, 59, 999);
  return { from, to };
}

async function getProviderByUserId(userId: string) {
  const provider = await prisma.providerProfile.findUnique({
    where: { userId },
    select: { id: true }
  });
  if (!provider) throw new AppError("Perfil profissional não encontrado.", StatusCodes.NOT_FOUND);
  return provider;
}

type WeeklyScheduleSlot = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};

type CreateStudentInput = {
  name: string;
  monthlyValueCents: number;
  type: FinancialStudentType;
  weeklyFrequency?: number;
  paymentDueDay?: number;
  notes?: string;
  location?: string;
  weeklySchedule?: WeeklyScheduleSlot[];
};

type UpdateStudentInput = Partial<CreateStudentInput & { isActive: boolean; paymentDueDay: number | null }>;

type CreateIncomeInput = {
  description: string;
  amountCents: number;
  studentId?: string;
  paidAt: string;
};

type UpdateIncomeInput = {
  description?: string;
  amountCents?: number;
  studentId?: string | null;
  paidAt?: string;
};

type CreateExpenseInput = {
  description: string;
  amountCents: number;
  category?: FinancialExpenseCategory;
  paidAt: string;
};

type UpdateExpenseInput = {
  description?: string;
  amountCents?: number;
  category?: FinancialExpenseCategory;
  paidAt?: string;
};

type UpsertGoalInput = {
  month: string;
  targetRevenueCents?: number;
  targetStudents?: number;
  targetWeeklyClasses?: number;
};

type CreateClassSessionInput = {
  studentId?: string;
  date: string;
  notes?: string;
};

export class FinancialService {
  // ─── Dashboard ────────────────────────────────────────────────────────────
  async getDashboard(userId: string, month?: string) {
    const provider = await getProviderByUserId(userId);
    const m = month ?? currentMonth();
    const { from, to } = monthBounds(m);

    const lastMonthFrom = (() => { const [y, mo] = m.split("-").map(Number); return new Date(y, mo - 2, 1); })();
    const lastMonthTo   = (() => { const [y, mo] = m.split("-").map(Number); return new Date(y, mo - 1, 0, 23, 59, 59); })();

    const [
      incomes,
      expenses,
      classSessions,
      activeStudents,
      goal,
      lastMonthIncomes,
      completedBookings,
      confirmedBookingsAgg,
      lastMonthCompletedBookingsAgg
    ] = await Promise.all([
      prisma.financialIncome.findMany({
        where: { providerId: provider.id, paidAt: { gte: from, lte: to } },
        take: 2000,
      }),
      prisma.financialExpense.findMany({
        where: { providerId: provider.id, paidAt: { gte: from, lte: to } },
        take: 2000,
      }),
      prisma.financialClassSession.findMany({
        where: { providerId: provider.id, date: { gte: from, lte: to } },
        take: 2000,
      }),
      prisma.financialStudent.findMany({
        where: { providerId: provider.id, isActive: true },
        take: 2000,
      }),
      prisma.financialGoal.findUnique({
        where: { providerId_month: { providerId: provider.id, month: m } }
      }),
      // mês anterior: receitas manuais
      prisma.financialIncome.findMany({
        where: { providerId: provider.id, paidAt: { gte: lastMonthFrom, lte: lastMonthTo } },
        take: 2000,
      }),
      // agendamentos COMPLETADOS: receita realizada pelo app (com datas para breakdown diário)
      prisma.booking.findMany({
        where: { providerId: provider.id, status: BookingStatus.COMPLETED, scheduledAt: { gte: from, lte: to } },
        select: { priceCents: true, scheduledAt: true },
        take: 2000,
      }),
      // agendamentos CONFIRMADOS: receita prevista (ainda não realizada)
      prisma.booking.aggregate({
        where: { providerId: provider.id, status: BookingStatus.CONFIRMED, scheduledAt: { gte: from, lte: to } },
        _sum: { priceCents: true }
      }),
      // mês anterior: agendamentos completados pelo app
      prisma.booking.aggregate({
        where: { providerId: provider.id, status: BookingStatus.COMPLETED, scheduledAt: { gte: lastMonthFrom, lte: lastMonthTo } },
        _sum: { priceCents: true }
      })
    ]);

    const appRevenueCents            = completedBookings.reduce((s, b) => s + b.priceCents, 0);
    const confirmedRevenueCents      = confirmedBookingsAgg._sum.priceCents ?? 0;
    const manualRevenueCents         = incomes.reduce((s, i) => s + i.amountCents, 0);
    const totalRevenueCents          = manualRevenueCents + appRevenueCents;
    const totalExpensesCents         = expenses.reduce((s, e) => s + e.amountCents, 0);
    const netProfitCents             = totalRevenueCents - totalExpensesCents;

    const lastMonthManualRevenue     = lastMonthIncomes.reduce((s, i) => s + i.amountCents, 0);
    const lastMonthAppRevenue        = lastMonthCompletedBookingsAgg._sum.priceCents ?? 0;
    const lastMonthTotalRevenueCents = lastMonthManualRevenue + lastMonthAppRevenue;
    const growthPct =
      lastMonthTotalRevenueCents === 0
        ? null
        : Math.round(((totalRevenueCents - lastMonthTotalRevenueCents) / lastMonthTotalRevenueCents) * 100);

    const daysInMonth = to.getDate();
    const avgClassesPerDay = classSessions.length / daysInMonth;

    const ticketMedio =
      activeStudents.length > 0
        ? Math.round(totalRevenueCents / activeStudents.length)
        : 0;

    // Weekly classes count (current week)
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    const weeklyClasses = classSessions.filter(
      (s) => s.date >= weekStart && s.date <= weekEnd
    ).length;

    // Breakdown diário: receitas manuais + agendamentos completados
    const dailyMap: Record<string, number> = {};
    for (const inc of incomes) {
      const day = inc.paidAt.toISOString().slice(0, 10);
      dailyMap[day] = (dailyMap[day] ?? 0) + inc.amountCents;
    }
    for (const b of completedBookings) {
      const day = b.scheduledAt.toISOString().slice(0, 10);
      dailyMap[day] = (dailyMap[day] ?? 0) + b.priceCents;
    }

    return {
      month: m,
      totalRevenueCents,
      appRevenueCents,
      confirmedRevenueCents,
      totalExpensesCents,
      netProfitCents,
      growthPct,
      activeStudents: activeStudents.length,
      totalClassesThisMonth: classSessions.length,
      avgClassesPerDay: Math.round(avgClassesPerDay * 10) / 10,
      weeklyClasses,
      ticketMedioCents: ticketMedio,
      goal: goal ?? null,
      dailyRevenue: dailyMap
    };
  }

  // ─── Students ─────────────────────────────────────────────────────────────
  async listStudents(userId: string) {
    const provider = await getProviderByUserId(userId);
    return prisma.financialStudent.findMany({
      where: { providerId: provider.id },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      take: 500,
    });
  }

  async createStudent(userId: string, input: CreateStudentInput) {
    const provider = await getProviderByUserId(userId);
    try {
      return await prisma.financialStudent.create({
        data: {
          providerId: provider.id,
          name: input.name.trim(),
          monthlyValueCents: input.monthlyValueCents,
          type: input.type as any,
          weeklyFrequency: input.weeklyFrequency ?? 3,
          paymentDueDay: input.paymentDueDay ?? null,
          notes: input.notes?.trim() ?? null,
          ...(input.location !== undefined ? { location: input.location?.trim() || null } : {}),
          ...(input.weeklySchedule !== undefined ? { weeklySchedule: input.weeklySchedule as any } : {})
        } as any
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError("Já existe um aluno com este nome no seu perfil.", StatusCodes.CONFLICT);
      }
      throw err;
    }
  }

  async updateStudent(userId: string, studentId: string, input: UpdateStudentInput) {
    const provider = await getProviderByUserId(userId);
    const student = await prisma.financialStudent.findUnique({ where: { id: studentId } });
    if (!student || student.providerId !== provider.id) {
      throw new AppError("Aluno não encontrado.", StatusCodes.NOT_FOUND);
    }
    return prisma.financialStudent.update({
      where: { id: studentId },
      data: {
        name: input.name?.trim(),
        monthlyValueCents: input.monthlyValueCents,
        type: input.type as any,
        weeklyFrequency: input.weeklyFrequency,
        isActive: input.isActive,
        ...(input.paymentDueDay !== undefined ? { paymentDueDay: input.paymentDueDay } : {}),
        notes: input.notes?.trim() ?? undefined,
        ...(input.location !== undefined ? { location: input.location?.trim() || null } : {}),
        ...(input.weeklySchedule !== undefined ? { weeklySchedule: input.weeklySchedule } : {})
      } as any
    });
  }

  async deleteStudent(userId: string, studentId: string) {
    const provider = await getProviderByUserId(userId);
    const student = await prisma.financialStudent.findUnique({ where: { id: studentId } });
    if (!student || student.providerId !== provider.id) {
      throw new AppError("Aluno não encontrado.", StatusCodes.NOT_FOUND);
    }
    await prisma.financialStudent.delete({ where: { id: studentId } });
  }

  // ─── Incomes ──────────────────────────────────────────────────────────────
  async listIncomes(userId: string, month?: string) {
    const provider = await getProviderByUserId(userId);
    const m = month ?? currentMonth();
    const { from, to } = monthBounds(m);
    return prisma.financialIncome.findMany({
      where: { providerId: provider.id, paidAt: { gte: from, lte: to } },
      include: { student: { select: { id: true, name: true } } },
      orderBy: { paidAt: "desc" }
    });
  }

  async createIncome(userId: string, input: CreateIncomeInput) {
    const provider = await getProviderByUserId(userId);
    if (input.studentId) {
      const s = await prisma.financialStudent.findUnique({ where: { id: input.studentId } });
      if (!s || s.providerId !== provider.id) throw new AppError("Aluno não encontrado.", StatusCodes.BAD_REQUEST);
    }
    return prisma.financialIncome.create({
      data: {
        providerId: provider.id,
        description: input.description.trim(),
        amountCents: input.amountCents,
        studentId: input.studentId ?? null,
        source: "MANUAL",
        paidAt: new Date(input.paidAt)
      },
      include: { student: { select: { id: true, name: true } } }
    });
  }

  async updateIncome(userId: string, incomeId: string, input: UpdateIncomeInput) {
    const provider = await getProviderByUserId(userId);
    const income = await prisma.financialIncome.findUnique({ where: { id: incomeId } });
    if (!income || income.providerId !== provider.id) throw new AppError("Receita não encontrada.", StatusCodes.NOT_FOUND);
    if (input.studentId) {
      const s = await prisma.financialStudent.findUnique({ where: { id: input.studentId } });
      if (!s || s.providerId !== provider.id) throw new AppError("Aluno não encontrado.", StatusCodes.BAD_REQUEST);
    }
    return prisma.financialIncome.update({
      where: { id: incomeId },
      data: {
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.amountCents !== undefined ? { amountCents: input.amountCents } : {}),
        ...(input.studentId !== undefined ? { studentId: input.studentId } : {}),
        ...(input.paidAt !== undefined ? { paidAt: new Date(input.paidAt) } : {}),
      },
      include: { student: { select: { id: true, name: true } } }
    });
  }

  async deleteIncome(userId: string, incomeId: string) {
    const provider = await getProviderByUserId(userId);
    const income = await prisma.financialIncome.findUnique({ where: { id: incomeId } });
    if (!income || income.providerId !== provider.id) throw new AppError("Receita não encontrada.", StatusCodes.NOT_FOUND);
    await prisma.financialIncome.delete({ where: { id: incomeId } });
  }

  // ─── Expenses ─────────────────────────────────────────────────────────────
  async listExpenses(userId: string, month?: string) {
    const provider = await getProviderByUserId(userId);
    const m = month ?? currentMonth();
    const { from, to } = monthBounds(m);
    return prisma.financialExpense.findMany({
      where: { providerId: provider.id, paidAt: { gte: from, lte: to } },
      orderBy: { paidAt: "desc" }
    });
  }

  async createExpense(userId: string, input: CreateExpenseInput) {
    const provider = await getProviderByUserId(userId);
    return prisma.financialExpense.create({
      data: {
        providerId: provider.id,
        description: input.description.trim(),
        amountCents: input.amountCents,
        category: input.category ?? FinancialExpenseCategory.OTHER,
        paidAt: new Date(input.paidAt)
      }
    });
  }

  async updateExpense(userId: string, expenseId: string, input: UpdateExpenseInput) {
    const provider = await getProviderByUserId(userId);
    const expense = await prisma.financialExpense.findUnique({ where: { id: expenseId } });
    if (!expense || expense.providerId !== provider.id) throw new AppError("Despesa não encontrada.", StatusCodes.NOT_FOUND);
    return prisma.financialExpense.update({
      where: { id: expenseId },
      data: {
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.amountCents !== undefined ? { amountCents: input.amountCents } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.paidAt !== undefined ? { paidAt: new Date(input.paidAt) } : {}),
      }
    });
  }

  async deleteExpense(userId: string, expenseId: string) {
    const provider = await getProviderByUserId(userId);
    const expense = await prisma.financialExpense.findUnique({ where: { id: expenseId } });
    if (!expense || expense.providerId !== provider.id) throw new AppError("Despesa não encontrada.", StatusCodes.NOT_FOUND);
    await prisma.financialExpense.delete({ where: { id: expenseId } });
  }

  // ─── Goals ────────────────────────────────────────────────────────────────
  async getGoal(userId: string, month?: string) {
    const provider = await getProviderByUserId(userId);
    const m = month ?? currentMonth();
    return prisma.financialGoal.findUnique({
      where: { providerId_month: { providerId: provider.id, month: m } }
    });
  }

  async upsertGoal(userId: string, input: UpsertGoalInput) {
    const provider = await getProviderByUserId(userId);
    return prisma.financialGoal.upsert({
      where: { providerId_month: { providerId: provider.id, month: input.month } },
      update: {
        targetRevenueCents: input.targetRevenueCents,
        targetStudents: input.targetStudents,
        targetWeeklyClasses: input.targetWeeklyClasses
      },
      create: {
        providerId: provider.id,
        month: input.month,
        targetRevenueCents: input.targetRevenueCents ?? null,
        targetStudents: input.targetStudents ?? null,
        targetWeeklyClasses: input.targetWeeklyClasses ?? null
      }
    });
  }

  // ─── Class Sessions ───────────────────────────────────────────────────────
  async listClassSessions(userId: string, month?: string) {
    const provider = await getProviderByUserId(userId);
    const m = month ?? currentMonth();
    const { from, to } = monthBounds(m);
    return prisma.financialClassSession.findMany({
      where: { providerId: provider.id, date: { gte: from, lte: to } },
      include: { student: { select: { id: true, name: true } } },
      orderBy: { date: "desc" }
    });
  }

  async createClassSession(userId: string, input: CreateClassSessionInput) {
    const provider = await getProviderByUserId(userId);
    if (input.studentId) {
      const s = await prisma.financialStudent.findUnique({ where: { id: input.studentId } });
      if (!s || s.providerId !== provider.id) throw new AppError("Aluno não encontrado.", StatusCodes.BAD_REQUEST);
    }
    return prisma.financialClassSession.create({
      data: {
        providerId: provider.id,
        studentId: input.studentId ?? null,
        date: new Date(input.date),
        notes: input.notes?.trim() ?? null
      },
      include: { student: { select: { id: true, name: true } } }
    });
  }

  async deleteClassSession(userId: string, sessionId: string) {
    const provider = await getProviderByUserId(userId);
    const session = await prisma.financialClassSession.findUnique({ where: { id: sessionId } });
    if (!session || session.providerId !== provider.id) throw new AppError("Aula não encontrada.", StatusCodes.NOT_FOUND);
    await prisma.financialClassSession.delete({ where: { id: sessionId } });
  }

  // ─── App Clients (agendamentos completados + confirmados, agrupados por cliente) ─
  async listAppClients(userId: string, month?: string) {
    const provider = await getProviderByUserId(userId);
    const m = month ?? currentMonth();
    const { from, to } = monthBounds(m);

    const bookings = await prisma.booking.findMany({
      where: {
        providerId: provider.id,
        status: { in: [BookingStatus.COMPLETED, BookingStatus.CONFIRMED] },
        scheduledAt: { gte: from, lte: to }
      },
      include: {
        client:   { select: { id: true, name: true } },
        category: { select: { name: true } }
      },
      orderBy: { scheduledAt: "desc" }
    });

    // Agrupa por clientId — distingue receita realizada (COMPLETED) de prevista (CONFIRMED)
    const grouped = new Map<string, {
      clientId: string;
      name: string;
      completedCents: number;
      confirmedCents: number;
      sessionCount: number;
      confirmedSessionCount: number;
      services: string[];
      latestAt: string;
    }>();

    for (const b of bookings) {
      const key = b.clientId;
      if (!grouped.has(key)) {
        grouped.set(key, {
          clientId: key,
          name: b.client.name,
          completedCents: 0,
          confirmedCents: 0,
          sessionCount: 0,
          confirmedSessionCount: 0,
          services: [],
          latestAt: b.scheduledAt.toISOString()
        });
      }
      const entry = grouped.get(key)!;
      if (b.status === BookingStatus.COMPLETED) {
        entry.completedCents  += b.priceCents;
        entry.sessionCount    += 1;
      } else {
        entry.confirmedCents          += b.priceCents;
        entry.confirmedSessionCount   += 1;
      }
      const svcName = b.category?.name ?? "Serviço";
      if (!entry.services.includes(svcName)) entry.services.push(svcName);
      if (b.scheduledAt.toISOString() > entry.latestAt) entry.latestAt = b.scheduledAt.toISOString();
    }

    return Array.from(grouped.values()).sort((a, b) => {
      // clientes com sessões concluídas primeiro, depois por nome
      if (a.sessionCount > 0 && b.sessionCount === 0) return -1;
      if (a.sessionCount === 0 && b.sessionCount > 0) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  // ─── Reports ──────────────────────────────────────────────────────────────
  async getReport(userId: string, months = 6) {
    const safeMon = Math.min(Math.max(Number.isInteger(months) ? months : 6, 1), 24);
    months = safeMon;
    const provider = await getProviderByUserId(userId);
    const now = new Date();
    const result: Array<{
      month: string;
      revenueCents: number;
      appRevenueCents: number;
      expensesCents: number;
      netCents: number;
      classes: number;
    }> = [];

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const { from, to } = monthBounds(month);

      const [incomes, expenses, classes, appBookings] = await Promise.all([
        prisma.financialIncome.aggregate({
          where: { providerId: provider.id, paidAt: { gte: from, lte: to } },
          _sum: { amountCents: true }
        }),
        prisma.financialExpense.aggregate({
          where: { providerId: provider.id, paidAt: { gte: from, lte: to } },
          _sum: { amountCents: true }
        }),
        prisma.financialClassSession.count({
          where: { providerId: provider.id, date: { gte: from, lte: to } }
        }),
        prisma.booking.aggregate({
          where: { providerId: provider.id, status: BookingStatus.COMPLETED, scheduledAt: { gte: from, lte: to } },
          _sum: { priceCents: true }
        })
      ]);

      const rev    = incomes._sum.amountCents ?? 0;
      const appRev = appBookings._sum.priceCents ?? 0;
      const exp    = expenses._sum.amountCents ?? 0;
      result.push({ month, revenueCents: rev, appRevenueCents: appRev, expensesCents: exp, netCents: rev + appRev - exp, classes });
    }

    const bestMonth = [...result].sort((a, b) => b.revenueCents - a.revenueCents)[0] ?? null;
    const avgRevenue =
      result.length > 0
        ? Math.round(result.reduce((s, r) => s + r.revenueCents, 0) / result.length)
        : 0;

    return { months: result, bestMonth, avgRevenueCents: avgRevenue };
  }

  async getPayouts(userId: string) {
    const provider = await getProviderByUserId(userId);

    const payments = await prisma.payment.findMany({
      where: {
        booking: { providerId: provider.id },
        status: { in: [PaymentStatus.AUTHORIZED, PaymentStatus.CAPTURED] }
      },
      select: {
        id: true,
        bookingId: true,
        amountCents: true,
        providerAmountCents: true,
        platformFeeCents: true,
        method: true,
        status: true,
        capturedAt: true,
        booking: { select: { scheduledAt: true } }
      },
      orderBy: { capturedAt: "desc" },
      take: 50
    });

    const netFor = (p: typeof payments[number]) =>
      p.providerAmountCents ?? providerSplitAmount(p.amountCents);
    const feeFor = (p: typeof payments[number]) =>
      p.platformFeeCents ?? platformFeeAmount(p.amountCents);

    const pending  = payments.filter(p => p.status === PaymentStatus.AUTHORIZED);
    const captured = payments.filter(p => p.status === PaymentStatus.CAPTURED);

    return {
      pendingCents:   pending.reduce((s, p)  => s + netFor(p), 0),
      availableCents: captured.reduce((s, p) => s + netFor(p), 0),
      payments: payments.map(p => ({
        bookingId:           p.bookingId,
        amountCents:         p.amountCents,
        providerAmountCents: netFor(p),
        platformFeeCents:    feeFor(p),
        method:              p.method,
        status:              p.status,
        capturedAt:          p.capturedAt?.toISOString() ?? null,
        scheduledAt:         p.booking.scheduledAt.toISOString()
      }))
    };
  }
}
