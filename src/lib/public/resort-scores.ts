/**
 * Public-site data access. Deliberately uses the anon Supabase client (RLS
 * policies in supabase/migrations/0002_rls.sql), not the service-role
 * client — the public site must only ever see what an unauthenticated
 * visitor is allowed to see, per section 10.5 (no paywall on core
 * transparency surface).
 */

import { getAnonDb } from "@/lib/db/client";
import type { Resort, SnotelActual, SnowScore } from "@/lib/db/types";
import { addCalendarDays, localTodayIso } from "@/lib/utils/timezone";

export interface ResortWithScore {
  resort: Resort;
  bestUpcomingScore: SnowScore | null;
}

/** Trailing window (days) shown in the "snowfall in the past week" chart. */
const PAST_WEEK_WINDOW_DAYS = 7;

/**
 * For each active resort, the single best-scoring upcoming day currently
 * on the books.
 *
 * BUG FIXED (found by code review): originally queried snow_scores
 * ordered by powder_score DESC first, computed_at DESC only as a
 * tiebreaker, filtered only to target_date >= today. That could surface a
 * stale, since-superseded score for a date that's still upcoming — e.g. a
 * date scored 0.9 five days out, then correctly revised down to 0.3 as
 * the storm's forecast changed, would still show the old 0.9 forever
 * (the same root-cause pattern as the alert-trigger bug in
 * lib/alerts/trigger.ts, fixed the same way: dedupe to the latest
 * computed_at per target_date first, then pick the best among those
 * current assessments).
 */
export async function getResortsWithBestUpcomingScore(): Promise<ResortWithScore[]> {
  const db = getAnonDb();

  const { data: resorts, error: resortsError } = await db
    .from("resorts")
    .select("*")
    .eq("active", true)
    .order("name");
  if (resortsError) throw resortsError;

  const results: ResortWithScore[] = [];
  for (const resort of (resorts ?? []) as Resort[]) {
    const upcomingScores = await getUpcomingScoresForResort(resort.id, resort.timezone);
    const best = upcomingScores.reduce<SnowScore | null>(
      (max, row) => (!max || row.powder_score > max.powder_score ? row : max),
      null
    );
    results.push({ resort, bestUpcomingScore: best });
  }

  return results;
}

export async function getResortBySlug(slug: string): Promise<Resort | null> {
  const db = getAnonDb();
  const { data, error } = await db.from("resorts").select("*").eq("slug", slug).eq("active", true).maybeSingle();
  if (error) throw error;
  return (data as Resort | null) ?? null;
}

/**
 * BUG FIXED (found while building the resort detail page's "today"/
 * "next 5 days" visuals, same class as the run.ts nextNDates fix): this
 * used `new Date().toISOString().slice(0, 10)` — UTC's calendar date, not
 * the resort's local one. For a US resort during the multi-hour window
 * each evening/early-morning where UTC has already rolled to tomorrow but
 * the resort's local clock hasn't, `target_date >= today` would exclude
 * today's own row from "upcoming," since its date string compares as
 * "less than" the (already-tomorrow) UTC cutoff. Fixed by resolving
 * "today" from the resort's own timezone.
 */
export async function getUpcomingScoresForResort(resortId: string, timeZone: string): Promise<SnowScore[]> {
  const db = getAnonDb();
  const today = localTodayIso(timeZone);

  const { data, error } = await db
    .from("snow_scores")
    .select("*")
    .eq("resort_id", resortId)
    .gte("target_date", today)
    .order("target_date", { ascending: true })
    .order("computed_at", { ascending: false });
  if (error) throw error;

  // Keep only the most-recently-computed row per target_date.
  const latestPerDate = new Map<string, SnowScore>();
  for (const row of (data ?? []) as SnowScore[]) {
    if (!latestPerDate.has(row.target_date)) latestPerDate.set(row.target_date, row);
  }
  return Array.from(latestPerDate.values());
}

/**
 * Trailing PAST_WEEK_WINDOW_DAYS of observed ground-truth snowfall (from
 * SNOTEL snow-depth deltas — see lib/ingestion/snotel.ts), ending at the
 * resort's local today. Returns one row per date that has data; a resort
 * with no nearby SNOTEL station (common outside the western US — see
 * lib/ingestion/snotel.ts) simply returns an empty array, which the chart
 * component renders as "no station coverage" rather than fabricating zeros.
 */
export async function getPastWeekSnowfall(resortId: string, timeZone: string): Promise<SnotelActual[]> {
  const db = getAnonDb();
  const today = localTodayIso(timeZone);
  const since = addCalendarDays(today, -PAST_WEEK_WINDOW_DAYS);

  const { data, error } = await db
    .from("snotel_actuals")
    .select("*")
    .eq("resort_id", resortId)
    .gte("date", since)
    .lte("date", today)
    .order("date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SnotelActual[];
}
