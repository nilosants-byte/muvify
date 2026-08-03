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
import { escapeCsv } from "../../../shared/utils/csv";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { env } from "../../../config/env";

// Épico de Frentes, Frente 7, Lote 1: todo o módulo financeiro classificava
// transações por mês/dia usando o fuso do PROCESSO (UTC em produção), nunca
// APP_TIMEZONE — diferente de booking/availability/pacote presencial, que já
// usam esse padrão. Uma transação entre 21h-23h59 (Brasília) no fim do mês
// caía no mês seguinte. Os helpers abaixo leem/constroem datas sempre
// relativas a APP_TIMEZONE, independente do fuso do processo Node.

function getZonedDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    ms: date.getMilliseconds()
  };
}

// Offset (em ms) do fuso em relação a UTC no instante dado. Negativo pra
// fusos atrás de UTC (ex: America/Sao_Paulo = -3h).
function timezoneOffsetMs(instant: Date, timeZone: string) {
  const p = getZonedDateParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - instant.getTime();
}

// Converte um horário de parede (ano/mês/dia/hora... já no fuso `timeZone`)
// no instante UTC correspondente.
function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  timeZone: string
) {
  const naiveUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
  const offsetMs = timezoneOffsetMs(naiveUtc, timeZone);
  return new Date(naiveUtc.getTime() - offsetMs);
}

function zonedMonthKey(date: Date, timeZone: string) {
  const p = getZonedDateParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

function zonedDateKey(date: Date, timeZone: string) {
  const p = getZonedDateParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

// Quantidade de dias de um mês "YYYY-MM" — cálculo de calendário puro, não
// depende de fuso horário.
function daysInMonthOf(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

// Soma/subtrai meses de uma chave "YYYY-MM" — aritmética de calendário pura
// (constrói e lê um Date só com componentes de ano/mês, nunca compara
// instantes absolutos, então o fuso do processo não importa aqui).
function addMonthsToKey(monthKey: string, delta: number) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function currentMonth() {
  return zonedMonthKey(new Date(), env.APP_TIMEZONE);
}

function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const from = zonedTimeToUtc(y, m, 1, 0, 0, 0, 0, env.APP_TIMEZONE);
  const nextMonth = addMonthsToKey(month, 1);
  const [ny, nm] = nextMonth.split("-").map(Number);
  const nextMonthStart = zonedTimeToUtc(ny, nm, 1, 0, 0, 0, 0, env.APP_TIMEZONE);
  const to = new Date(nextMonthStart.getTime() - 1);
  return { from, to };
}

function consultancyKindLabel(kind: ServiceOfferKind): string {
  if (kind === ServiceOfferKind.ONLINE_CONSULTANCY) return "Consultoria online";
  if (kind === ServiceOfferKind.ONLINE_CONSULTANCY_SPECIALIZED) return "Consultoria personalizada";
  if (kind === ServiceOfferKind.COMBO) return "Combo (presencial + consultoria)";
  return "Consultoria online";
}

function monthKeyOf(date: Date) {
  return zonedMonthKey(date, env.APP_TIMEZONE);
}

// Projeta a data de um lançamento recorrente pro mês-alvo, mantendo o dia
// (e "clampando" pro último dia do mês quando o mês-alvo for mais curto).
function clampDayToMonth(date: Date, month: string) {
  const [y, m] = month.split("-").map(Number);
  const lastDay = daysInMonthOf(month);
  const parts = getZonedDateParts(date, env.APP_TIMEZONE);
  const day = Math.min(parts.day, lastDay);
  return zonedTimeToUtc(y, m, day, parts.hour, parts.minute, parts.second, parts.ms, env.APP_TIMEZONE);
}

// Último instante do mês anterior a `month` — usado como corte de uma série
// recorrente que está sendo "dividida" (ver updateIncome/updateExpense).
function endOfMonthBefore(month: string) {
  return new Date(monthBounds(month).from.getTime() - 1);
}

// Épico de Frentes, Frente 7, Lote 4: uma edição/exclusão de recorrência
// nunca pode fazer efeito num mês que já passou - se o mês-alvo (pedido
// explicitamente, ou o próprio mês da âncora quando ninguém pediu outro)
// já é anterior a hoje, o efeito real começa no mês corrente, preservando
// os meses já registrados com os valores antigos. Sem isso, editar ou
// excluir a própria linha-âncora de uma recorrência antiga (em vez de uma
// projeção futura) reescrevia/apagava retroativamente meses já fechados.
function clampToPresentOrLater(month: string) {
  const nowMonth = currentMonth();
  return month < nowMonth ? nowMonth : month;
}

// Épico de Frentes, Frente 7, Lote 2: resolver uma disputa como REFUNDED só
// atualizava o Payment - o booking.status ficava COMPLETED pra sempre, e a
// receita do módulo financeiro era somada direto do priceCents, sem olhar
// se o pagamento tinha sido reembolsado depois (Payment/consultoria já
// tratados; ciclo de pacote e renovação de ficha ganham o mesmo tratamento
// via os campos refundedAt/refundedAmountCents adicionados neste lote).
function effectiveBookingRevenueCents(booking: {
  priceCents: number;
  payment: { status: PaymentStatus; refundedAmountCents: number | null } | null;
}) {
  if (!booking.payment) return booking.priceCents;
  if (booking.payment.status === PaymentStatus.REFUNDED) return 0;
  if (booking.payment.status === PaymentStatus.PARTIALLY_REFUNDED) {
    return Math.max(0, booking.priceCents - (booking.payment.refundedAmountCents ?? 0));
  }
  return booking.priceCents;
}

function effectiveCycleRevenueCents(cycle: { amountCents: number | null; refundedAmountCents: number | null }) {
  return Math.max(0, (cycle.amountCents ?? 0) - (cycle.refundedAmountCents ?? 0));
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
  targetRevenueCents?: number | null;
  targetStudents?: number | null;
  targetWeeklyClasses?: number | null;
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
      orderBy: { paidAt: "desc" },
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
      orderBy: { paidAt: "desc" },
      take: 2000,
    })
  ]);
  // Épico de Frentes, Frente 7, Lote 13: sem orderBy, um `take: 2000` roda
  // sem ordem determinística - se um profissional acumular mais de 2000
  // lançamentos recorrentes de fato, o corte podia descartar registros
  // arbitrários (não necessariamente os mais antigos/irrelevantes).
  const virtual = templates.map((t) => ({ ...t, paidAt: clampDayToMonth(t.paidAt, month), isVirtual: true as const }));
  return [...real.map((r) => ({ ...r, isVirtual: false as const })), ...virtual]
    .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime());
}

