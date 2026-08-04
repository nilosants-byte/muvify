import { z } from "zod";

export const chatBookingIdParamSchema = z.object({
  params: z.object({
    bookingId: z.string().uuid()
  })
});

export const chatSendMessageSchema = z.object({
  params: z.object({
    bookingId: z.string().uuid()
  }),
  body: z.object({
    content: z.string().trim().min(1).max(1000)
  })
});

// Épico de Frentes, Frente 9, Lote 10: denúncia de mensagem no chat -
// espelha reportPostSchema (Frente 8, Lote 2).
export const chatReportMessageSchema = z.object({
  params: z.object({
    bookingId: z.string().uuid(),
    messageId: z.string().uuid()
  }),
  body: z.object({
    reason: z.string().trim().min(1).max(300).optional()
  })
});
