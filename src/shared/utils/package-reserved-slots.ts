import { Prisma, PrismaClient } from "@prisma/client";
import { formatMinutesToTime, parseTimeToMinutes } from "./time-range";
import { toDateKeyInTimezone } from "./timezone";

// Achado no teste manual do checklist (C6.3, 19/10/2026): o horário semanal
// de um pacote de horário fixo não ficava reservado — outro aluno marcava
// uma aula avulsa nele e, quando o ciclo gerava as aulas do pacote, a
// ocorrência em conflito era pulada em silêncio (no Pix o ciclo já estava
// pago inteiro). Decisão do Danilo: enquanto o pacote estiver ativo, aquele
// dia/horário fica reservado — mesmo tratamento que já existia pros alunos
// de fora do app com horário fixo (FinancialStudent.weeklySchedule).

const RESERVING_STATUSES = ["PENDING_PAYMENT", "ACTIVE", "PAST_DUE"] as const;

export type ReservedPackageSlot = {
  packageId: string;
  clientId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  // Janela em que a reserva vale (chaves YYYY-MM-DD no fuso do app).
  fromKey: string;
  untilKey: string | null;
};

type Db = PrismaClient | Prisma.TransactionClient;

export async function findReservedPackageSlots(
  db: Db,
  providerId: string,
  sessionDurationMinutes: number,
  timeZone: string,
  opts: { excludeClientId?: string } = {}
): Promise<ReservedPackageSlot[]> {
  const packages = await db.presentialPackage.findMany({
    where: {
      providerId,
      mode: "FIXED_RECURRING",
      status: { in: [...RESERVING_STATUSES] },
      ...(opts.excludeClientId ? { NOT: { clientId: opts.excludeClientId } } : {})
    },
    select: { id: true, clientId: true, weeklySchedule: true, validFrom: true, validUntil: true, createdAt: true }
  });
  const slots: ReservedPackageSlot[] = [];
  for (const pkg of packages) {
    const schedule = Array.isArray(pkg.weeklySchedule)
      ? (pkg.weeklySchedule as unknown as Array<{ weekday: number; time: string }>)
      : [];
    for (const entry of schedule) {
      slots.push({
        packageId: pkg.id,
        clientId: pkg.clientId,
        weekday: entry.weekday,
        startTime: entry.time,
        endTime: formatMinutesToTime(parseTimeToMinutes(entry.time) + sessionDurationMinutes),
        fromKey: toDateKeyInTimezone(pkg.validFrom ?? pkg.createdAt, timeZone),
        untilKey: pkg.validUntil ? toDateKeyInTimezone(pkg.validUntil, timeZone) : null
      });
    }
  }
  return slots;
}

// A reserva vale nesse dia (chave YYYY-MM-DD, dia da semana no fuso do app)?
export function reservedSlotAppliesOn(slot: ReservedPackageSlot, dateKey: string, weekday: number): boolean {
  if (slot.weekday !== weekday) return false;
  if (dateKey < slot.fromKey) return false;
  if (slot.untilKey && dateKey > slot.untilKey) return false;
  return true;
}
