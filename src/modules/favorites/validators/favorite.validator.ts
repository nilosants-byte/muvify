import { z } from "zod";
export const favoriteSchema = z.object({
  body: z.object({
    providerId: z.string().uuid()
  })
});
export const favoriteParamSchema = z.object({
  params: z.object({
    providerId: z.string().uuid()
  })
});
