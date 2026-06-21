import { z } from "zod";

const pushTokenSchema = z
  .string()
  .trim()
  .max(255)
  .regex(
    /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/,
    "Push token invalido."
  );

const pushPlatformSchema = z.enum(["ios", "android", "web", "unknown"]).optional();

export const registerPushDeviceSchema = z.object({
  body: z.object({
    token: pushTokenSchema,
    platform: pushPlatformSchema,
    appVersion: z.string().trim().max(40).optional(),
    deviceName: z.string().trim().max(80).optional()
  })
});

export const unregisterPushDeviceSchema = z.object({
  body: z.object({
    token: pushTokenSchema
  })
});

export const pushTestSchema = z.object({
  body: z.object({
    title: z.string().trim().min(2).max(120),
    body: z.string().trim().min(2).max(240),
    data: z
      .record(z.union([z.string(), z.number(), z.boolean()]))
      .optional()
  })
});
