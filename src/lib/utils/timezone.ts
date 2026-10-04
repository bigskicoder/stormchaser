/**
 * Timezone-aware local calendar-day boundaries, dependency-free (built on
 * the native Intl API rather than pulling in date-fns-tz/luxon for one
 * function). Used by lib/scoring/aggregate.ts: forecast_pulls/ensemble_pulls
 * are stored with UTC valid_time values, but a resort's "ski day" boundary
 * is its LOCAL midnight, not UTC midnight — every resort in this codebase's
 * seed data is in a US timezone 5-8 hours behind UTC, so using UTC calendar
 * days instead would shift every scored day's forecast_pulls window by
 * that many hours, misattributing overnight snowfall between adjacent days
 * for every single resort, every single day.
 */

/** Adds `days` calendar days to a YYYY-MM-DD date string (no timezone involved — pure calendar-date arithmetic). */
export function addCalendarDays(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** The UTC-vs-local offset (in minutes, positive = local is ahead of UTC) that `timeZone` has at the instant `utcMs`. */
function offsetMinutesAt(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // Reinterpret the local wall-clock reading as if it were itself a UTC
  // timestamp, so subtracting the real UTC instant yields the offset.
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return (asUtc - utcMs) / 60000;
}

/** The UTC instant corresponding to local midnight on `dateIso` in `timeZone`. */
function localMidnightToUtcMs(dateIso: string, timeZone: string): number {
  const naiveUtcMs = Date.parse(`${dateIso}T00:00:00Z`);
  const offset1 = offsetMinutesAt(naiveUtcMs, timeZone);
  const candidate = naiveUtcMs - offset1 * 60000;
  // Re-check right at the candidate instant in case the naive guess landed
  // on the wrong side of a DST transition — correct once more if so.
  const offset2 = offsetMinutesAt(candidate, timeZone);
  return offset2 === offset1 ? candidate : naiveUtcMs - offset2 * 60000;
}

/**
 * The [start, end) UTC instant range spanning local midnight on `dateIso`
 * through local midnight the next day, in `timeZone`. Deliberately computes
 * each boundary independently (not start + 24h) so DST transition days
 * correctly produce a 23h or 25h range rather than a wrong 24h one.
 */
export function localDateRangeToUtc(dateIso: string, timeZone: string): { start: string; end: string } {
  const startMs = localMidnightToUtcMs(dateIso, timeZone);
  const endMs = localMidnightToUtcMs(addCalendarDays(dateIso, 1), timeZone);
  return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() };
}

/** The resort's current local calendar date (YYYY-MM-DD) — convenience wrapper around utcInstantToLocalDateIso for "what day is it right now, locally." */
export function localTodayIso(timeZone: string, now: Date = new Date()): string {
  return utcInstantToLocalDateIso(now.getTime(), timeZone);
}

/** The local calendar date (YYYY-MM-DD) that a UTC instant falls on in `timeZone`. */
export function utcInstantToLocalDateIso(utcMs: number, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The [start, end) UTC-ms range of the local calendar day that `utcMs` falls within, in `timeZone`. */
export function localDayBoundsContaining(utcMs: number, timeZone: string): { startMs: number; endMs: number } {
  const dateIso = utcInstantToLocalDateIso(utcMs, timeZone);
  const { start, end } = localDateRangeToUtc(dateIso, timeZone);
  return { startMs: new Date(start).getTime(), endMs: new Date(end).getTime() };
}
