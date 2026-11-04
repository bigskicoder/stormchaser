/**
 * Natural base depth for the public site, read from snowpack_daily (written
 * every 6 hours by /api/cron/snowpack; see lib/snowpack/). Anon client,
 * like the rest of lib/public: snowpack_daily has a public read policy.
 *
 * Only resorts the model runs for have rows: those whose fit clears the
 * accuracy bar (calibrated) and those with no reference station (standard
 * settings, labeled uncalibrated). Resorts with a station that miss the bar
 * have none, so the site shows nothing for them (the plan's rule, a wrong
 * base is worse than none).
 */

import { getAnonDb } from "@/lib/db/client";
import { addCalendarDays } from "@/lib/utils/timezone";

export interface NaturalBase {
  /** Modeled natural snow depth today at mid-mountain, inches. */
  todayIn: number;
  /** Change since 7 days ago, inches (null when that day isn't stored). */
  pastWeekChangeIn: number | null;
  /** Projected depth on the last projected day, inches, and that date. */
  projectedIn: number | null;
  projectedDate: string | null;
  /** Water in the pack today, inches. */
  sweIn: number;
  /** True when fitted to and checked against the resort's snow station. */
  calibrated: boolean;
  /** Latest snow depth the station measured (last 3 days), inches. */
  stationDepthIn: number | null;
}

interface DailyRow {
  date: string;
  depth_in: number;
  swe_mm: number;
  calibrated: boolean;
}

/** Pure: today's figures from a resort's snowpack_daily rows. Null when today isn't modeled. */
export function summarizeNaturalBase(rows: DailyRow[], todayIso: string, stationDepthIn: number | null): NaturalBase | null {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const today = byDate.get(todayIso);
  if (!today) return null;
  const weekAgo = byDate.get(addCalendarDays(todayIso, -7));
  const future = rows.filter((r) => r.date > todayIso).sort((a, b) => a.date.localeCompare(b.date));
  const last = future[future.length - 1] ?? null;
  return {
    todayIn: Number(today.depth_in),
    pastWeekChangeIn: weekAgo ? Number(today.depth_in) - Number(weekAgo.depth_in) : null,
    projectedIn: last ? Number(last.depth_in) : null,
    projectedDate: last?.date ?? null,
    sweIn: Number(today.swe_mm) / 25.4,
    calibrated: today.calibrated,
    stationDepthIn,
  };
}

export async function getNaturalBase(resortId: string, todayIso: string, hasStation: boolean): Promise<NaturalBase | null> {
  const db = getAnonDb();
  const { data, error } = await db
    .from("snowpack_daily")
    .select("date, depth_in, swe_mm, calibrated")
    .eq("resort_id", resortId)
    .gte("date", addCalendarDays(todayIso, -7))
    .order("date");
  if (error) throw error;
  let stationDepthIn: number | null = null;
  if (hasStation) {
    const { data: st, error: stError } = await db
      .from("snotel_actuals")
      .select("date, snow_depth_in")
      .eq("resort_id", resortId)
      .gte("date", addCalendarDays(todayIso, -3))
      .not("snow_depth_in", "is", null)
      .order("date", { ascending: false })
      .limit(1);
    if (stError) throw stError;
    const v = (st ?? [])[0] as { snow_depth_in: number } | undefined;
    stationDepthIn = v ? Number(v.snow_depth_in) : null;
  }
  return summarizeNaturalBase((data ?? []) as DailyRow[], todayIso, stationDepthIn);
}

/** Today's base for every resort with one, keyed by resort id; callers pick each resort's own local date. */
export async function getNaturalBaseByResort(dates: string[]): Promise<Map<string, Map<string, { depthIn: number; calibrated: boolean }>>> {
  const db = getAnonDb();
  const { data, error } = await db
    .from("snowpack_daily")
    .select("resort_id, date, depth_in, calibrated")
    .in("date", dates)
    .range(0, 4999);
  if (error) throw error;
  const out = new Map<string, Map<string, { depthIn: number; calibrated: boolean }>>();
  for (const r of (data ?? []) as Array<{ resort_id: string; date: string; depth_in: number; calibrated: boolean }>) {
    const m = out.get(r.resort_id) ?? new Map();
    m.set(r.date, { depthIn: Number(r.depth_in), calibrated: r.calibrated });
    out.set(r.resort_id, m);
  }
  return out;
}
