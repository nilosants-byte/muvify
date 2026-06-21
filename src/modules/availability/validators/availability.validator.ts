import { z } from "zod";

export const availabilityIdSchema = z.object({
  params: z.object({ availabilityId: z.string().uuid() })
});

const timeString = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .refine((t) => {
    const [h, m] = t.split(":").map(Number);
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  }, "Horário inválido (use HH:MM entre 00:00 e 23:59)");

export const createAvailabilitySchema = z.object({
  body: z
    .object({
      weekday: z.number().int().min(0).max(6),
      startTime: timeString,
      endTime: timeString,
      isActive: z.boolean().optional(),
    })
    .superRefine((data, ctx) => {
      if (data.startTime >= data.endTime) {
        ctx.addIssue({
          code: "custom",
          path: ["endTime"],
          message: "O horário final deve ser posterior ao inicial.",
        });
      }
    }),
});
