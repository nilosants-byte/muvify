import { z } from "zod";

const offerKindSchema = z.enum([
  "PRESENTIAL",
  "ONLINE_CONSULTANCY",
  "ONLINE_CONSULTANCY_SPECIALIZED",
  "COMBO"
]);

const offerBillingCycleSchema = z.enum([
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "SEMIANNUAL",
  "ANNUAL"
]);

const exerciseInputSchema = z.object({
  sortOrder: z.number().int().min(0).optional(),
  exerciseId: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(120),
  repetitionsSets: z.string().trim().min(2).max(120),
  load: z.string().trim().min(1).max(120),
  restSeconds: z.number().int().min(0).max(3600).optional(),
  restLabel: z.string().trim().max(120).optional(),
  demoVideoUrl: z.string().trim().url().max(500).optional()
});

export const providerCatalogSchema = z.object({
  params: z.object({
    providerId: z.string().uuid()
  })
});

export const updateOnlineSettingSchema = z.object({
  body: z.object({
    enabled: z.boolean()
  })
});

const presentialPackageModeSchema = z.enum(["FIXED_RECURRING", "FLEXIBLE_CREDITS"]);

export const createProviderOfferSchema = z.object({
  body: z.object({
    kind: offerKindSchema,
    title: z.string().trim().min(2).max(140),
    billingCycle: offerBillingCycleSchema,
    daysPerWeek: z.number().int().min(1).max(7).optional(),
    comboPresentialDaysPerWeek: z.number().int().min(1).max(7).optional(),
    comboOnlineDaysPerWeek: z.number().int().min(1).max(7).optional(),
    priceCents: z.number().int().min(100).max(10_000_000),
    isPromotion: z.boolean().optional().default(false),
    promotionPriceCents: z.number().int().min(50).max(10_000_000).optional(),
    promotionEndsAt: z.string().datetime().optional(),
    promotionLabel: z.string().trim().max(80).optional(),
    acceptsPix: z.boolean().optional().default(true),
    acceptsDebitCard: z.boolean().optional().default(true),
    acceptsCreditCard: z.boolean().optional().default(true),
    maxCreditInstallments: z.number().int().min(1).max(12).optional().default(1),
    isActive: z.boolean().optional().default(true),
    // Pacote presencial (so PRESENTIAL/COMBO) - assinatura cobrada em ciclos
    presentialPackageMode: presentialPackageModeSchema.optional(),
    presentialHasFixedTerm: z.boolean().optional().default(false),
    presentialTotalCycles: z.number().int().min(1).max(60).optional(),
    presentialSessionsPerCycle: z.number().int().min(1).max(60).optional(),
    comboPresentialShareCents: z.number().int().min(100).max(10_000_000).optional(),
    comboConsultancyShareCents: z.number().int().min(100).max(10_000_000).optional()
  })
});

export const updateProviderOfferSchema = z.object({
  params: z.object({
    offerId: z.string().uuid()
  }),
  body: z.object({
    title: z.string().trim().min(2).max(140).optional(),
    kind: offerKindSchema.optional(),
    billingCycle: offerBillingCycleSchema.optional(),
    daysPerWeek: z.number().int().min(1).max(7).nullable().optional(),
    comboPresentialDaysPerWeek: z.number().int().min(1).max(7).nullable().optional(),
    comboOnlineDaysPerWeek: z.number().int().min(1).max(7).nullable().optional(),
    priceCents: z.number().int().min(100).max(10_000_000).optional(),
    isPromotion: z.boolean().optional(),
    promotionPriceCents: z.number().int().min(50).max(10_000_000).nullable().optional(),
    promotionEndsAt: z.string().datetime().nullable().optional(),
    promotionLabel: z.string().trim().max(80).nullable().optional(),
    acceptsPix: z.boolean().optional(),
    acceptsDebitCard: z.boolean().optional(),
    acceptsCreditCard: z.boolean().optional(),
    maxCreditInstallments: z.number().int().min(1).max(12).optional(),
    isActive: z.boolean().optional(),
    presentialPackageMode: presentialPackageModeSchema.nullable().optional(),
    presentialHasFixedTerm: z.boolean().optional(),
    presentialTotalCycles: z.number().int().min(1).max(60).nullable().optional(),
    presentialSessionsPerCycle: z.number().int().min(1).max(60).nullable().optional(),
    comboPresentialShareCents: z.number().int().min(100).max(10_000_000).nullable().optional(),
    comboConsultancyShareCents: z.number().int().min(100).max(10_000_000).nullable().optional()
  })
});

