import { z } from "zod";
// Frente 9 (segunda camada), Lote 4: avaliação passa a aceitar booking
// presencial OU contrato de consultoria online - exatamente um dos dois,
// nunca os dois nem nenhum.
export const createReviewSchema = z.object({
  body: z
    .object({
      bookingId: z.string().uuid().optional(),
      contractId: z.string().uuid().optional(),
      rating: z.number().int().min(1).max(5),
      comment: z.string().trim().min(1).max(500).optional()
    })
    .refine((body) => Boolean(body.bookingId) !== Boolean(body.contractId), {
      message: "Informe exatamente um agendamento ou contrato de consultoria para avaliar, não os dois.",
      path: ["bookingId"]
    })
});

export const respondToReviewSchema = z.object({
  params: z.object({
    reviewId: z.string().uuid()
  }),
  body: z.object({
    response: z.string().trim().min(1).max(500)
  })
});
