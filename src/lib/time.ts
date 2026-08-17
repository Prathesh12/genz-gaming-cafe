/**
 * Timezone-aware helpers.
 *
 * The cafe operates in a single timezone (configurable in Settings, default
 * Asia/Kolkata). "Today", report ranges and the night-gaming band are all
 * evaluated in that zone, while every timestamp is stored in UTC.
 */

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

export type ZonedParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

/** Break an instant into calendar parts as seen in `timeZone`. */
export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = getFormatter(timeZone).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    // Intl can emit "24" for midnight in some environments.
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Offset of `timeZone` from UTC at `date`, in milliseconds. */
export function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const p = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Build the UTC instant for a wall-clock time in `timeZone`.
 * Iterates twice so DST transitions resolve correctly.
 */
export function zonedTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
  second = 0,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  let result = new Date(naive - getTimeZoneOffsetMs(new Date(naive), timeZone));
  result = new Date(naive - getTimeZoneOffsetMs(result, timeZone));
  return result;
}

/** Midnight (00:00) of the local day containing `date`. */
export function startOfDayInZone(date: Date, timeZone: string): Date {
  const p = getZonedParts(date, timeZone);
  return zonedTimeToUtc(p.year, p.month, p.day, 0, 0, timeZone);
}

/** Midnight at the start of the *next* local day. */
export function endOfDayInZone(date: Date, timeZone: string): Date {
  const start = startOfDayInZone(date, timeZone);
  return addDaysInZone(start, 1, timeZone);
}

/** Add whole local days, preserving wall-clock time across DST. */
export function addDaysInZone(date: Date, days: number, timeZone: string): Date {
  const p = getZonedParts(date, timeZone);
  return zonedTimeToUtc(p.year, p.month, p.day + days, p.hour, p.minute, timeZone, p.second);
}

/** Minutes elapsed since local midnight. */
export function minutesOfDay(date: Date, timeZone: string): number {
  const p = getZonedParts(date, timeZone);
  return p.hour * 60 + p.minute;
}

/** "23:30" -> 1410. Throws on malformed input. */
export function parseHHmm(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`Invalid time "${value}", expected HH:mm`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Invalid time "${value}"`);
  return hours * 60 + minutes;
}

/** 1410 -> "23:30" */
export function formatHHmm(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "2026-08-14" for the local day containing `date`. */
export function toDateKey(date: Date, timeZone: string): string {
  const p = getZonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Parse "2026-08-14" as local midnight in `timeZone`. */
export function fromDateKey(key: string, timeZone: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return zonedTimeToUtc(y, m, d, 0, 0, timeZone);
}

/** 9045 seconds -> "02:30:45" */
export function formatDurationHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  return [hours, minutes, seconds].map((n) => String(n).padStart(2, "0")).join(":");
}

/** 155 minutes -> "2h 35m" */
export function formatDurationHuman(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(m / 60);
  const minutes = m % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
