import { z } from "zod";

const fixedLocationSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(255).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  radiusKm: z.number().int().min(1).max(200).optional()
});

const profilePhotoSchema = z
  .union([
    z.string().trim().url(),
    z
      .string()
      .trim()
      .max(8_000_000)
      .regex(
        /^data:image\/(jpeg|jpg|png|webp);base64,[a-zA-Z0-9+/=]+$/,
        "Formato de foto invalido."
      )
  ]);

const presentationVideoSchema = z
  .string()
  .trim()
  .max(40_000_000)
  .regex(
    /^data:video\/(mp4|quicktime|webm|3gpp);base64,[a-zA-Z0-9+/=]+$/,
    "Formato de vídeo inválido. Use MP4, MOV ou WebM."
  );

export const createProviderProfileSchema = z.object({
  body: z.object({
    displayName: z.string().min(3),
    bio: z.string().min(10),
    experienceYears: z.number().int().min(0),
    priceCents: z.number().int().min(100),
    photoUrl: profilePhotoSchema.optional(),
    presentationVideoUrl: presentationVideoSchema.optional(),
    serviceRadiusKm: z.number().int().min(1).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    serviceMode: z.enum(["PRESENTIAL_ONLY", "HOME_VISIT_ONLY", "BOTH"]).optional(),
    fixedLocations: z.array(fixedLocationSchema).max(20).optional(),
    excludedLocations: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
    categoryIds: z.array(z.string().uuid()).optional(),
    specialties: z.array(z.string().trim().min(1).max(80)).max(20).optional()
  })
});

export const updateProviderProfileSchema = z.object({
  body: z.object({
    displayName: z.string().min(3).optional(),
    bio: z.string().min(10).optional(),
    experienceYears: z.number().int().min(0).optional(),
    priceCents: z.number().int().min(100).optional(),
    photoUrl: profilePhotoSchema.optional(),
    presentationVideoUrl: presentationVideoSchema.nullable().optional(),
    serviceRadiusKm: z.number().int().min(1).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    serviceMode: z.enum(["PRESENTIAL_ONLY", "HOME_VISIT_ONLY", "BOTH"]).optional(),
    fixedLocations: z.array(fixedLocationSchema).max(20).optional(),
    excludedLocations: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
    categoryIds: z.array(z.string().uuid()).optional(),
    specialties: z.array(z.string().trim().min(1).max(80)).max(30).optional()
  }).refine((b) => Object.keys(b).length > 0, { message: "Informe ao menos um campo.", path: ["displayName"] })
});

export const searchProvidersSchema = z.object({
  query: z.object({
    categoryId: z.string().uuid().optional(),
    q: z.string().optional(),
    minRating: z.coerce.number().min(0).max(5).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    maxDistanceKm: z.coerce.number().min(1).max(200).optional(),
    serviceMode: z.enum(["PRESENTIAL_ONLY", "HOME_VISIT_ONLY", "BOTH"]).optional(),
    take: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).max(10000).optional()
  })
});

export const providerIdSchema = z.object({
  params: z.object({
    providerId: z.string().uuid()
  })
});

export const providerSchedulePreviewSchema = z.object({
  params: z.object({
    providerId: z.string().uuid()
  }),
  query: z.object({
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    days: z.coerce.number().int().min(1).max(14).optional()
  })
});

export const providerDashboardCalendarQuerySchema = z.object({
  query: z.object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional()
  })
});

export const createProviderManualCalendarEventSchema = z.object({
  body: z.object({
    title: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000).optional(),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true })
  })
});

export const updateProviderManualCalendarEventSchema = z.object({
  params: z.object({
    eventId: z.string().uuid()
  }),
  body: z
    .object({
      title: z.string().trim().min(2).max(120).optional(),
      description: z.string().trim().max(1000).optional(),
      startsAt: z.string().datetime({ offset: true }).optional(),
      endsAt: z.string().datetime({ offset: true }).optional()
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: "Informe ao menos um campo para atualizar.",
      path: ["title"]
    })
});

export const providerCalendarEventIdSchema = z.object({
  params: z.object({
    eventId: z.string().uuid()
  })
});

export const providerStudentDetailSchema = z.object({
  params: z.object({
    clientId: z.string().uuid()
  })
});

const credentialDocumentSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(180),
  uri: z.string().trim().min(1).max(8_000_000), // permite data URI base64
  mimeType: z.string().trim().max(120).optional(),
  createdAt: z.string().datetime({ offset: true }).optional()
});

export const upsertProviderCredentialsSchema = z.object({
  body: z.object({
    crefNumber: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .regex(/^[A-Za-z0-9.\-\/]+$/, "Formato de CREF invalido."),
    crefDocumentUrl: z.string().trim().url().max(2000).optional(),
    credentials: z.array(credentialDocumentSchema).max(20).optional()
  })
});

const assessmentField = z.string().trim().max(6).optional();

export const upsertProviderStudentPhysicalAssessmentSchema = z.object({
  params: z.object({
    clientId: z.string().uuid()
  }),
  body: z.object({
    weight: assessmentField,
    height: assessmentField,
    imc: assessmentField,
    bodyFatPercent: assessmentField,
    muscleMass: assessmentField,
    circumferences: assessmentField,
    waist: assessmentField,
    hip: assessmentField,
    chest: assessmentField,
    arm: assessmentField,
    thigh: assessmentField
  })
});