async function getEffectiveExpenses(providerId: string, month: string) {
  const { from, to } = monthBounds(month);
  const [real, templates] = await Promise.all([
    prisma.financialExpense.findMany({
      where: { providerId, paidAt: { gte: from, lte: to } },
      orderBy: { paidAt: "desc" },
      take: 2000,
    }),
    prisma.financialExpense.findMany({
      where: {
        providerId,
        recurrence: FinancialRecurrence.RECURRING,
        paidAt: { lt: from },
        OR: [{ recurrenceEndDate: null }, { recurrenceEndDate: { gte: from } }]
      },
      orderBy: { paidAt: "desc" },
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

    const lastMonthKey = addMonthsToKey(m, -1);
    const { from: lastMonthFrom, to: lastMonthTo } = monthBounds(lastMonthKey);

    const [
      incomes,
      expenses,
      consultancyDeliveries,
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
      // Épico de Frentes, Frente 7, Lote 6: "aulas/sessões" do mês passa a
      // contar sessões reais já rastreadas pelo app - presencial concluída
      // (completedBookings, abaixo) + entrega de ficha de consultoria
      // (nenhuma tela do app nunca criou um FinancialClassSession manual,
      // então essa métrica era sempre 0).
      prisma.trainingPlan.findMany({
        where: { providerId: provider.id, createdAt: { gte: from, lte: to } },
        select: { createdAt: true },
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
      // agendamentos COMPLETADOS: receita realizada pelo app (com datas para
      // breakdown diário; payment.status/refundedAmountCents pra descontar
      // sessões reembolsadas depois via disputa - ver effectiveBookingRevenueCents)
      prisma.booking.findMany({
        where: { providerId: provider.id, status: BookingStatus.COMPLETED, scheduledAt: { gte: from, lte: to } },
        select: { priceCents: true, scheduledAt: true, payment: { select: { status: true, refundedAmountCents: true } } },
        take: 2000,
      }),
      // agendamentos CONFIRMADOS: receita prevista (ainda não realizada)
      prisma.booking.aggregate({
        where: { providerId: provider.id, status: BookingStatus.CONFIRMED, scheduledAt: { gte: from, lte: to } },
        _sum: { priceCents: true }
      }),
      // mês anterior: agendamentos completados pelo app
      prisma.booking.findMany({
        where: { providerId: provider.id, status: BookingStatus.COMPLETED, scheduledAt: { gte: lastMonthFrom, lte: lastMonthTo } },
        select: { priceCents: true, payment: { select: { status: true, refundedAmountCents: true } } },
        take: 2000,
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
      // total do pacote, so o que de fato foi cobrado), com data para breakdown
      // diário; refundedAmountCents desconta o que voltou pro cliente via disputa
      prisma.presentialPackageCycle.findMany({
        where: { package: { providerId: provider.id }, capturedAt: { gte: from, lte: to } },
        select: { amountCents: true, capturedAt: true, refundedAmountCents: true },
        take: 2000,
      }),
      // mês anterior: ciclos de pacote presencial capturados
      prisma.presentialPackageCycle.findMany({
        where: { package: { providerId: provider.id }, capturedAt: { gte: lastMonthFrom, lte: lastMonthTo } },
        select: { amountCents: true, refundedAmountCents: true },
        take: 2000,
      }),
      // Raio-X de pagamentos, Rodada 2, Lote 4: renovações de ficha (2ª ficha
      // em diante) cobram de novo, mas a receita nunca aparecia aqui — só a
      // 1ª cobrança do contrato (paymentAmountCents/paymentCapturedAt) era
      // contada. renewalMpPaymentId só é preenchido em renovações de verdade,
      // nunca na 1ª ficha (ver deliverContract). refundedAt exclui renovação
      // contestada e reembolsada via disputa (Frente 7, Lote 2).
      prisma.trainingPlan.findMany({
        where: { providerId: provider.id, renewalMpPaymentId: { not: null }, refundedAt: null, createdAt: { gte: from, lte: to } },
        select: { createdAt: true, contract: { select: { paymentAmountCents: true } } },
        take: 2000
      }),
      // mês anterior: renovações de ficha
      prisma.trainingPlan.findMany({
        where: { providerId: provider.id, renewalMpPaymentId: { not: null }, refundedAt: null, createdAt: { gte: lastMonthFrom, lte: lastMonthTo } },
        select: { contract: { select: { paymentAmountCents: true } } },
        take: 2000
      })
    ]);

    const appBookingRevenueCents     = completedBookings.reduce((s, b) => s + effectiveBookingRevenueCents(b), 0);
    const appConsultancyRevenueCents = capturedContracts.reduce((s, c) => s + c.paymentAmountCents, 0);
    const appPackageRevenueCents     = capturedPackageCycles.reduce((s, c) => s + effectiveCycleRevenueCents(c), 0);
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
      lastMonthCompletedBookingsAgg.reduce((s, b) => s + effectiveBookingRevenueCents(b), 0)
      + (lastMonthCapturedContractsAgg._sum.paymentAmountCents ?? 0)
      + lastMonthCapturedPackageCyclesAgg.reduce((s, c) => s + effectiveCycleRevenueCents(c), 0)
      + lastMonthRenewalRevenue;
    const lastMonthTotalRevenueCents = lastMonthManualRevenue + lastMonthAppRevenue;
    const growthPct =
      lastMonthTotalRevenueCents === 0
        ? null
        : Math.round(((totalRevenueCents - lastMonthTotalRevenueCents) / lastMonthTotalRevenueCents) * 100);

    const daysInMonth = daysInMonthOf(m);
    const totalClasses = completedBookings.length + consultancyDeliveries.length;
    const avgClassesPerDay = totalClasses / daysInMonth;

    // Semana corrente (domingo-sábado) em APP_TIMEZONE - mesmo cuidado de
    // fuso do Lote 1, pra não classificar uma sessão de fim de semana no dia
    // errado quando o processo roda em UTC.
    const nowParts = getZonedDateParts(new Date(), env.APP_TIMEZONE);
    const weekday = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day)).getUTCDay();
    const weekStart = zonedTimeToUtc(nowParts.year, nowParts.month, nowParts.day - weekday, 0, 0, 0, 0, env.APP_TIMEZONE);
    const weekEnd = zonedTimeToUtc(nowParts.year, nowParts.month, nowParts.day - weekday + 6, 23, 59, 59, 999, env.APP_TIMEZONE);
    const weeklyClasses =
      completedBookings.filter((b) => b.scheduledAt >= weekStart && b.scheduledAt <= weekEnd).length
      + consultancyDeliveries.filter((d) => d.createdAt >= weekStart && d.createdAt <= weekEnd).length;

    // Breakdown diário: receitas manuais + agendamentos completados + consultorias capturadas
    const dailyMap: Record<string, number> = {};
    for (const inc of incomes) {
      const day = zonedDateKey(inc.paidAt, env.APP_TIMEZONE);
      dailyMap[day] = (dailyMap[day] ?? 0) + inc.amountCents;
    }
    for (const b of completedBookings) {
      const day = zonedDateKey(b.scheduledAt, env.APP_TIMEZONE);
      dailyMap[day] = (dailyMap[day] ?? 0) + effectiveBookingRevenueCents(b);
    }
    for (const c of capturedContracts) {
      const day = zonedDateKey(c.paymentCapturedAt ?? new Date(), env.APP_TIMEZONE);
      dailyMap[day] = (dailyMap[day] ?? 0) + c.paymentAmountCents;
    }
    for (const cycle of capturedPackageCycles) {
      // capturedAt/amountCents so nulos pros marcadores de periodo do
      // combo cartao+horario fixo (Frente 3b.2) - a propria condicao
      // "capturedAt: { gte, lte }" da query ja exclui esses registros,
      // entao aqui os dois campos estao sempre preenchidos de verdade.
      const day = zonedDateKey(cycle.capturedAt!, env.APP_TIMEZONE);
      dailyMap[day] = (dailyMap[day] ?? 0) + effectiveCycleRevenueCents(cycle);
    }
    for (const p of renewalPlans) {
      const day = zonedDateKey(p.createdAt, env.APP_TIMEZONE);
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
      totalClassesThisMonth: totalClasses,
      avgClassesPerDay: Math.round(avgClassesPerDay * 10) / 10,
      weeklyClasses,
      goal: goal ?? null,
      dailyRevenue: dailyMap
    };
  }

  // ─── Students ─────────────────────────────────────────────────────────────
  async listStudents(userId: string, month?: string) {
    const provider = await getProviderByUserId(userId);
    const students = await prisma.financialStudent.findMany({
      where: { providerId: provider.id },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      take: 500,
    });
    // Épico de Frentes, Frente 7, Lote 11: `billableThisMonth` sempre
    // calculado contra o mês real de hoje, mesmo a tela tendo navegação de
    // mês - status de pendência/atraso mostrado pra um mês passado não
    // correspondia àquele mês.
    const m = month ?? currentMonth();
    return students.map((s) => ({ ...s, billableThisMonth: isStudentBillableForMonth(s, m) }));
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
    // registrados) e nasce uma série nova a partir do mês editado. O mesmo
    // vale, com o clamp de clampToPresentOrLater, quando o profissional edita
    // a própria linha-âncora vendo o mês dela mesma, mas o tempo real já
    // avançou pra depois desse mês (Frente 7, Lote 4).
    const anchorMonth = monthKeyOf(income.paidAt);
    const requestedMonth = input.occurrenceMonth ?? anchorMonth;
    const isSplit = income.recurrence === FinancialRecurrence.RECURRING
      && clampToPresentOrLater(requestedMonth) !== anchorMonth;

    if (isSplit) {
      const occurrenceMonth = clampToPresentOrLater(requestedMonth);
      // Épico de Frentes, Frente 7, Lote 13: fechar a série antiga e criar a
      // nova eram duas chamadas Prisma separadas, sem nenhuma proteção contra
      // duas edições quase simultâneas da mesma âncora - ambas liam o mesmo
      // recurrenceEndDate original e cada uma criava sua própria série nova,
      // duplicando a recorrência. O updateMany condicional (mesmo padrão já
      // usado no fechamento de conexão MP) só fecha a âncora se ela ainda
      // estiver exatamente como foi lida; se outra requisição já mexeu nela
      // nesse meio tempo, aborta em vez de duplicar.
      return prisma.$transaction(async (tx) => {
        const closed = await tx.financialIncome.updateMany({
          where: { id: incomeId, recurrenceEndDate: income.recurrenceEndDate },
          data: { recurrenceEndDate: endOfMonthBefore(occurrenceMonth) }
        });
        if (closed.count === 0) {
          throw new AppError("Este lançamento já foi editado em outra requisição. Recarregue e tente novamente.", StatusCodes.CONFLICT);
        }
        return tx.financialIncome.create({
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

  async deleteIncome(userId: string, incomeId: string, beforeMonth?: string) {
    const provider = await getProviderByUserId(userId);
    const income = await prisma.financialIncome.findUnique({ where: { id: incomeId } });
    if (!income || income.providerId !== provider.id) throw new AppError("Receita não encontrada.", StatusCodes.NOT_FOUND);

    // Épico de Frentes, Frente 7, Lote 4: excluir a própria linha-âncora de
    // uma recorrência com histórico já elapsed apagava a base de TODA a
    // projeção, inclusive meses já acontecidos. Em vez de apagar, encerra a
    // recorrência a partir de agora (ou do mês pedido, se ainda no futuro) -
    // mesmo mecanismo de "encerrar recorrência" já usado pra uma ocorrência
    // virtual futura, agora protegido contra fechar antes de hoje.
    if (income.recurrence === FinancialRecurrence.RECURRING) {
      const anchorMonth = monthKeyOf(income.paidAt);
      const boundaryMonth = clampToPresentOrLater(beforeMonth ?? anchorMonth);
      if (boundaryMonth !== anchorMonth) {
        await prisma.financialIncome.update({
          where: { id: incomeId },
          data: { recurrenceEndDate: endOfMonthBefore(boundaryMonth) }
        });
        return;
      }
    }

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

    // Épico de Frentes, Frente 7, Lote 4: mesma proteção de updateIncome —
    // editar a própria âncora depois que o tempo já passou também precisa
    // dividir a série, não só editar a projeção de um mês futuro explícito.
    const anchorMonth = monthKeyOf(expense.paidAt);
    const requestedMonth = input.occurrenceMonth ?? anchorMonth;
    const isSplit = expense.recurrence === FinancialRecurrence.RECURRING
      && clampToPresentOrLater(requestedMonth) !== anchorMonth;

    if (isSplit) {
      const occurrenceMonth = clampToPresentOrLater(requestedMonth);
      // Épico de Frentes, Frente 7, Lote 13: mesma proteção de updateIncome —
      // updateMany condicional garante que só uma das duas edições quase
      // simultâneas da mesma âncora consiga fechar a série e criar a nova; a
      // outra recebe um conflito em vez de duplicar a recorrência.
      return prisma.$transaction(async (tx) => {
        const closed = await tx.financialExpense.updateMany({
          where: { id: expenseId, recurrenceEndDate: expense.recurrenceEndDate },
          data: { recurrenceEndDate: endOfMonthBefore(occurrenceMonth) }
        });
        if (closed.count === 0) {
          throw new AppError("Esta despesa já foi editada em outra requisição. Recarregue e tente novamente.", StatusCodes.CONFLICT);
        }
        return tx.financialExpense.create({
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

  async deleteExpense(userId: string, expenseId: string, beforeMonth?: string) {
    const provider = await getProviderByUserId(userId);
    const expense = await prisma.financialExpense.findUnique({ where: { id: expenseId } });
    if (!expense || expense.providerId !== provider.id) throw new AppError("Despesa não encontrada.", StatusCodes.NOT_FOUND);

    // Épico de Frentes, Frente 7, Lote 4: mesma proteção de deleteIncome.
    if (expense.recurrence === FinancialRecurrence.RECURRING) {
      const anchorMonth = monthKeyOf(expense.paidAt);
      const boundaryMonth = clampToPresentOrLater(beforeMonth ?? anchorMonth);
      if (boundaryMonth !== anchorMonth) {
        await prisma.financialExpense.update({
          where: { id: expenseId },
          data: { recurrenceEndDate: endOfMonthBefore(boundaryMonth) }
        });
        return;
      }
    }

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
      // Épico de Frentes, Frente 7, Lote 11: campo omitido (undefined) não
      // mexe na coluna; `null` explícito limpa a meta - antes os dois casos
      // eram tratados igual (undefined direto no Prisma também vira "não
      // mexer"), então limpar um campo pelo app nunca removia a meta antiga.
      update: {
        ...(input.targetRevenueCents !== undefined ? { targetRevenueCents: input.targetRevenueCents } : {}),
        ...(input.targetStudents !== undefined ? { targetStudents: input.targetStudents } : {}),
        ...(input.targetWeeklyClasses !== undefined ? { targetWeeklyClasses: input.targetWeeklyClasses } : {})
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
          client: { select: { id: true, name: true } }
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
      // Frente 6 (Ofertas do profissional), Lote 2: lê o kind congelado no
      // contrato (não mais ao vivo da oferta) — senão, editar o kind da
      // oferta depois da venda mudava retroativamente o rótulo de
      // transações passadas em relatórios de faturamento já fechados.
      const svcName = consultancyKindLabel(c.kind);
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
    // Épico de Frentes, Frente 7, Lote 9: teto elevado de 24 pra 36 - o
    // Relatório Anual do mobile pede 36 meses (3 anos) pra alimentar o
    // seletor de ano, mas esse clamp nunca deixava passar de 24.
    const safeMon = Math.min(Math.max(Number.isInteger(months) ? months : 6, 1), 36);
    months = safeMon;
    const provider = await getProviderByUserId(userId);
    const thisMonth = currentMonth();
    const result: Array<{
      month: string;
      revenueCents: number;
      appRevenueCents: number;
      expensesCents: number;
      netCents: number;
      classes: number;
    }> = [];

    for (let i = months - 1; i >= 0; i--) {
      const month = addMonthsToKey(thisMonth, -i);
      const { from, to } = monthBounds(month);

      const [incomes, expenses, consultancyDeliveries, appBookings, appContracts, appPackageCycles, renewalPlans] = await Promise.all([
        getEffectiveIncomes(provider.id, month),
        getEffectiveExpenses(provider.id, month),
        // Épico de Frentes, Frente 7, Lote 6: mesmo critério de getDashboard
        // - "aulas" conta sessão presencial concluída + entrega de ficha.
        prisma.trainingPlan.count({
          where: { providerId: provider.id, createdAt: { gte: from, lte: to } }
        }),
        // Épico de Frentes, Frente 7, Lote 2: aggregate() somava priceCents
        // direto, sem descontar sessão reembolsada depois via disputa
        // (Payment.status/refundedAmountCents) - trocado por findMany +
        // effectiveBookingRevenueCents, mesmo tratamento de getDashboard.
        prisma.booking.findMany({
          where: { providerId: provider.id, status: BookingStatus.COMPLETED, scheduledAt: { gte: from, lte: to } },
          select: { priceCents: true, payment: { select: { status: true, refundedAmountCents: true } } },
          take: 2000
        }),
        prisma.consultancyContract.aggregate({
          where: { providerId: provider.id, paymentStatus: ConsultancyPaymentStatus.CAPTURED, paymentCapturedAt: { gte: from, lte: to } },
          _sum: { paymentAmountCents: true }
        }),
        prisma.presentialPackageCycle.findMany({
          where: { package: { providerId: provider.id }, capturedAt: { gte: from, lte: to } },
          select: { amountCents: true, refundedAmountCents: true },
          take: 2000
        }),
        // Raio-X de pagamentos, Rodada 3, Lote 4: getReport ficou de fora do
        // conserto que getDashboard/getPayouts já receberam na Rodada 2 —
        // renovações de ficha (2ª ficha em diante) somem do relatório anual.
        // refundedAt exclui renovação contestada e reembolsada (Frente 7, Lote 2).
        prisma.trainingPlan.findMany({
          where: { providerId: provider.id, renewalMpPaymentId: { not: null }, refundedAt: null, createdAt: { gte: from, lte: to } },
          select: { contract: { select: { paymentAmountCents: true } } },
          take: 2000
        })
      ]);

      const rev       = incomes.reduce((s, i) => s + i.amountCents, 0);
      const renewalRev = renewalPlans.reduce((s, p) => s + (p.contract?.paymentAmountCents ?? 0), 0);
      const appRev =
        appBookings.reduce((s, b) => s + effectiveBookingRevenueCents(b), 0)
        + (appContracts._sum.paymentAmountCents ?? 0)
        + appPackageCycles.reduce((s, c) => s + effectiveCycleRevenueCents(c), 0)
        + renewalRev;
      const exp    = expenses.reduce((s, e) => s + e.amountCents, 0);
      const classes = appBookings.length + consultancyDeliveries;
      result.push({ month, revenueCents: rev, appRevenueCents: appRev, expensesCents: exp, netCents: rev + appRev - exp, classes });
    }

    const bestMonth = [...result].sort((a, b) => b.revenueCents - a.revenueCents)[0] ?? null;
    const avgRevenue =
      result.length > 0
        ? Math.round(result.reduce((s, r) => s + r.revenueCents, 0) / result.length)
        : 0;

    return { months: result, bestMonth, avgRevenueCents: avgRevenue };
  }

  async getPayouts(userId: string, month?: string) {
    // Épico de Frentes, Frente 7, Lote 3: sem `month`, mantém o
    // comportamento antigo (top 50 mais recentes de toda a história - usado
    // pelo card-resumo do dashboard financeiro). Com `month`, a lista de
    // lançamentos do Extrato passa a vir filtrada pelo mês de verdade, em
    // vez de um corte global de 50 que "sumia" com transações antigas do
    // mês selecionado enquanto o total do topo da mesma tela (getReport)
    // continuava contando todas elas.
    return this.buildPayoutsData(userId, month ? 2000 : 50, month);
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
    // Raio-X de pagamentos, Rodada 5, Lote 3: valor_liquido é calculado
    // localmente pela plataforma (split fixo) — a MP pode reter uma taxa de
    // adquirência própria por cima disso, que este sistema não captura.
    // Aviso explícito em vez de deixar o profissional achar que é o valor
    // exato depositado na conta MP dele.
    const disclaimer = escapeCsv(
      "valor_liquido é um cálculo teórico da plataforma e pode não bater exatamente com o extrato da sua conta Mercado Pago (taxas de adquirência da própria MP não estão incluídas aqui)."
    );
    return [header, ...rows, disclaimer].join("\n");
  }

  private async buildPayoutsData(userId: string, take: number, month?: string) {
    const provider = await getProviderByUserId(userId);
    // Épico de Frentes, Frente 7, Lote 3: quando `month` é passado (Extrato),
    // cada fonte é filtrada pela data em que realmente virou receita
    // (capturedAt/paymentCapturedAt/createdAt) - pendente (AUTHORIZED, sem
    // capturedAt) fica de fora, já que "pendente neste mês" não tem sentido
    // pra uma lista de lançamentos já realizados.
    const monthRange = month ? monthBounds(month) : null;

    const [payments, contracts, packageCycles, renewalPlans] = await Promise.all([
      prisma.payment.findMany({
        where: {
          booking: { providerId: provider.id },
          // Raio-X de pagamentos, Rodada 3, Lote 4: PARTIALLY_REFUNDED sumia
          // inteiro da lista de repasses — o profissional perdia de vista o
          // valor que ainda tinha direito a receber depois de uma disputa
          // resolvida com estorno parcial.
          status: monthRange
            ? { in: [PaymentStatus.CAPTURED, PaymentStatus.PARTIALLY_REFUNDED] }
            : { in: [PaymentStatus.AUTHORIZED, PaymentStatus.CAPTURED, PaymentStatus.PARTIALLY_REFUNDED] },
          ...(monthRange ? { capturedAt: { gte: monthRange.from, lte: monthRange.to } } : {})
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
          paymentStatus: ConsultancyPaymentStatus.CAPTURED,
          ...(monthRange ? { paymentCapturedAt: { gte: monthRange.from, lte: monthRange.to } } : {})
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
        where: {
          package: { providerId: provider.id },
          capturedAt: monthRange ? { gte: monthRange.from, lte: monthRange.to } : { not: null }
        },
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
        where: {
          providerId: provider.id,
          renewalMpPaymentId: { not: null },
          ...(monthRange ? { createdAt: { gte: monthRange.from, lte: monthRange.to } } : {})
        },
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
      // Épico de Frentes, Frente 7, Lote 7: "bruto" (mobile) somava só
      // sessões presenciais concluídas, enquanto "líquido" já vinha daqui
      // incluindo todos os tipos - profissional que vende majoritariamente
      // consultoria/pacote via líquido > bruto, com "comissão" negativa.
      // grossCents usa exatamente o mesmo escopo de availableCents, só sem
      // aplicar o split.
      grossCents: captured.reduce((s, p) => s + p.amountCents, 0)
        + contracts.reduce((s, c) => s + c.paymentAmountCents, 0)
        + packageCycles.reduce((s, c) => s + (c.amountCents ?? 0), 0)
        + renewalTransactions.reduce((s, r) => s + r.amountCents, 0),
      payments: transactions
    };
  }
}
