import { z } from "zod";

export const payDebtSchema = z.object({
  params: z.object({ debtId: z.string().uuid() }),
  body: z.object({ method: z.enum(["CARD", "PIX"]).optional() }).optional()
});
