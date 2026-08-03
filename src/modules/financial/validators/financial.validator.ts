import { z } from "zod";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês deve estar no formato YYYY-MM");

export const dashboardQuerySchema = z.object({
  query: z.object({
    month: monthSchema.optional()
  })
});

export const listByMonthSchema = z.object({
  query: z.object({
    month: monthSchema.optional()
  })
});

const weeklyScheduleSlotSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/)
});

const studentTypeEnum = z.enum(["PRESENTIAL", "ONLINE", "APP", "BOTH"]);
const recurrenceEnum = z.enum(["RECURRING", "ONE_TIME"]);

export const createStudentSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(120),
    monthlyValueCents: z.number().int().min(100).max(2_000_000_000), // Int32 safe
    type: studentTypeEnum,
    weeklyFrequency: z.number().int().min(1).max(7).optional(),
    paymentDueDay: z.number().int().min(1).max(31).optional(),
    notes: z.string().trim().max(500).optional(),
    location: z.string().trim().max(300).optional(),
    weeklySchedule: z.array(weeklyScheduleSlotSchema).optional(),
    recurrence: recurrenceEnum.optional(),
    startDate: z.string().datetime({ offset: true }).optional(),
    recurrenceEndDate: z.string().datetime({ offset: true }).nullable().optional()
  })
});

export const updateStudentSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    name: z.string().trim().min(2).max(120).optional(),
    monthlyValueCents: z.number().int().min(100).max(2_000_000_000).optional(), // Int32 safe
    type: studentTypeEnum.optional(),
    weeklyFrequency: z.number().int().min(1).max(7).optional(),
    isActive: z.boolean().optional(),
    paymentDueDay: z.number().int().min(1).max(31).nullable().optional(),
    notes: z.string().trim().max(500).optional(),
    location: z.string().trim().max(300).optional(),
    weeklySchedule: z.array(weeklyScheduleSlotSchema).optional(),
    recurrence: recurrenceEnum.optional(),
    startDate: z.string().datetime({ offset: true }).optional(),
    recurrenceEndDate: z.string().datetime({ offset: true }).nullable().optional()
  }).refine((b) => Object.keys(b).length > 0, { message: "Informe ao menos um campo.", path: ["name"] })
});

export const studentIdSchema = z.object({
  params: z.object({ id: z.string().uuid() })
});

export const createIncomeSchema = z.object({
  body: z.object({
    description: z.string().trim().min(2).max(200),
    amountCents: z.number().int().min(1).max(2_000_000_000), // max ~R$20M (Int32 safe)
    studentId: z.string().uuid().optional(),
    paidAt: z.string().datetime({ offset: true }),
    recurrence: recurrenceEnum.optional(),
    recurrenceEndDate: z.string().datetime({ offset: true }).nullable().optional()
  })
});

export const incomeIdSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  // Épico de Frentes, Frente 7, Lote 4: mês a partir do qual a recorrência
  // deve encerrar (usado quando o item excluído é uma ocorrência projetada,
  // não a âncora em si) - ver deleteIncome.
  query: z.object({ beforeMonth: monthSchema.optional() }).optional()
});

export const updateIncomeSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    description: z.string().trim().min(2).max(200).optional(),
    amountCents: z.number().int().min(1).max(2_000_000_000).optional(),
    studentId: z.string().uuid().nullable().optional(),
    paidAt: z.string().datetime({ offset: true }).optional(),
    recurrence: recurrenceEnum.optional(),
    recurrenceEndDate: z.string().datetime({ offset: true }).nullable().optional(),
    occurrenceMonth: monthSchema.optional()
  }).refine(b => Object.keys(b).length > 0, { message: "Informe ao menos um campo.", path: ["description"] })
});

export const createExpenseSchema = z.object({
  body: z.object({
    description: z.string().trim().min(2).max(200),
    amountCents: z.number().int().min(1).max(2_000_000_000), // max ~R$20M (Int32 safe)
    category: z.enum(["GYM", "TRANSPORT", "EQUIPMENT", "MARKETING", "FORMATION", "SOFTWARE", "PROFESSIONAL_SERVICES", "RENT", "UNIFORM", "NUTRITION", "OTHER"]).optional(),
    paidAt: z.string().datetime({ offset: true }),
    recurrence: recurrenceEnum.optional(),
    recurrenceEndDate: z.string().datetime({ offset: true }).nullable().optional()
  })
});

export const expenseIdSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  query: z.object({ beforeMonth: monthSchema.optional() }).optional()
});

export const updateExpenseSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    description: z.string().trim().min(2).max(200).optional(),
    amountCents: z.number().int().min(1).max(2_000_000_000).optional(),
    category: z.enum(["GYM", "TRANSPORT", "EQUIPMENT", "MARKETING", "FORMATION", "SOFTWARE", "PROFESSIONAL_SERVICES", "RENT", "UNIFORM", "NUTRITION", "OTHER"]).optional(),
    paidAt: z.string().datetime({ offset: true }).optional(),
    recurrence: recurrenceEnum.optional(),
    recurrenceEndDate: z.string().datetime({ offset: true }).nullable().optional(),
    occurrenceMonth: monthSchema.optional()
  }).refine(b => Object.keys(b).length > 0, { message: "Informe ao menos um campo.", path: ["description"] })
});

export const upsertGoalSchema = z.object({
  body: z.object({
    month: monthSchema,
    // Épico de Frentes, Frente 7, Lote 11: `.nullable()` permite o
    // profissional limpar uma meta explicitamente (null) — antes só dava
    // pra "não mexer" (campo omitido/undefined), então limpar o campo e
    // salvar nunca removia a meta antiga de fato.
    targetRevenueCents: z.number().int().min(0).nullable().optional(),
    targetStudents: z.number().int().min(0).nullable().optional(),
    targetWeeklyClasses: z.number().int().min(0).nullable().optional()
  })
});

// Épico de Frentes, Frente 7, Lote 6: FinancialClassSession removido -
// nenhuma tela do app criava uma "aula" avulsa (createClassSessionSchema/
// classSessionIdSchema ficavam sem nenhum call site real), então a meta de
// "aulas por semana" passou a contar sessões reais já rastreadas pelo app
// (bookings concluídos + entregas de consultoria).
