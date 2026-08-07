import { z } from "zod";
import { env } from "../../../../config/env";
import { toDateKeyInTimezone } from "../../../../shared/utils/timezone";

export const manualBlockIdSchema = z.object({
  params: z.object({ blockId: z.string().uuid() })
});

// Frente 5 (Descoberta, agendamento e agenda), Lote 6: usava
// new Date().toISOString(), sempre UTC — entre ~21h e 23:59 no horário de
// Brasília, o dia em UTC já virou o seguinte, rejeitando "hoje" como se
// fosse passado.
function todayKeyInAppTimezone(): string {
  return toDateKeyInTimezone(new Date(), env.APP_TIMEZONE);
}

export const createManualBlockSchema = z.object({
  body: z.object({
    date: z.string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato YYYY-MM-DD.")
      .refine((d) => {
        return d >= todayKeyInAppTimezone();
      }, "Data deve ser hoje ou no futuro."),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, "startTime deve estar no formato HH:MM."),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, "endTime deve estar no formato HH:MM."),
    label: z.string().min(1).max(100).default("Bloqueado"),
    location: z.string().max(200).optional(),
  }),
});
