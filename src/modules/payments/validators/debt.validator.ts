import { z } from "zod";

export const payDebtSchema = z.object({
  params: z.object({ debtId: z.string().uuid() })
});
