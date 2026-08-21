import { z } from "zod";
import { env } from "../../../config/env";

// Raio-X Muvify, Frente 1 (Autorização/IDOR), Lote 2: mediaUrl aceitava
// qualquer domínio externo — restringe ao próprio bucket, exceto quando
// mediaType é YOUTUBE (único caso legítimo de link externo).
function assertOwnOrYoutubeMedia(data: { mediaUrl?: string; mediaType?: string }, ctx: z.RefinementCtx) {
  if (!data.mediaUrl) return;
  const isYoutube = data.mediaType === "YOUTUBE";
  const isOwnBucket = !env.R2_PUBLIC_URL || data.mediaUrl.startsWith(env.R2_PUBLIC_URL);
  const isYoutubeUrl = /^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(data.mediaUrl);
  if (isYoutube ? !isYoutubeUrl : !isOwnBucket) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: isYoutube
        ? "mediaUrl deve ser um link do YouTube quando mediaType é YOUTUBE."
        : "mediaUrl deve apontar para o storage do próprio app.",
      path: ["mediaUrl"]
    });
  }
}

export const listExercisesSchema = z.object({
  query: z.object({
    category: z.string().trim().optional(),
    q: z.string().trim().optional(),
    prebuilt: z.enum(["true", "false"]).optional()
  })
});

export const exerciseIdSchema = z.object({
  params: z.object({
    exerciseId: z.string().uuid()
  })
});

export const createPrebuiltExerciseSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(120),
    category: z.string().trim().min(2).max(60),
    description: z.string().trim().max(1000).optional(),
    defaultRepetitionsSets: z.string().trim().max(120).optional(),
    defaultRestLabel: z.string().trim().max(120).optional(),
    mediaUrl: z.string().trim().max(2048).optional(),
    mediaType: z.enum(["YOUTUBE", "VIDEO", "IMAGE", "GIF"]).optional()
  }).superRefine(assertOwnOrYoutubeMedia)
});

export const updatePrebuiltExerciseSchema = z.object({
  params: z.object({ exerciseId: z.string().uuid() }),
  body: z.object({
    name: z.string().trim().min(2).max(120).optional(),
    category: z.string().trim().min(2).max(60).optional(),
    description: z.string().trim().max(1000).optional(),
    defaultRepetitionsSets: z.string().trim().max(120).optional(),
    defaultRestLabel: z.string().trim().max(120).optional(),
    mediaUrl: z.string().trim().max(2048).optional(),
    mediaType: z.enum(["YOUTUBE", "VIDEO", "IMAGE", "GIF"]).optional()
  }).superRefine(assertOwnOrYoutubeMedia)
});
