import { env } from "../../src/config/env";
import { toDateKeyInTimezone } from "../../src/shared/utils/timezone";

// "HH:MM naquele dia, no fuso do app". setHours() usa o fuso do processo, que no CI
// e no servidor é UTC, e aí "10:15" virava 07:15 em Brasília.
export function atAppTime(day: Date, hours: number, minutes = 0): Date {
  const [year, month, date] = toDateKeyInTimezone(day, env.APP_TIMEZONE).split("-").map(Number);
  const asIfUtc = Date.UTC(year, month - 1, date, hours, minutes);
  return new Date(asIfUtc - appOffsetMinutes(new Date(asIfUtc)) * 60_000);
}

function appOffsetMinutes(at: Date): number {
  const label = new Intl.DateTimeFormat("en-US", { timeZone: env.APP_TIMEZONE, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(label);
  if (!match) return 0;
  const total = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -total : total;
}