export const createTrainingPlanSchema = z.object({
  body: z.object({
    title: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000).optional(),
    isPrebuilt: z.boolean().optional().default(true),
    exercises: z.array(exerciseInputSchema).min(1).max(120)
  })
});

export const updateTrainingPlanSchema = z.object({
  params: z.object({
    planId: z.string().uuid()
  }),
  body: z
    .object({
      title: z.string().trim().min(2).max(120).optional(),
      description: z.string().trim().max(1000).optional(),
      isActive: z.boolean().optional(),
      exercises: z.array(exerciseInputSchema).min(1).max(120).optional(),
      validUntil: z.string().datetime().optional()
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: "Informe ao menos um campo para atualizar.",
      path: ["title"]
    })
});

export const trainingPlanIdSchema = z.object({
  params: z.object({
    planId: z.string().uuid()
  })
});

export const createConsultancyRequestSchema = z.object({
  body: z.object({
    providerId: z.string().uuid(),
    trainingNeedText: z.string().trim().max(300).optional(),
    limitationText: z.string().trim().max(300).optional(),
    extraInfoText: z.string().trim().max(300).optional()
  })
});

export const requestIdParamSchema = z.object({
  params: z.object({
    requestId: z.string().uuid()
  })
});

export const offerIdParamSchema = z.object({
  params: z.object({
    offerId: z.string().uuid()
  })
});

export const respondConsultancyRequestSchema = z.object({
  params: z.object({
    requestId: z.string().uuid()
  }),
  body: z.object({
    providerResponseText: z.string().trim().min(2).max(3000),
    quotedOfferId: z.string().uuid()
  })
});

export const decideConsultancyRequestSchema = z.object({
  params: z.object({
    requestId: z.string().uuid()
  }),
  body: z
    .object({
      decision: z.enum(["ACCEPT", "REFUSE"]),
      paymentMethod: z.enum(["CREDIT_CARD", "DEBIT_CARD", "PIX"]).optional(),
      installments: z.number().int().min(1).max(12).optional()
    })
    .superRefine((value, ctx) => {
      if (value.decision === "ACCEPT" && !value.paymentMethod) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["paymentMethod"],
          message: "Método de pagamento obrigatório para aceitar contratacao."
        });
      }

      if (value.decision === "REFUSE" && typeof value.installments !== "undefined") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["installments"],
          message: "Parcelamento não se aplica quando a proposta e recusada."
        });
      }

      if (value.paymentMethod && value.paymentMethod !== "CREDIT_CARD" && value.installments && value.installments > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["installments"],
          message: "Parcelamento acima de 1x só é permitido para cartao de credito."
        });
      }
    })
});

export const deliverContractSchema = z.object({
  params: z.object({
    contractId: z.string().uuid()
  }),
  body: z.object({
    title: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000).optional(),
    exercises: z.array(exerciseInputSchema).min(1).max(120),
    validUntil: z.string().datetime().optional()
  })
});

export const archivedConsultancyQuerySchema = z.object({
  query: z.object({
    status: z.enum(["ALL", "REFUSED", "EXPIRED_REFUNDED", "ARCHIVED"]).optional()
  })
});

export const completeTrainingPlanSchema = z.object({
  params: z.object({
    trainingPlanId: z.string().uuid()
  }),
  body: z.object({
    notes: z.string().trim().max(500).optional()
  })
});
