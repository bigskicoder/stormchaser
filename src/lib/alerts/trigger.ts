/**
 * Alert trigger logic (BUILD_PRIMER section 7). Fires when powder_score
 * crosses ALERT_POWDER_SCORE_THRESHOLD for any active resort, rate-limited
 * to one alert per resort per ALERT_RATE_LIMIT_HOURS_PER_RESORT hours even
 * if the score fluctuates above threshold repeatedly intraday.
 */

import { getServiceDb } from "@/lib/db/client";
import { ALERT_POWDER_SCORE_THRESHOLD, ALERT_RATE_LIMIT_HOURS_PER_RESORT } from "@/lib/config/constants";
import type { Resort, SnowScore } from "@/lib/db/types";

export interface TriggerCandidate {
  resort: Resort;
  snowScore: SnowScore;
}

/**
 * Picks the resort's best CURRENT assessment that qualifies, from an
 * already-fetched set of snow_scores rows (any target_date, any
 * computed_at — filtering/sorting happens here, not in the caller's
 * query, so this stays a pure, independently testable function; see
 * tests/alerts/trigger.test.ts).
 *
 * BUG FIXED (found by code review, not a WebSearch finding): the original
 * version here queried ALL snow_scores rows ever recorded for this resort
 * (no target_date filter at all) and ordered by powder_score DESC first,
 * computed_at DESC only as a tiebreaker. That means it would find
 * whichever row had the single highest powder_score in the resort's
 * entire history — including a target_date that has already passed, and
 * including a since-superseded, lower, more-accurate re-forecast for that
 * same date. Combined with the 24h rate limit resetting on its own, this
 * would have re-fired an alert for the same long-past storm indefinitely,
 * forever, every 24 hours, as long as the system ran — breaking the core
 * alerting feature outright. Fixed: only considers target_date >= today,
 * dedupes to the LATEST computed_at per target_date first (so a stale
 * optimistic score can never outrank its own later correction), and only
 * then picks the highest-scoring one among those current assessments.
 */
export function selectCurrentBestQualifyingScore(
  scores: SnowScore[],
  todayIso: string,
  threshold: number
): SnowScore | null {
  const upcoming = scores.filter((row) => row.target_date >= todayIso);
  const sorted = [...upcoming].sort((a, b) => new Date(b.computed_at).getTime() - new Date(a.computed_at).getTime());

  const latestPerDate = new Map<string, SnowScore>();
  for (const row of sorted) {
    if (!latestPerDate.has(row.target_date)) latestPerDate.set(row.target_date, row);
  }

  let best: SnowScore | null = null;
  for (const row of latestPerDate.values()) {
    if (row.powder_score >= threshold && (!best || row.powder_score > best.powder_score)) {
      best = row;
    }
  }
  return best;
}

async function currentBestQualifyingScore(resortId: string): Promise<SnowScore | null> {
  const db = getServiceDb();
  const today = new Date().toISOString().slice(0, 10);
  // Performance/cost bound only, not a correctness one: any row relevant
  // to an upcoming target_date will always have been computed_at within
  // the scoring horizon (section 5: ~10 days), so 30 days back is a
  // generous cap that never excludes a row selectCurrentBestQualifyingScore
  // would otherwise have picked.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // The actual filtering/dedup (target_date >= today, latest-per-date)
  // happens in selectCurrentBestQualifyingScore, not this query, so that
  // logic stays pure and testable.
  const { data, error } = await db
    .from("snow_scores")
    .select("*")
    .eq("resort_id", resortId)
    .gte("computed_at", since);
  if (error) throw error;

  return selectCurrentBestQualifyingScore((data ?? []) as SnowScore[], today, ALERT_POWDER_SCORE_THRESHOLD);
}

async function wasRecentlyAlerted(resortId: string): Promise<boolean> {
  const db = getServiceDb();
  const since = new Date(Date.now() - ALERT_RATE_LIMIT_HOURS_PER_RESORT * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("alerts_fired")
    .select("id")
    .eq("resort_id", resortId)
    .gte("fired_at", since)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** Finds every active resort currently qualifying for an alert that hasn't been rate-limited. */
export async function findTriggerCandidates(): Promise<TriggerCandidate[]> {
  const db = getServiceDb();
  const { data: resorts, error } = await db.from("resorts").select("*").eq("active", true);
  if (error) throw error;

  const candidates: TriggerCandidate[] = [];
  for (const resort of (resorts ?? []) as Resort[]) {
    const snowScore = await currentBestQualifyingScore(resort.id);
    if (!snowScore) continue;
    if (await wasRecentlyAlerted(resort.id)) continue;
    candidates.push({ resort, snowScore });
  }
  return candidates;
}
