import { z } from "zod";

const totpCodeSchema = z
  .string()
  .length(6)
  .regex(/^\d{6}$/, "Código deve ter exatamente 6 dígitos.");

export const confirmTwoFactorSchema = z.object({
  body: z.object({
    code: totpCodeSchema
  })
});

export const disableTwoFactorSchema = z.object({
  body: z.object({
    password: z.string().min(8),
    code: totpCodeSchema
  })
});

export const loginWithTwoFactorSchema = z.object({
  body: z
    .object({
      challengeToken: z.string().min(20),
      code: totpCodeSchema.optional(),
      backupCode: z.string().min(8).max(20).optional()
    })
    .refine((data) => data.code !== undefined || data.backupCode !== undefined, {
      message: "Informe o codigo do app autenticador ou um codigo de recuperacao."
    })
});
