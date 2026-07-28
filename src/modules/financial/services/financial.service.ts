import {
  BookingStatus,
  ConsultancyPaymentStatus,
  FinancialExpenseCategory,
  FinancialRecurrence,
  FinancialStudentType,
  PaymentStatus,
  Prisma,
  ServiceOfferKind
} from "@prisma/client";
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

function consultancyKindLabel(kind: ServiceOfferKind): string {
  if (kind === ServiceOfferKind.ONLINE_CONSULTANCY) return "Consultoria online";
  if (kind === ServiceOfferKind.ONLINE_CONSULTANCY_SPECIALIZED) return "Consultoria personalizada";
  if (kind === ServiceOfferKind.COMBO) return "Combo (presencial + consultoria)";
  return "Consultoria online";
}

function monthKeyOf(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// Projeta a data de um lançamento recorrente pro mês-alvo, mantendo o dia
// (e "clampando" pro último dia do mês quando o mês-alvo for mais curto).
function clampDayToMonth(date: Date, month: string) {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const day = Math.min(date.getDate(), lastDay);
  return new Date(y, m - 1, day, date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
}

// Último instante do mês anterior a `month` — usado como corte de uma série
// recorrente que está sendo "dividida" (ver updateIncome/updateExpense).
function endOfMonthBefore(month: string) {
  const { from } = monthBounds(month);
  return new Date(from.getFullYear(), from.getMonth(), 0, 23, 59, 59, 999);
}

// Um aluno "cobra" no mês-alvo se: está ativo, e (a) é avulso e o mês-alvo é
// o mês em que ele começou, ou (b) é recorrente, já começou e (se tiver data
// de término) ainda não passou dela.
function isStudentBillableForMonth(
  student: { isActive: boolean; recurrence: FinancialRecurrence; startDate: Date; recurrenceEndDate: Date | null },
  month: string
) {
  if (!student.isActive) return false;
  const { from, to } = monthBounds(month);
  if (student.recurrence === FinancialRecurrence.ONE_TIME) {
    return monthKeyOf(student.startDate) === month;
  }
  if (student.startDate > to) return false;
  if (student.recurrenceEndDate && student.recurrenceEndDate < from) return false;
  return true;
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
  recurrence?: FinancialRecurrence;
  startDate?: string;
  recurrenceEndDate?: string | null;
};

type UpdateStudentInput = Partial<CreateStudentInput & { isActive: boolean; paymentDueDay: number | null }>;

type CreateIncomeInput = {
  description: string;
  amountCents: number;
  studentId?: string;
  paidAt: string;
  recurrence?: FinancialRecurrence;
  recurrenceEndDate?: string | null;
};

type UpdateIncomeInput = {
  description?: string;
  amountCents?: number;
  studentId?: string | null;
  paidAt?: string;
  recurrence?: FinancialRecurrence;
  recurrenceEndDate?: string | null;
  /** mês (YYYY-MM) da ocorrência que o usuário está editando na tela — usado
   *  só para lançamentos recorrentes, pra saber se a edição é na âncora
   *  (edição normal) ou numa projeção futura (precisa "dividir a série"). */
  occurrenceMonth?: string;
};

type CreateExpenseInput = {
  description: string;
  amountCents: number;
  category?: FinancialExpenseCategory;
  paidAt: string;
  recurrence?: FinancialRecurrence;
  recurrenceEndDate?: string | null;
};

type UpdateExpenseInput = {
  description?: string;
  amountCents?: number;
  category?: FinancialExpenseCategory;
  paidAt?: string;
  recurrence?: FinancialRecurrence;
  recurrenceEndDate?: string | null;
  occurrenceMonth?: string;
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

// Lançamentos "efetivos" de um mês = linhas reais daquele mês + projeções
// virtuais de lançamentos recorrentes criados em meses anteriores (a linha
// real original nunca é duplicada — ela só aparece no mês em que foi criada;
// nos meses seguintes o que aparece é a projeção, com a data ajustada pro
// mesmo dia dentro do novo mês).
async function getEffectiveIncomes(providerId: string, month: string) {
  const { from, to } = monthBounds(month);
  const [real, templates] = await Promise.all([
    prisma.financialIncome.findMany({
      where: { providerId, paidAt: { gte: from, lte: to } },
      include: { student: { select: { id: true, name: true } } },
      take: 2000,
    }),
    prisma.financialIncome.findMany({
      where: {
        providerId,
        recurrence: FinancialRecurrence.RECURRING,
        paidAt: { lt: from },
        OR: [{ recurrenceEndDate: null }, { recurrenceEndDate: { gte: from } }]
      },
      include: { student: { select: { id: true, name: true } } },
      take: 2000,
    })
  ]);
  const virtual = templates.map((t) => ({ ...t, paidAt: clampDayToMonth(t.paidAt, month), isVirtual: true as const }));
  return [...real.map((r) => ({ ...r, isVirtual: false as const })), ...virtual]
    .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime());
}

async function getEffectiveExpenses(providerId: string, month: string) {
  const { from, to } = monthBounds(month);
  const [real, templates] = await Promise.all([
    prisma.financialExpense.findMany({
      where: { providerId, paidAt: { gte: from, lte: to } },
      take: 2000,
    }),
    prisma.financialExpense.findMany({
      where: {
        providerId,
        recurrence: FinancialRecurrence.RECURRING,
        paidAt: { lt: from },
        OR: [{ recurrenceEndDate: null }, { recurrenceEndDate: { gte: from } }]
      },
      take: 2000,
    })
  ]);
  const virtual = templates.map((t) => ({ ...t, paidAt: clampDayToMonth(t.paidAt, month), isVirtual: true as const }));
  return [...real.map((r) => ({ ...r, isVirtual: false as const })), ...virtual]
    .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime());
}

export class FinancialService {
  // ─── Dashboard ────────────────────────────────────────────────────────────
  async getDashboard(userId: string, month?: string) {
    const provider = await getProviderByUserId(userId);
    const m = month ?? currentMonth();
    const { from, to } = monthBounds(m);

    const lastMonthFrom = (() => { const [y, mo] = m.split("-").map(Number); return new Date(y, mo - 2, 1); })();
    const lastMonthTo   = (() => { const [y, mo] = m.split("-").map(Number); return new Date(y, mo - 1, 0, 23, 59, 59); })();

    const lastMonthKey = (() => { const [y, mo] = m.split("-").map(Number); const d = new Date(y, mo - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();

    const [
      incomes,
      expenses,
      classSessions,
      activeStudents,
      goal,
      lastMonthIncomes,
      completedBookings,
      confirmedBookingsAgg,
      lastMonthCompletedBookingsAgg,
      capturedContracts,
      lastMonthCapturedContractsAgg,
      capturedPackageCycles,
      lastMonthCapturedPackageCyclesAgg,
      renewalPlans,
      lastMonthRenewalPlans
    ] = await Promise.all([
      getEffectiveIncomes(provider.id, m),
      getEffectiveExpenses(provider.id, m),
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
      // mês anterior: receitas manuais (real + projeção de recorrentes)
      getEffectiveIncomes(provider.id, lastMonthKey),
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
      }),
      // consultorias com pagamento capturado (receita realizada pelo app, com data para breakdown diário)
      prisma.consultancyContract.findMany({
        where: { providerId: provider.id, paymentStatus: ConsultancyPaymentStatus.CAPTURED, paymentCapturedAt: { gte: from, lte: to } },
        select: { paymentAmountCents: true, paymentCapturedAt: true },
        take: 2000,
      }),
      // mês anterior: consultorias com pagamento capturado
      prisma.consultancyContract.aggregate({
        where: { providerId: provider.id, paymentStatus: ConsultancyPaymentStatus.CAPTURED, paymentCapturedAt: { gte: lastMonthFrom, lte: lastMonthTo } },
        _sum: { paymentAmountCents: true }
      }),
      // ciclos de pacote presencial capturados (receita real - nunca o valor
      // total do pacote, so o que de fato foi cobrado), com data para breakdown diário
      prisma.presentialPackageCycle.findMany({
        where: { package: { providerId: provider.id }, capturedAt: { gte: from, lte: to } },
        select: { amountCents: true, capturedAt: true },
        take: 2000,
      }),
      // mês anterior: ciclos de pacote presencial capturados
      prisma.presentialPackageCycle.aggregate({
        where: { package: { providerId: provider.id }, capturedAt: { gte: lastMonthFrom, lte: lastMonthTo } },
        _sum: { amountCents: true }
      }),
      // Raio-X de pagamentos, Rodada 2, Lote 4: renovações de ficha (2ª ficha
      // em diante) cobram de novo, mas a receita nunca aparecia aqui — só a
      // 1ª cobrança do contrato (paymentAmountCents/paymentCapturedAt) era
      // contada. renewalMpPaymentId só é preenchido em renovações de verdade,
      // nunca na 1ª ficha (ver deliverContract).
      prisma.trainingPlan.findMany({
        where: { providerId: provider.id, renewalMpPaymentId: { not: null }, createdAt: { gte: from, lte: to } },
        select: { createdAt: true, contract: { select: { paymentAmountCents: true } } },
        take: 2000
      }),
      // mês anterior: renovações de ficha
      prisma.trainingPlan.findMany({
        where: { providerId: provider.id, renewalMpPaymentId: { not: null }, createdAt: { gte: lastMonthFrom, lte: lastMonthTo } },
        select: { contract: { select: { paymentAmountCents: true } } },
        take: 2000
      })
    ]);

    const appBookingRevenueCents     = completedBookings.reduce((s, b) => s + b.priceCents, 0);
    const appConsultancyRevenueCents = capturedContracts.reduce((s, c) => s + c.paymentAmountCents, 0);
    const appPackageRevenueCents     = capturedPackageCycles.reduce((s, c) => s + (c.amountCents ?? 0), 0);
    const appRenewalRevenueCents     = renewalPlans.reduce((s, p) => s + (p.contract?.paymentAmountCents ?? 0), 0);
    const appRevenueCents            = appBookingRevenueCents + appConsultancyRevenueCents + appPackageRevenueCents + appRenewalRevenueCents;
    const confirmedRevenueCents      = confirmedBookingsAgg._sum.priceCents ?? 0;
    const manualRevenueCents         = incomes.reduce((s, i) => s + i.amountCents, 0);
    const totalRevenueCents          = manualRevenueCents + appRevenueCents;
    const totalExpensesCents         = expenses.reduce((s, e) => s + e.amountCents, 0);
    const netProfitCents             = totalRevenueCents - totalExpensesCents;

    const lastMonthRenewalRevenue    = lastMonthRenewalPlans.reduce((s, p) => s + (p.contract?.paymentAmountCents ?? 0), 0);
    const lastMonthManualRevenue     = lastMonthIncomes.reduce((s, i) => s + i.amountCents, 0);
    const lastMonthAppRevenue        =
      (lastMonthCompletedBookingsAgg._sum.priceCents ?? 0)
      + (lastMonthCapturedContractsAgg._sum.paymentAmountCents ?? 0)
      + (lastMonthCapturedPackageCyclesAgg._sum.amountCents ?? 0)
      + lastMonthRenewalRevenue;
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

    // Breakdown diário: receitas manuais + agendamentos completados + consultorias capturadas
    const dailyMap: Record<string, number> = {};
    for (const inc of incomes) {
      const day = inc.paidAt.toISOString().slice(0, 10);
      dailyMap[day] = (dailyMap[day] ?? 0) + inc.amountCents;
    }
    for (const b of completedBookings) {
      const day = b.scheduledAt.toISOString().slice(0, 10);
      dailyMap[day] = (dailyMap[day] ?? 0) + b.priceCents;
    }
    for (const c of capturedContracts) {
      const day = (c.paymentCapturedAt ?? new Date()).toISOString().slice(0, 10);
      dailyMap[day] = (dailyMap[day] ?? 0) + c.paymentAmountCents;
    }
    for (const cycle of capturedPackageCycles) {
      // capturedAt/amountCents so nulos pros marcadores de periodo do
      // combo cartao+horario fixo (Frente 3b.2) - a propria condicao
      // "capturedAt: { gte, lte }" da query ja exclui esses registros,
      // entao aqui os dois campos estao sempre preenchidos de verdade.
      const day = cycle.capturedAt!.toISOString().slice(0, 10);
      dailyMap[day] = (dailyMap[day] ?? 0) + (cycle.amountCents ?? 0);
    }
    for (const p of renewalPlans) {
      const day = p.createdAt.toISOString().slice(0, 10);
      dailyMap[day] = (dailyMap[day] ?? 0) + (p.contract?.paymentAmountCents ?? 0);
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
    const students = await prisma.financialStudent.findMany({
      where: { providerId: provider.id },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      take: 500,
    });
    const month = currentMonth();
    return students.map((s) => ({ ...s, billableThisMonth: isStudentBillableForMonth(s, month) }));
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
          recurrence: input.recurrence ?? FinancialRecurrence.RECURRING,
          startDate: input.startDate ? new Date(input.startDate) : new Date(),
          recurrenceEndDate: input.recurrenceEndDate ? new Date(input.recurrenceEndDate) : null,
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
        ...(input.recurrence !== undefined ? { recurrence: input.recurrence } : {}),
        ...(input.startDate !== undefined ? { startDate: new Date(input.startDate) } : {}),
        ...(input.recurrenceEndDate !== undefined ? { recurrenceEndDate: input.recurrenceEndDate ? new Date(input.recurrenceEndDate) : null } : {}),
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
    return getEffectiveIncomes(provider.id, m);
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
        paidAt: new Date(input.paidAt),
        recurrence: input.recurrence ?? FinancialRecurrence.ONE_TIME,
        recurrenceEndDate: input.recurrenceEndDate ? new Date(input.recurrenceEndDate) : null
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

    // Editando uma projeção de mês futuro (não a âncora): não dá pra só
    // sobrescrever a linha real, porque ela também é a base de meses já
    // passados — isso mudaria o histórico retroativamente. Em vez disso,
    // "fecha" a série antiga no fim do mês anterior (preserva os valores já
    // registrados) e nasce uma série nova a partir do mês editado.
    const anchorMonth = monthKeyOf(income.paidAt);
    const isSplit = income.recurrence === FinancialRecurrence.RECURRING
      && input.occurrenceMonth !== undefined
      && input.occurrenceMonth !== anchorMonth;

    if (isSplit) {
      const occurrenceMonth = input.occurrenceMonth!;
      await prisma.financialIncome.update({
        where: { id: incomeId },
        data: { recurrenceEndDate: endOfMonthBefore(occurrenceMonth) }
      });
      return prisma.financialIncome.create({
        data: {
          providerId: provider.id,
          studentId: input.studentId !== undefined ? input.studentId : income.studentId,
          description: (input.description ?? income.description).trim(),
          amountCents: input.amountCents ?? income.amountCents,
          source: "MANUAL",
          paidAt: input.paidAt !== undefined ? new Date(input.paidAt) : clampDayToMonth(income.paidAt, occurrenceMonth),
          recurrence: input.recurrence ?? FinancialRecurrence.RECURRING,
          recurrenceEndDate: input.recurrenceEndDate !== undefined ? (input.recurrenceEndDate ? new Date(input.recurrenceEndDate) : null) : income.recurrenceEndDate
        },
        include: { student: { select: { id: true, name: true } } }
      });
    }

    return prisma.financialIncome.update({
      where: { id: incomeId },
      data: {
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.amountCents !== undefined ? { amountCents: input.amountCents } : {}),
        ...(input.studentId !== undefined ? { studentId: input.studentId } : {}),
        ...(input.paidAt !== undefined ? { paidAt: new Date(input.paidAt) } : {}),
        ...(input.recurrence !== undefined ? { recurrence: input.recurrence } : {}),
        ...(input.recurrenceEndDate !== undefined ? { recurrenceEndDate: input.recurrenceEndDate ? new Date(input.recurrenceEndDate) : null } : {}),
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
    return getEffectiveExpenses(provider.id, m);
  }

  async createExpense(userId: string, input: CreateExpenseInput) {
    const provider = await getProviderByUserId(userId);
    return prisma.financialExpense.create({
      data: {
        providerId: provider.id,
        description: input.description.trim(),
        amountCents: input.amountCents,
        category: input.category ?? FinancialExpenseCategory.OTHER,
        paidAt: new Date(input.paidAt),
        recurrence: input.recurrence ?? FinancialRecurrence.ONE_TIME,
        recurrenceEndDate: input.recurrenceEndDate ? new Date(input.recurrenceEndDate) : null
      }
    });
  }

  async updateExpense(userId: string, expenseId: string, input: UpdateExpenseInput) {
    const provider = await getProviderByUserId(userId);
    const expense = await prisma.financialExpense.findUnique({ where: { id: expenseId } });
    if (!expense || expense.providerId !== provider.id) throw new AppError("Despesa não encontrada.", StatusCodes.NOT_FOUND);

    const anchorMonth = monthKeyOf(expense.paidAt);
    const isSplit = expense.recurrence === FinancialRecurrence.RECURRING
      && input.occurrenceMonth !== undefined
      && input.occurrenceMonth !== anchorMonth;

    if (isSplit) {
      const occurrenceMonth = input.occurrenceMonth!;
      await prisma.financialExpense.update({
        where: { id: expenseId },
        data: { recurrenceEndDate: endOfMonthBefore(occurrenceMonth) }
      });
      return prisma.financialExpense.create({
        data: {
          providerId: provider.id,
          description: (input.description ?? expense.description).trim(),
          amountCents: input.amountCents ?? expense.amountCents,
          category: input.category ?? expense.category,
          paidAt: input.paidAt !== undefined ? new Date(input.paidAt) : clampDayToMonth(expense.paidAt, occurrenceMonth),
          recurrence: input.recurrence ?? FinancialRecurrence.RECURRING,
          recurrenceEndDate: input.recurrenceEndDate !== undefined ? (input.recurrenceEndDate ? new Date(input.recurrenceEndDate) : null) : expense.recurrenceEndDate
        }
      });
    }

    return prisma.financialExpense.update({
      where: { id: expenseId },
      data: {
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.amountCents !== undefined ? { amountCents: input.amountCents } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.paidAt !== undefined ? { paidAt: new Date(input.paidAt) } : {}),
        ...(input.recurrence !== undefined ? { recurrence: input.recurrence } : {}),
        ...(input.recurrenceEndDate !== undefined ? { recurrenceEndDate: input.recurrenceEndDate ? new Date(input.recurrenceEndDate) : null } : {}),
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

  // ─── App Clients (agendamentos + consultorias pagas, agrupados por cliente) ─
  async listAppClients(userId: string, month?: string) {
    const provider = await getProviderByUserId(userId);
    const m = month ?? currentMonth();
    const { from, to } = monthBounds(m);

    const [bookings, contracts, packageCycles] = await Promise.all([
      prisma.booking.findMany({
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
      }),
      prisma.consultancyContract.findMany({
        where: {
          providerId: provider.id,
          paymentStatus: ConsultancyPaymentStatus.CAPTURED,
          paymentCapturedAt: { gte: from, lte: to }
        },
        include: {
          client: { select: { id: true, name: true } },
          offer:  { select: { kind: true } }
        },
        orderBy: { paymentCapturedAt: "desc" }
      }),
      // ciclos de pacote presencial capturados no mes - receita real, nao o
      // valor total do pacote (ver comentario no schema de PresentialPackageCycle)
      prisma.presentialPackageCycle.findMany({
        where: { package: { providerId: provider.id }, capturedAt: { gte: from, lte: to } },
        include: { package: { select: { clientId: true, client: { select: { name: true } } } } },
        orderBy: { capturedAt: "desc" }
      })
    ]);

    // Agrupa por clientId — distingue receita realizada (COMPLETED/consultoria capturada) de prevista (CONFIRMED)
    const grouped = new Map<string, {
      clientId: string;
      name: string;
      completedCents: number;
      confirmedCents: number;
      sessionCount: number;
      confirmedSessionCount: number;
      contractCount: number;
      packageCycleCount: number;
      services: string[];
      latestAt: string;
    }>();

    const getEntry = (clientId: string, name: string, atIso: string) => {
      if (!grouped.has(clientId)) {
        grouped.set(clientId, {
          clientId,
          name,
          completedCents: 0,
          confirmedCents: 0,
          sessionCount: 0,
          confirmedSessionCount: 0,
          contractCount: 0,
          packageCycleCount: 0,
          services: [],
          latestAt: atIso
        });
      }
      const entry = grouped.get(clientId)!;
      if (atIso > entry.latestAt) entry.latestAt = atIso;
      return entry;
    };

    for (const b of bookings) {
      const entry = getEntry(b.clientId, b.client.name, b.scheduledAt.toISOString());
      if (b.status === BookingStatus.COMPLETED) {
        entry.completedCents  += b.priceCents;
        entry.sessionCount    += 1;
      } else {
        entry.confirmedCents          += b.priceCents;
        entry.confirmedSessionCount   += 1;
      }
      const svcName = b.category?.name ?? "Serviço";
      if (!entry.services.includes(svcName)) entry.services.push(svcName);
    }

    for (const c of contracts) {
      const capturedAtIso = (c.paymentCapturedAt ?? c.createdAt).toISOString();
      const entry = getEntry(c.clientId, c.client.name, capturedAtIso);
      entry.completedCents += c.paymentAmountCents;
      entry.contractCount  += 1;
      const svcName = consultancyKindLabel(c.offer.kind);
      if (!entry.services.includes(svcName)) entry.services.push(svcName);
    }

    for (const cycle of packageCycles) {
      // capturedAt/amountCents nulos so ocorrem nos marcadores do combo
      // cartao+horario fixo (Frente 3b.2), ja excluidos pelo filtro
      // "capturedAt: { gte, lte }" da query acima.
      const entry = getEntry(cycle.package.clientId, cycle.package.client.name, cycle.capturedAt!.toISOString());
      entry.completedCents   += cycle.amountCents ?? 0;
      entry.packageCycleCount += 1;
      const svcName = "Pacote presencial";
      if (!entry.services.includes(svcName)) entry.services.push(svcName);
    }

    return Array.from(grouped.values()).sort((a, b) => {
      // clientes com receita realizada primeiro, depois por nome
      const aRealized = a.sessionCount > 0 || a.contractCount > 0 || a.packageCycleCount > 0;
      const bRealized = b.sessionCount > 0 || b.contractCount > 0 || b.packageCycleCount > 0;
      if (aRealized && !bRealized) return -1;
      if (!aRealized && bRealized) return 1;
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

      const [incomes, expenses, classes, appBookings, appContracts, appPackageCycles, renewalPlans] = await Promise.all([
        getEffectiveIncomes(provider.id, month),
        getEffectiveExpenses(provider.id, month),
        prisma.financialClassSession.count({
          where: { providerId: provider.id, date: { gte: from, lte: to } }
        }),
        prisma.booking.aggregate({
          where: { providerId: provider.id, status: BookingStatus.COMPLETED, scheduledAt: { gte: from, lte: to } },
          _sum: { priceCents: true }
        }),
        prisma.consultancyContract.aggregate({
          where: { providerId: provider.id, paymentStatus: ConsultancyPaymentStatus.CAPTURED, paymentCapturedAt: { gte: from, lte: to } },
          _sum: { paymentAmountCents: true }
        }),
        prisma.presentialPackageCycle.aggregate({
          where: { package: { providerId: provider.id }, capturedAt: { gte: from, lte: to } },
          _sum: { amountCents: true }
        }),
        // Raio-X de pagamentos, Rodada 3, Lote 4: getReport ficou de fora do
        // conserto que getDashboard/getPayouts já receberam na Rodada 2 —
        // renovações de ficha (2ª ficha em diante) somem do relatório anual.
        prisma.trainingPlan.findMany({
          where: { providerId: provider.id, renewalMpPaymentId: { not: null }, createdAt: { gte: from, lte: to } },
          select: { contract: { select: { paymentAmountCents: true } } },
          take: 2000
        })
      ]);

      const rev       = incomes.reduce((s, i) => s + i.amountCents, 0);
      const renewalRev = renewalPlans.reduce((s, p) => s + (p.contract?.paymentAmountCents ?? 0), 0);
      const appRev =
        (appBookings._sum.priceCents ?? 0)
        + (appContracts._sum.paymentAmountCents ?? 0)
        + (appPackageCycles._sum.amountCents ?? 0)
        + renewalRev;
      const exp    = expenses.reduce((s, e) => s + e.amountCents, 0);
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
    return this.buildPayoutsData(userId, 50);
  }

  // CSV de exportação usa os mesmos dados de getPayouts, só que sem o teto
  // de 50 linhas da tela (Rodada 3, Lote 6).
  async exportTransactionsCsv(userId: string): Promise<string> {
    const data = await this.buildPayoutsData(userId, 2000);
    // Raio-X de pagamentos, Rodada 4, Lote 1: valor_bruto continua sendo o
    // valor original cobrado (fato histórico, nunca muda) — a coluna
    // valor_estornado_cliente fecha a conta completa em caso de estorno
    // parcial: bruto = comissão + líquido + estornado.
    const header = "data,tipo,metodo,status,valor_bruto,comissao_plataforma,valor_liquido,valor_estornado_cliente";
    const typeLabel: Record<string, string> = {
      PRESENTIAL: "Sessão avulsa",
      CONSULTANCY: "Consultoria",
      PRESENTIAL_PACKAGE: "Pacote presencial",
      CONSULTANCY_RENEWAL: "Renovação de ficha"
    };
    const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const rows = data.payments.map((p) => {
      const date = p.capturedAt ?? p.scheduledAt ?? "";
      return [
        escapeCsv(date),
        escapeCsv(typeLabel[p.type] ?? p.type),
        escapeCsv(p.method),
        escapeCsv(p.status),
        (p.amountCents / 100).toFixed(2),
        ((p.platformFeeCents ?? 0) / 100).toFixed(2),
        (p.providerAmountCents / 100).toFixed(2),
        (p.refundedAmountCents / 100).toFixed(2)
      ].join(",");
    });
    return [header, ...rows].join("\n");
  }

  private async buildPayoutsData(userId: string, take: number) {
    const provider = await getProviderByUserId(userId);

    const [payments, contracts, packageCycles, renewalPlans] = await Promise.all([
      prisma.payment.findMany({
        where: {
          booking: { providerId: provider.id },
          // Raio-X de pagamentos, Rodada 3, Lote 4: PARTIALLY_REFUNDED sumia
          // inteiro da lista de repasses — o profissional perdia de vista o
          // valor que ainda tinha direito a receber depois de uma disputa
          // resolvida com estorno parcial.
          status: { in: [PaymentStatus.AUTHORIZED, PaymentStatus.CAPTURED, PaymentStatus.PARTIALLY_REFUNDED] }
        },
        select: {
          id: true,
          bookingId: true,
          amountCents: true,
          providerAmountCents: true,
          platformFeeCents: true,
          refundedAmountCents: true,
          method: true,
          status: true,
          capturedAt: true,
          booking: { select: { scheduledAt: true } }
        },
        orderBy: { capturedAt: "desc" },
        take
      }),
      // consultoria nao tem etapa de pre-autorizacao separada: so entra aqui quando ja capturada
      prisma.consultancyContract.findMany({
        where: {
          providerId: provider.id,
          paymentStatus: ConsultancyPaymentStatus.CAPTURED
        },
        select: {
          id: true,
          paymentAmountCents: true,
          providerAmountCents: true,
          platformAmountCents: true,
          paymentMethod: true,
          paymentCapturedAt: true,
          createdAt: true
        },
        orderBy: { paymentCapturedAt: "desc" },
        take
      }),
      // ciclos de pacote presencial ja tem o split pronto (providerAmountCents/
      // platformAmountCents gravados no instante da captura) - nao recalcula.
      // Exclui os marcadores de periodo do combo cartao+horario fixo (Frente
      // 3b.2, sem valor de pagamento) - o repasse dessas sessoes ja aparece
      // via bookingTransactions, uma por sessao.
      prisma.presentialPackageCycle.findMany({
        where: { package: { providerId: provider.id }, capturedAt: { not: null } },
        select: {
          id: true,
          amountCents: true,
          providerAmountCents: true,
          platformAmountCents: true,
          capturedAt: true,
          package: { select: { paymentMethod: true } }
        },
        orderBy: { capturedAt: "desc" },
        take
      }),
      // Raio-X de pagamentos, Rodada 2, Lote 4: renovações de ficha (2ª ficha
      // em diante) somem da lista de repasses — só a 1ª cobrança do contrato
      // (via contractTransactions acima) aparecia. Cada renovação cobra o
      // mesmo valor do contrato original (ver chargeFichaRenewal), então o
      // split (providerAmountCents/platformAmountCents) do contrato se
      // aplica igual a cada renovação.
      prisma.trainingPlan.findMany({
        where: { providerId: provider.id, renewalMpPaymentId: { not: null } },
        select: {
          id: true,
          createdAt: true,
          renewalMpPaymentId: true,
          contract: {
            select: { paymentAmountCents: true, providerAmountCents: true, platformAmountCents: true, paymentMethod: true }
          }
        },
        orderBy: { createdAt: "desc" },
        take
      })
    ]);

    // Raio-X de pagamentos, Rodada 4, Lote 1: netFor já reduzia o líquido do
    // profissional proporcionalmente ao estorno parcial, mas feeFor
    // continuava devolvendo a comissão cheia — quebrando a identidade
    // bruto − comissão = líquido em toda tela/CSV que mostra os dois lado a
    // lado. As duas agora aplicam a mesma proporção.
    const remainingRatioFor = (p: (typeof payments)[number]) => {
      if (p.status === PaymentStatus.PARTIALLY_REFUNDED && p.refundedAmountCents && p.amountCents > 0) {
        return Math.max(0, (p.amountCents - p.refundedAmountCents) / p.amountCents);
      }
      return 1;
    };
    const netFor = (p: (typeof payments)[number]) => {
      const base = p.providerAmountCents ?? providerSplitAmount(p.amountCents);
      return Math.round(base * remainingRatioFor(p));
    };
    const feeFor = (p: (typeof payments)[number]) => {
      const base = p.platformFeeCents ?? platformFeeAmount(p.amountCents);
      return Math.round(base * remainingRatioFor(p));
    };

    const pending  = payments.filter(p => p.status === PaymentStatus.AUTHORIZED);
    const captured = payments.filter(
      p => p.status === PaymentStatus.CAPTURED || p.status === PaymentStatus.PARTIALLY_REFUNDED
    );

    const bookingTransactions = payments.map(p => ({
      id:                  p.id,
      type:                "PRESENTIAL" as const,
      bookingId:           p.bookingId as string | null,
      amountCents:         p.amountCents,
      providerAmountCents: netFor(p),
      platformFeeCents:    feeFor(p),
      // Estorno parcial: quanto do bruto voltou pro cliente. Junto com o
      // líquido e a comissão (já proporcionais acima), fecha a conta
      // completa: bruto = comissão + líquido + estornado.
      refundedAmountCents: p.status === PaymentStatus.PARTIALLY_REFUNDED ? (p.refundedAmountCents ?? 0) : 0,
      method:              p.method as string,
      status:              p.status as string,
      capturedAt:          p.capturedAt?.toISOString() ?? null,
      scheduledAt:         p.booking.scheduledAt.toISOString() as string | null
    }));

    const contractTransactions = contracts.map(c => ({
      id:                  c.id,
      type:                "CONSULTANCY" as const,
      bookingId:           null as string | null,
      amountCents:         c.paymentAmountCents,
      providerAmountCents: c.providerAmountCents,
      platformFeeCents:    c.platformAmountCents,
      refundedAmountCents: 0,
      method:              (c.paymentMethod ?? "CREDIT_CARD") as string,
      status:              "CAPTURED" as string,
      capturedAt:          (c.paymentCapturedAt ?? c.createdAt).toISOString(),
      scheduledAt:         null as string | null
    }));

    const packageCycleTransactions = packageCycles.map(cycle => ({
      id:                  cycle.id,
      type:                "PRESENTIAL_PACKAGE" as const,
      bookingId:           null as string | null,
      amountCents:         cycle.amountCents ?? 0,
      providerAmountCents: cycle.providerAmountCents ?? 0,
      platformFeeCents:    cycle.platformAmountCents,
      refundedAmountCents: 0,
      method:              (cycle.package.paymentMethod ?? "CREDIT_CARD") as string,
      status:              "CAPTURED" as string,
      capturedAt:          cycle.capturedAt!.toISOString(),
      scheduledAt:         null as string | null
    }));

    const renewalTransactions = renewalPlans
      .filter((plan) => plan.contract)
      .map((plan) => ({
        id:                  plan.id,
        type:                "CONSULTANCY_RENEWAL" as const,
        bookingId:           null as string | null,
        amountCents:         plan.contract!.paymentAmountCents,
        providerAmountCents: plan.contract!.providerAmountCents,
        platformFeeCents:    plan.contract!.platformAmountCents,
        refundedAmountCents: 0,
        method:              (plan.contract!.paymentMethod ?? "CREDIT_CARD") as string,
        status:              "CAPTURED" as string,
        capturedAt:          plan.createdAt.toISOString(),
        scheduledAt:         null as string | null
      }));

    const transactions = [...bookingTransactions, ...contractTransactions, ...packageCycleTransactions, ...renewalTransactions]
      .sort((a, b) => (b.capturedAt ?? "").localeCompare(a.capturedAt ?? ""))
      .slice(0, take);

    return {
      pendingCents:   pending.reduce((s, p)  => s + netFor(p), 0),
      availableCents: captured.reduce((s, p) => s + netFor(p), 0)
        + contracts.reduce((s, c) => s + c.providerAmountCents, 0)
        + packageCycles.reduce((s, c) => s + (c.providerAmountCents ?? 0), 0)
        + renewalTransactions.reduce((s, r) => s + r.providerAmountCents, 0),
      payments: transactions
    };
  }
}
