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

export const createStudentSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(120),
    monthlyValueCents: z.number().int().min(100).max(2_000_000_000), // Int32 safe
    type: studentTypeEnum,
    weeklyFrequency: z.number().int().min(1).max(7).optional(),
    notes: z.string().trim().max(500).optional(),
    location: z.string().trim().max(300).optional(),
    weeklySchedule: z.array(weeklyScheduleSlotSchema).optional()
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
    notes: z.string().trim().max(500).optional(),
    location: z.string().trim().max(300).optional(),
    weeklySchedule: z.array(weeklyScheduleSlotSchema).optional()
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
    paidAt: z.string().datetime({ offset: true })
  })
});

export const incomeIdSchema = z.object({
  params: z.object({ id: z.string().uuid() })
});

export const createExpenseSchema = z.object({
  body: z.object({
    description: z.string().trim().min(2).max(200),
    amountCents: z.number().int().min(1).max(2_000_000_000), // max ~R$20M (Int32 safe)
    category: z.enum(["GYM", "TRANSPORT", "EQUIPMENT", "MARKETING", "OTHER"]).optional(),
    paidAt: z.string().datetime({ offset: true })
  })
});

export const expenseIdSchema = z.object({
  params: z.object({ id: z.string().uuid() })
});

export const upsertGoalSchema = z.object({
  body: z.object({
    month: monthSchema,
    targetRevenueCents: z.number().int().min(0).optional(),
    targetStudents: z.number().int().min(0).optional(),
    targetWeeklyClasses: z.number().int().min(0).optional()
  })
});

export const createClassSessionSchema = z.object({
  body: z.object({
    studentId: z.string().uuid().optional(),
    date: z.string().datetime({ offset: true }),
    notes: z.string().trim().max(300).optional()
  })
});

export const classSessionIdSchema = z.object({
  params: z.object({ id: z.string().uuid() })
});
