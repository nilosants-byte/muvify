// Frente 4 (segunda camada), Lote 3: checagem de sobreposição entre uma
// sessão (início + duração) e um intervalo bloqueado (início/fim) — extraída
// pra cá porque o mesmo bug (comparar só o instante de início, ignorando a
// duração da sessão) se repetia em 3 lugares diferentes: geração de horários
// livres (provider.service.ts), validação de criação de agendamento
// (booking.service.ts) e validação de criação de bloqueio manual
// (manual-block.service.ts). Os limites são estritos de propósito, pra
// permitir sessões/bloqueios encostados (um termina exatamente quando o
// outro começa).

export function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map((v) => Number(v));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

export function formatMinutesToTime(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, totalMinutes));
  const h = Math.floor(clamped / 60).toString().padStart(2, "0");
  const m = (clamped % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

/** Uma sessão de `durationMinutes` começando em `startTime` (HH:MM) invade o intervalo [rangeStart, rangeEnd) (HH:MM)? */
export function sessionOverlapsRange(
  startTime: string,
  durationMinutes: number,
  rangeStart: string,
  rangeEnd: string
): boolean {
  const sessionStart = parseTimeToMinutes(startTime);
  const sessionEnd = sessionStart + durationMinutes;
  const rStart = parseTimeToMinutes(rangeStart);
  const rEnd = parseTimeToMinutes(rangeEnd);
  return sessionStart < rEnd && sessionEnd > rStart;
}

// Frente 6 (segunda camada), Lote 14: uma sessão que começa perto da meia-
// noite (ex: 23:30 com 60min de duração) "vaza" pros primeiros minutos do
// dia seguinte — as checagens de conflito são todas por dia calendário
// isolado, então esses minutos nunca eram cruzados contra bloqueios/
// agendamentos do dia seguinte. Retorna quantos minutos do dia seguinte
// essa sessão ocupa (0 se não atravessa a meia-noite).
export function sessionOverflowIntoNextDayMinutes(startTime: string, durationMinutes: number): number {
  const sessionEnd = parseTimeToMinutes(startTime) + durationMinutes;
  return Math.max(0, sessionEnd - 24 * 60);
}
