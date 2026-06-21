import { z } from "zod";

export const createExerciseSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(120),
    category: z.string().trim().min(2).max(60),
    description: z.string().trim().max(1000).optional(),
    defaultRepetitionsSets: z.string().trim().max(120).optional(),
    defaultRestLabel: z.string().trim().max(120).optional(),
    mediaUrl: z.string().trim().max(2048).optional(),
    mediaType: z.enum(["YOUTUBE", "VIDEO", "IMAGE", "GIF"]).optional()
  })
});

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
  })
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
  })
});
