import { z } from "zod";
export const createReviewSchema = z.object({
  body: z.object({
    bookingId: z.string().uuid(),
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().min(1).max(500).optional()
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
