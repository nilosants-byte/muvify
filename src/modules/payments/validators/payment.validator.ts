import { z } from "zod";

export const setupCustomerPaymentSchema = z.object({
  body: z.object({
    paymentMethodId: z.string().min(1)
  })
});

export const createCustomerSetupIntentSchema = z.object({
  body: z.object({}).default({})
});

export const confirmCustomerSetupIntentSchema = z.object({
  body: z.object({
    setupIntentId: z.string().min(1).optional(),
    cardToken: z.string().min(1),
    nickname: z.string().trim().min(1).max(60).optional(),
    makeDefault: z.boolean().optional()
  })
});

export const customerCardIdParamSchema = z.object({
  params: z.object({
    cardId: z.string().uuid()
  })
});

export const updateCustomerCardSchema = z.object({
  params: z.object({
    cardId: z.string().uuid()
  }),
  body: z.object({
    nickname: z.string().trim().min(1).max(60)
  })
});

export const createProviderAccountSchema = z.object({
  body: z
    .object({
      returnUrl: z.string().url().optional(),
      refreshUrl: z.string().url().optional()
    })
    .default({})
});

export const bookingPaymentSchema = z.object({
  params: z.object({
    bookingId: z.string().uuid()
  })
});

export const createPixChargeSchema = z.object({
  params: z.object({
    bookingId: z.string().uuid()
  })
});

export const selectBookingPaymentMethodSchema = z.object({
  params: z.object({
    bookingId: z.string().uuid()
  }),
  body: z
    .object({
      method: z.enum(["CARD", "PIX"]),
      customerCardId: z.string().uuid().optional()
    })
    .superRefine((value, ctx) => {
      if (value.method === "CARD" && !value.customerCardId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Selecione um cartao para pagamento por cartao.",
          path: ["customerCardId"]
        });
      }
    })
});
