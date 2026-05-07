import { z } from "zod";

const completionProofSchema = z.object({
  imageBase64: z
    .string()
    .trim()
    .min(20, "Selfie em base64 obrigatoria.")
    .max(2_000_000, "Selfie acima do tamanho maximo permitido."),
  mimeType: z.enum(["image/jpeg", "image/jpg", "image/png", "image/webp"]),
  cameraFacing: z.enum(["FRONT", "BACK"])
});

export const createBookingSchema = z.object({
  body: z.object({
    providerId: z.string().uuid(),
    categoryId: z.string().uuid(),
    scheduledAt: z.string().datetime({ offset: true }),
    offerId: z.string().uuid().optional(),
    paymentMethod: z.enum(["CARD", "CREDIT_CARD", "DEBIT_CARD", "PIX"]).default("CREDIT_CARD"),
    notes: z.string().max(500).optional(),
    sessionLocation: z.string().trim().max(300).optional()
  })
});
export const updateBookingStatusSchema = z.object({
  body: z
    .object({
      status: z.enum(["CONFIRMED", "CANCELLED", "COMPLETED"]),
      completionProof: completionProofSchema.optional()
    })
    .superRefine((value, ctx) => {
      if (value.status === "COMPLETED" && !value.completionProof) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Selfie de confirmacao obrigatoria para concluir atendimento.",
          path: ["completionProof"]
        });
      }
    }),
  params: z.object({
    bookingId: z.string().uuid()
  })
});

export const bookingIdParamSchema = z.object({
  params: z.object({
    bookingId: z.string().uuid()
  })
});

export const verifyAttendanceCodeSchema = z.object({
  params: z.object({
    bookingId: z.string().uuid()
  }),
  body: z.object({
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "Codigo deve conter exatamente 6 numeros.")
  })
});

export const verifyAttendanceQrSchema = z.object({
  params: z.object({
    bookingId: z.string().uuid()
  }),
  body: z.object({
    qrToken: z
      .string()
      .trim()
      .min(16, "QR token invalido.")
  })
});
