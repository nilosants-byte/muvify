import { z } from "zod";

export const adminDashboardOverviewSchema = z.object({
  query: z.object({
    month: z.coerce.number().int().min(1).max(12).optional(),
    year: z.coerce.number().int().min(2020).max(2100).optional()
  })
});

export const adminCrefQueueQuerySchema = z.object({
  query: z.object({
    status: z.enum(["PENDING", "IN_REVIEW", "APPROVED", "REJECTED"]).optional(),
    take: z.coerce.number().int().min(1).max(200).optional()
  })
});

export const reviewProviderCrefSchema = z.object({
  params: z.object({
    providerId: z.string().uuid()
  }),
  body: z
    .object({
      decision: z.enum(["APPROVE", "REJECT"]),
      justification: z.string().trim().max(300).optional()
    })
    .refine((value) => (value.decision === "REJECT" ? Boolean(value.justification?.trim()) : true), {
      message: "Justificativa obrigatoria ao reprovar o CREF.",
      path: ["justification"]
    })
});

export const adminSupportQueueQuerySchema = z.object({
  query: z.object({
    status: z.enum(["OPEN", "ANSWERED"]).optional(),
    take: z.coerce.number().int().min(1).max(200).optional()
  })
});

export const adminSupportReplySchema = z.object({
  params: z.object({
    ticketId: z.string().uuid()
  }),
  body: z.object({
    responseMessage: z.string().trim().min(3).max(300)
  })
});

export const adminChatAuditSessionsQuerySchema = z.object({
  query: z.object({
    clientEmail: z.string().trim().email().optional(),
    providerEmail: z.string().trim().email().optional(),
    startedFrom: z.string().trim().min(10).max(40).optional(),
    startedTo: z.string().trim().min(10).max(40).optional(),
    take: z.coerce.number().int().min(1).max(50).optional(),
    cursor: z.string().trim().min(1).max(200).optional()
  })
});

export const adminChatAuditSessionMessagesSchema = z.object({
  params: z.object({
    bookingId: z.string().uuid()
  }),
  query: z.object({
    take: z.coerce.number().int().min(1).max(200).optional(),
    cursor: z.string().trim().min(1).max(200).optional()
  })
});

export const adminDataRetentionRunsQuerySchema = z.object({
  query: z.object({
    take: z.coerce.number().int().min(1).max(100).optional()
  })
});

export const adminRunDataRetentionSchema = z.object({
  body: z.object({
    dryRun: z.boolean().optional(),
    triggeredBy: z.string().trim().min(3).max(120).optional()
  })
});
