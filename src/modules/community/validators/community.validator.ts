import { z } from "zod";
import { env } from "../../../config/env";

// Raio-X Muvify, Frente 1 (Autorização/IDOR), Lote 2: imageUrl aceitava
// qualquer domínio externo — restringe ao próprio bucket, evitando que um
// post do feed injete link/rastreamento arbitrário dentro de tela confiável
// do app.
const ownMediaUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => !env.R2_PUBLIC_URL || value.startsWith(env.R2_PUBLIC_URL), {
    message: "imageUrl deve apontar para o storage do próprio app."
  });

export const userIdParamSchema = z.object({
  params: z.object({ userId: z.string().uuid() })
});

export const postIdParamSchema = z.object({
  params: z.object({ postId: z.string().uuid() })
});

export const commentIdParamSchema = z.object({
  params: z.object({ postId: z.string().uuid(), commentId: z.string().uuid() })
});

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
};

export const paginationSchema = z.object({
  query: z.object(pagination),
});

export const searchUsersSchema = z.object({
  query: z.object({
    ...pagination,
    q: z.string().trim().min(2).max(100),
  }),
});

export const createPhotoPostSchema = z.object({
  body: z.object({
    imageUrl: ownMediaUrl.optional(),
    caption: z.string().trim().min(1).max(300).optional(),
  }).refine((b) => b.imageUrl || b.caption, {
    message: "Informe uma imagem ou uma legenda",
  }),
});

export const addCommentSchema = z.object({
  body: z.object({
    content: z.string().trim().min(1).max(500),
  }),
});

export const reportPostSchema = z.object({
  params: z.object({ postId: z.string().uuid() }),
  body: z.object({
    reason: z.string().trim().min(1).max(300).optional(),
  }),
});

export const rankingQuerySchema = z.object({
  query: z.object({
    ...pagination,
    period: z.enum(["WEEKLY", "MONTHLY", "ALLTIME"]).default("WEEKLY"),
  }),
});

export const suggestionsQuerySchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().min(1).max(20).default(10),
  }),
});
