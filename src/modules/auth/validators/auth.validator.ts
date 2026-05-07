import { z } from "zod";

export const registerSchema = z.object({
  body: z.object({
    name: z.string().min(3),
    email: z.string().email(),
    password: z
      .string()
      .min(8)
      .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, "Senha deve conter letras e numeros."),
    phone: z.string().min(8),
    role: z.enum(["CLIENT", "PROVIDER"]).optional(),
    termsVersion: z.string().trim().min(1).max(20),
    consentAccepted: z.literal(true)
  })
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8)
  })
});

export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(20)
  })
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    channel: z.literal("EMAIL").default("EMAIL"),
    email: z.string().email()
  })
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(20),
    newPassword: z
      .string()
      .min(8)
      .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, "Senha deve conter letras e numeros.")
  })
});

