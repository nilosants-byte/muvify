// Frente 5 (segunda camada), Lote 11: existiam quatro cópias separadas do
// mesmo utilitário de "hora/data/dia da semana num fuso horário"
// (provider.service.ts, manual-block.service.ts, availability.service.ts,
// booking.service.ts) — duas delas (availability.service.ts,
// booking.service.ts) usando a técnica mais frágil de
// `new Date(date.toLocaleString("en-US", { timeZone }))`, que depende de
// parsing de uma string localizada em vez da API estruturada. Consolidado
// aqui, usando sempre Intl.DateTimeFormat (padrão que as outras duas
// cópias já tinham migrado pra usar).

export function toDateKeyInTimezone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function toTimeInTimezone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

const WEEKDAY_SHORT_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

export function toWeekdayInTimezone(date: Date, timeZone: string): number {
  const short = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  return WEEKDAY_SHORT_TO_INDEX[short] ?? 0;
}
