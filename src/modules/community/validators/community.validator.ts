import { z } from "zod";

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
    imageUrl: z
      .string()
      .max(5_000_000)
      .refine(
        (v) => v.startsWith("data:image/") || v.startsWith("http://") || v.startsWith("https://"),
        { message: "imageUrl deve ser uma URL http(s) ou data URI de imagem" }
      )
      .optional(),
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
