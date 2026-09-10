import { z } from "zod";

export const uploadMediaSchema = z.object({
  body: z.object({
    folder: z.enum([
      "profile-photos",
      "presentation-videos",
      "presentation-video-thumbnails",
      "feed-photos",
      "cref-documents",
      "attendance-proofs",
      "exercise-media"
    ])
  })
});
