import { z } from "zod";

export const updateTrainingDaysSchema = z.object({
  body: z.object({
    trainingDaysPerWeek: z.number().int().min(1).max(7),
  }),
});
