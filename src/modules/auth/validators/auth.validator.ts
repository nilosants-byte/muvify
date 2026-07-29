import { z } from "zod";
import { isCommonPassword } from "../../../shared/utils/password-strength";

const notCommonPassword = (value: string) => !isCommonPassword(value);
const COMMON_PASSWORD_MESSAGE = "Essa senha é muito comum. Escolha uma senha mais difícil de adivinhar.";

export const registerSchema = z.object({
  body: z.object({
    name: z.string().min(3).max(100).regex(/^[a-zA-ZÀ-ÿ\s'\-\.]+$/, "Nome contém caracteres inválidos."),
    apelido: z
      .string()
      .min(3)
      .max(30)
      .regex(/^[a-z0-9_]+$/, "Apelido deve conter apenas letras minúsculas, números e _.")
      .optional(),
    email: z.string().trim().toLowerCase().email(),
    password: z
      .string()
      .min(8)
      .max(72)
      .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, "Senha deve conter letras e numeros.")
      .refine(notCommonPassword, COMMON_PASSWORD_MESSAGE),
    phone: z
      .string()
      .trim()
      .regex(
        /^(?=(?:\D*\d){8,15}\D*$)[\d\s()+-]+$/,
        "Telefone deve conter entre 8 e 15 digitos."
      ),
    role: z.enum(["CLIENT", "PROVIDER"]).optional(),
    termsVersion: z.string().trim().min(1).max(20),
    consentAccepted: z.literal(true)
  })
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(8).max(72)
  })
});

export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(20).max(2000)
  })
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    channel: z.enum(["EMAIL", "RECOVERY_EMAIL"]).default("EMAIL"),
    email: z.string().trim().toLowerCase().email()
  })
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(20).max(2000),
    newPassword: z
      .string()
      .min(8)
      .max(72)
      .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, "Senha deve conter letras e numeros.")
      .refine(notCommonPassword, COMMON_PASSWORD_MESSAGE)
  })
});
