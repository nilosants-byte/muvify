import { z } from "zod";

const weeklyScheduleEntrySchema = z.object({
  weekday: z.number().int().min(0).max(6),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido (use HH:MM).")
});

export const purchasePresentialPackageSchema = z.object({
  body: z.object({
    offerId: z.string().uuid(),
    categoryId: z.string().uuid(),
    paymentMethod: z.enum(["CREDIT_CARD", "PIX"]),
    weeklySchedule: z.array(weeklyScheduleEntrySchema).min(1).max(7).optional()
  })
});

export const packageIdParamSchema = z.object({
  params: z.object({
    packageId: z.string().uuid()
  })
});
