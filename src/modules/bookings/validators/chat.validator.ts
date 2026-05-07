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
