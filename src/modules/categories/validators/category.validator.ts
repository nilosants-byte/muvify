import { z } from "zod";
export const createCategorySchema = z.object({
  body: z.object({
    name: z.string().min(2),
    description: z.string().optional()
  })
});
