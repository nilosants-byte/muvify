import { z } from "zod";

export const consultancyContractIdParamSchema = z.object({
  params: z.object({
    contractId: z.string().uuid()
  })
});

export const consultancySendMessageSchema = z.object({
  params: z.object({
    contractId: z.string().uuid()
  }),
  body: z.object({
    content: z.string().trim().min(1).max(1000)
  })
});

// Épico de Frentes, Frente 9, Lote 10: denúncia de mensagem no chat de
// consultoria - espelha chatReportMessageSchema.
export const consultancyReportMessageSchema = z.object({
  params: z.object({
    contractId: z.string().uuid(),
    messageId: z.string().uuid()
  }),
  body: z.object({
    reason: z.string().trim().min(1).max(300).optional()
  })
});
