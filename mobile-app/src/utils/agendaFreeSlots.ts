import { Availability, Booking, FinancialStudent, WeeklyScheduleSlot } from "../services/api/client";

export type ManualBlockRange = { dateKey: string; startTime: string; endTime: string };
export type OffAppClass = { studentName: string; startTime: string; endTime: string; location?: string };

export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

export function formatMinutes(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, totalMinutes));
  return `${Math.floor(clamped / 60).toString().padStart(2, "0")}:${(clamped % 60).toString().padStart(2, "0")}`;
}

// Slots de 30min gerados a partir das janelas de disponibilidade recorrente
// (Availability) do profissional pro dia da semana informado.
export function generateDaySlots(availabilities: Availability[], weekday: number): string[] {
  const slotSet = new Set<string>();
  availabilities
    .filter((item) => item.isActive && item.weekday === weekday)
    .forEach((item) => {
      const start = parseMinutes(item.startTime);
      const end = parseMinutes(item.endTime);
      if (end <= start) return;
      for (let minute = start; minute < end; minute += 30) slotSet.add(formatMinutes(minute));
    });
  return Array.from(slotSet).sort((a, b) => a.localeCompare(b));
}

// Slots ocupados por agendamentos (PENDING/CONFIRMED) do app na data informada.
export function computeOccupiedByBookings(bookings: Booking[], date: Date): Set<string> {
  const targetKey = toDateKey(date);
  const taken = new Set<string>();
  bookings.forEach((item) => {
    if (item.status !== "PENDING" && item.status !== "CONFIRMED") return;
    const d = new Date(item.scheduledAt);
    if (toDateKey(d) !== targetKey) return;
    taken.add(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
  });
  return taken;
}

// Slots dentro de algum bloqueio manual (ManualBlock) na data informada.
export function computeBlockedByManualBlocks(
  manualBlocks: ManualBlockRange[],
  dateKey: string,
  allDaySlots: string[]
): Set<string> {
  const todayBlocks = manualBlocks.filter((b) => b.dateKey === dateKey);
  if (todayBlocks.length === 0) return new Set<string>();
  const blocked = new Set<string>();
  allDaySlots.forEach((slot) => {
    const slotMin = parseMinutes(slot);
    if (todayBlocks.some((b) => slotMin >= parseMinutes(b.startTime) && slotMin < parseMinutes(b.endTime))) {
      blocked.add(slot);
    }
  });
  return blocked;
}

// Aulas de alunos presenciais fora do app (cadastrados no Financeiro com
// horario fixo semanal) que caem na data informada — respeita o periodo em
// que o aluno esta de fato ativo (startDate/recurrenceEndDate).
export function computeOffAppClassesForDay(offAppStudents: FinancialStudent[], date: Date): OffAppClass[] {
  const dayOfWeek = date.getDay();
  const selectedKey = toDateKey(date);
  const classes: OffAppClass[] = [];
  offAppStudents
    .filter(
      (s) =>
        s.isActive &&
        (s.type === "PRESENTIAL" || s.type === "BOTH") &&
        Array.isArray(s.weeklySchedule) &&
        (s.weeklySchedule as WeeklyScheduleSlot[]).length > 0
    )
    .forEach((student) => {
      const startKey = toDateKey(new Date(student.startDate));
      if (selectedKey < startKey) return;
      if (student.recurrenceEndDate) {
        const endKey = toDateKey(new Date(student.recurrenceEndDate));
        if (selectedKey > endKey) return;
      }
      (student.weeklySchedule as WeeklyScheduleSlot[]).forEach((slot) => {
        if (slot.dayOfWeek === dayOfWeek) {
          classes.push({ studentName: student.name, startTime: slot.startTime, endTime: slot.endTime, location: student.location ?? undefined });
        }
      });
    });
  return classes.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export function computeOffAppOccupiedKeys(classes: OffAppClass[], allDaySlots: string[]): Set<string> {
  if (classes.length === 0) return new Set<string>();
  const occupied = new Set<string>();
  allDaySlots.forEach((slot) => {
    const slotMin = parseMinutes(slot);
    if (classes.some((cls) => slotMin >= parseMinutes(cls.startTime) && slotMin < parseMinutes(cls.endTime))) {
      occupied.add(slot);
    }
  });
  return occupied;
}

// Lista final de horarios livres de verdade pro dia informado — janela de
// disponibilidade menos agendamentos, bloqueios manuais e aulas de alunos
// fora do app. Fonte unica usada tanto pela Agenda quanto pela Home, pra
// os dois nunca mostrarem numeros diferentes pra mesma pergunta.
export function computeFreeSlotsForDay(params: {
  availabilities: Availability[];
  bookings: Booking[];
  manualBlocks: ManualBlockRange[];
  offAppStudents: FinancialStudent[];
  date: Date;
}): string[] {
  const { availabilities, bookings, manualBlocks, offAppStudents, date } = params;
  const allDaySlots = generateDaySlots(availabilities, date.getDay());
  const occupied = computeOccupiedByBookings(bookings, date);
  const blocked = computeBlockedByManualBlocks(manualBlocks, toDateKey(date), allDaySlots);
  const offAppClasses = computeOffAppClassesForDay(offAppStudents, date);
  const offAppOccupied = computeOffAppOccupiedKeys(offAppClasses, allDaySlots);
  return allDaySlots.filter((s) => !occupied.has(s) && !blocked.has(s) && !offAppOccupied.has(s));
}
