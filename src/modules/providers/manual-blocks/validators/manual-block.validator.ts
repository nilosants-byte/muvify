import { z } from "zod";

export const manualBlockIdSchema = z.object({
  params: z.object({ blockId: z.string().uuid() })
});

export const createManualBlockSchema = z.object({
  body: z.object({
    date: z.string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato YYYY-MM-DD.")
      .refine((d) => {
        const today = new Date().toISOString().slice(0, 10);
        return d >= today;
      }, "Data deve ser hoje ou no futuro."),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, "startTime deve estar no formato HH:MM."),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, "endTime deve estar no formato HH:MM."),
    label: z.string().min(1).max(100).default("Bloqueado"),
    location: z.string().max(200).optional(),
  }),
});
