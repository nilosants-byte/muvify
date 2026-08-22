import { z } from "zod";

// Landing page pública, sem login e sem JS obrigatório (form HTML puro) -
// usado com .safeParse() direto na rota (public.routes.ts), não com o
// middleware `validate()` padrão, porque uma falha de validação aqui deve
// redirecionar de volta pra página com uma mensagem amigável, não devolver
// o JSON de erro genérico do errorMiddleware pra quem só preencheu um
// formulário.
export const waitlistSignupSchema = z.object({
  body: z.object({
    email: z.string().trim().toLowerCase().email().max(254),
    audience: z.enum(["CLIENT", "PROFESSIONAL"]),
    whatsapp: z.string().trim().max(20).optional().or(z.literal("").transform(() => undefined)),
    city: z.string().trim().max(120).optional().or(z.literal("").transform(() => undefined)),
    utmSource: z.string().trim().max(120).optional().or(z.literal("").transform(() => undefined))
  })
});
