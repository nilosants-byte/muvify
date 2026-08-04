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
