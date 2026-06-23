import { z } from "zod";

export const uploadMediaSchema = z.object({
  body: z.object({
    dataUri: z
      .string()
      .min(1)
      .max(60_000_000)
      .regex(
        /^data:(image\/(jpeg|jpg|png|webp|gif)|video\/(mp4|quicktime|webm|3gpp)|application\/pdf);base64,[a-zA-Z0-9+/=]+$/,
        "Formato de mídia inválido. Use JPEG, PNG, WEBP, GIF, MP4, MOV, WebM, 3GP ou PDF."
      ),
    folder: z.enum([
      "profile-photos",
      "presentation-videos",
      "feed-photos",
      "cref-documents",
      "attendance-proofs",
      "exercise-media"
    ])
  })
});
