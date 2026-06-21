import { z } from "zod";
export const createReviewSchema = z.object({
  body: z.object({
    bookingId: z.string().uuid(),
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().min(1).max(500).optional()
  })
});
