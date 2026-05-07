import { z } from "zod";
export const createAvailabilitySchema = z.object({
  body: z.object({
    weekday: z.number().int().min(0).max(6),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    isActive: z.boolean().optional()
  })
});
