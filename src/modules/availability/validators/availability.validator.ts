import { z } from "zod";

export const availabilityIdSchema = z.object({
  params: z.object({ availabilityId: z.string().uuid() }),
  query: z.object({ force: z.enum(["true", "false"]).optional() }).optional()
});

const timeString = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .refine((t) => {
    const [h, m] = t.split(":").map(Number);
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  }, "Horário inválido (use HH:MM entre 00:00 e 23:59)");

// Frente 5 (Descoberta, agendamento e agenda), Lote 11: nenhuma validação
// de duração mínima/máxima de slot — uma janela de 5 minutos (ou de 20h)
// passava sem aviso nenhum.
const MIN_AVAILABILITY_MINUTES = 30;
const MAX_AVAILABILITY_MINUTES = 12 * 60;

export const createAvailabilitySchema = z.object({
  body: z
    .object({
      weekday: z.number().int().min(0).max(6),
      startTime: timeString,
      endTime: timeString,
      isActive: z.boolean().optional(),
    })
    .superRefine((data, ctx) => {
      if (data.startTime >= data.endTime) {
        ctx.addIssue({
          code: "custom",
          path: ["endTime"],
          message: "O horário final deve ser posterior ao inicial.",
        });
        return;
      }
      const [startH, startM] = data.startTime.split(":").map(Number);
      const [endH, endM] = data.endTime.split(":").map(Number);
      const durationMinutes = (endH * 60 + endM) - (startH * 60 + startM);
      if (durationMinutes < MIN_AVAILABILITY_MINUTES) {
        ctx.addIssue({
          code: "custom",
          path: ["endTime"],
          message: `A janela de disponibilidade deve ter pelo menos ${MIN_AVAILABILITY_MINUTES} minutos.`,
        });
      } else if (durationMinutes > MAX_AVAILABILITY_MINUTES) {
        ctx.addIssue({
          code: "custom",
          path: ["endTime"],
          message: "A janela de disponibilidade não pode ultrapassar 12 horas.",
        });
      }
    }),
});
