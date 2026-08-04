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
    take: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional()
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
    take: z.coerce.number().int().min(1).max(200).optional(),
    skip: z.coerce.number().int().min(0).optional(),
    q: z.string().trim().min(1).max(200).optional()
  })
});

export const adminSupportTicketDetailSchema = z.object({
  params: z.object({ ticketId: z.string().uuid() })
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
    clientEmail: z.string().trim().email().max(254).optional(),
    providerEmail: z.string().trim().email().max(254).optional(),
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
    triggeredBy: z.string().trim().min(3).max(120).optional(),
    legalHoldUserIds: z.array(z.string().uuid()).max(500).optional()
  })
});

const documentSchema = z
  .string()
  .trim()
  .regex(/^\d{11}$|^\d{3}\.\d{3}\.\d{3}-\d{2}$/, "CPF inválido.");

export const adminLookupCrefSchema = z.object({
  query: z.object({ providerDocument: documentSchema })
});

export const adminLookupChatsSchema = z.object({
  query: z.object({
    providerDocument: documentSchema,
    clientDocument: documentSchema
  })
});

export const adminLookupBookingsSchema = z.object({
  query: z.object({
    providerDocument: documentSchema,
    clientDocument: documentSchema,
    date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
      (d) => {
        const date = new Date(`${d}T12:00:00Z`);
        return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === d;
      },
      { message: "Data invalida (ex: 2024-02-30 nao existe)" }
    ).optional()
  })
});

export const adminLookupBookingDetailSchema = z.object({
  params: z.object({ bookingId: z.string().uuid() })
});

export const adminListDisputeCasesQuerySchema = z.object({
  query: z.object({
    status: z.enum(["OPEN", "RESOLVED"]).optional()
  })
});

export const adminDisputeCaseIdSchema = z.object({
  params: z.object({ caseId: z.string().uuid() })
});

export const adminResolveDisputeCaseSchema = z.object({
  params: z.object({ caseId: z.string().uuid() }),
  body: z.object({
    // "RETRY_CAPTURE" faltava aqui (Rodada 3, Lote 3): o schema nunca foi
    // atualizado quando essa resolução foi criada (Rodada 2, Lote 2), então
    // toda chamada real via API/mobile era rejeitada com 400 antes de
    // chegar no service — só não foi pego antes porque os testes chamam
    // disputeCaseService.resolveCase diretamente, sem passar pela validação.
    resolution: z.enum(["REFUNDED", "DENIED", "RETRY_CAPTURE"]),
    amountCents: z.coerce.number().int().positive().optional(),
    note: z.string().trim().min(5).max(500),
    chargeClientDebtCents: z.coerce.number().int().positive().optional()
  })
});

export const adminSuspendUserSchema = z.object({
  params: z.object({ userId: z.string().uuid() }),
  body: z.object({
    reason: z.string().trim().min(5).max(500)
  })
});

export const adminReactivateUserSchema = z.object({
  params: z.object({ userId: z.string().uuid() })
});

export const adminChangeUserRoleSchema = z.object({
  params: z.object({ userId: z.string().uuid() }),
  body: z.object({
    role: z.enum(["CLIENT", "PROVIDER"]),
    reason: z.string().trim().min(5).max(500)
  })
});

export const adminSetLegalHoldSchema = z.object({
  params: z.object({ userId: z.string().uuid() }),
  body: z.object({
    until: z.string().trim().min(10).max(40),
    reason: z.string().trim().min(5).max(500)
  })
});

export const adminClearLegalHoldSchema = z.object({
  params: z.object({ userId: z.string().uuid() })
});

export const adminExportUserDataSchema = z.object({
  params: z.object({ userId: z.string().uuid() })
});

export const adminSearchUsersSchema = z.object({
  query: z.object({
    q: z.string().trim().min(3).max(200),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    role: z.enum(["CLIENT", "PROVIDER", "ADMIN"]).optional(),
    suspended: z.enum(["true", "false"]).optional()
  })
});

export const adminUserDetailSchema = z.object({
  params: z.object({ userId: z.string().uuid() })
});

export const adminListDebtsQuerySchema = z.object({
  query: z.object({
    status: z.enum(["PENDING", "NOTIFIED", "PAID", "WRITTEN_OFF"]).optional(),
    skip: z.coerce.number().int().min(0).optional(),
    take: z.coerce.number().int().min(1).max(200).optional()
  })
});

// Raio-X de pagamentos, Rodada 4, Lote 7: única rota admin sem validate() —
// minStrikes chegava como Number(query.minStrikes) direto no controller,
// então um valor inválido virava NaN e silenciosamente filtrava a lista
// inteira pra vazia, em vez de rejeitar a requisição.
export const adminListNoShowReportsSchema = z.object({
  query: z.object({
    minStrikes: z.coerce.number().int().min(1).max(100).optional()
  })
});

export const adminListReportsSchema = z.object({
  query: z.object({
    status: z.enum(["PENDING", "DISMISSED", "ACTIONED"]).optional(),
    take: z.coerce.number().int().min(1).max(100).optional(),
    skip: z.coerce.number().int().min(0).optional()
  })
});

export const adminReportActionSchema = z.object({
  params: z.object({
    type: z.enum(["feed-post", "booking-message", "consultancy-message"]),
    id: z.string().uuid()
  })
});

export const adminWriteOffDebtSchema = z.object({
  params: z.object({ debtId: z.string().uuid() }),
  body: z.object({
    reason: z.string().trim().min(5).max(500)
  })
});
