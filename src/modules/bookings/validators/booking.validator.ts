import { z } from "zod";

const completionProofSchema = z.object({
  imageBase64: z
    .string()
    .trim()
    .min(20, "Selfie em base64 obrigatoria.")
    .max(2_000_000, "Selfie acima do tamanho maximo permitido.")
    .regex(/^data:image\/(jpeg|jpg|png|webp);base64,[a-zA-Z0-9+/=]+$/, "Formato de imagem base64 invalido."),
  mimeType: z.enum(["image/jpeg", "image/jpg", "image/png", "image/webp"]),
  cameraFacing: z.enum(["FRONT", "BACK"])
});

export const createBookingSchema = z.object({
  body: z
    .object({
      providerId: z.string().uuid(),
      categoryId: z.string().uuid(),
      scheduledAt: z.string().datetime({ offset: true }).refine(
        (d) => {
          const date = new Date(d);
          const max = new Date();
          max.setFullYear(max.getFullYear() + 1);
          return date > new Date() && date <= max;
        },
        { message: "Agendamento deve ser no futuro e com no maximo 1 ano de antecedencia." }
      ),
      offerId: z.string().uuid().optional(),
      paymentMethod: z.enum(["CARD", "CREDIT_CARD", "DEBIT_CARD", "PIX"]).default("CREDIT_CARD"),
      notes: z.string().trim().max(500).optional(),
      sessionLocation: z.string().trim().max(300).optional(),
      clientLatitude: z.number().min(-90).max(90).optional(),
      clientLongitude: z.number().min(-180).max(180).optional(),
      // Agendamento pago com credito de um pacote presencial (FLEXIBLE_CREDITS) -
      // quando presente, o preco e ignorado (ja foi cobrado no ciclo).
      packageId: z.string().uuid().optional(),
      // Raio-X de pagamentos, Rodada 3, Lote 5: so obrigatorio quando o
      // agendamento e pra menos de 7 dias (regra dos 2h de cancelamento
      // pode vencer o prazo de arrependimento do CDC antes dele terminar).
      acknowledgedImmediateExecution: z.boolean().optional()
    })
    .superRefine((value, ctx) => {
      const scheduled = new Date(value.scheduledAt);
      if (Number.isNaN(scheduled.getTime())) return;
      const daysUntilScheduled = (scheduled.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      if (daysUntilScheduled < 7 && value.acknowledgedImmediateExecution !== true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Como este horário é em menos de 7 dias, é necessário confirmar a ciência sobre o início imediato do atendimento.",
          path: ["acknowledgedImmediateExecution"]
        });
      }
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

export const reportNoShowSchema = z.object({
  params: z.object({
    bookingId: z.string().uuid()
  }),
  body: z.object({
    // Frente 5 (Descoberta, agendamento e agenda), Lote 11: sem mensagem
    // customizada, o erro de validação cai no texto padrão em inglês do
    // Zod ("String must contain at least 3 character(s)").
    reportReason: z.string().trim().min(3, "O motivo deve ter pelo menos 3 caracteres.").max(500).optional()
  })
});

export const contestNoShowSchema = z.object({
  params: z.object({
    bookingId: z.string().uuid()
  }),
  body: z.object({
    contestReason: z.string().trim().min(3, "O motivo deve ter pelo menos 3 caracteres.").max(500).optional()
  })
});

export const contestAutoCaptureSchema = z.object({
  params: z.object({
    bookingId: z.string().uuid()
  }),
  body: z.object({
    reason: z.string().trim().min(3, "O motivo deve ter pelo menos 3 caracteres.").max(500).optional()
  })
});

export const completionProofParamSchema = z.object({
  params: z.object({
    bookingId: z.string().uuid(),
    evidenceUserId: z.string().uuid()
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
