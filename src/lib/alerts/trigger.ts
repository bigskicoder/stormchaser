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

async function mostRecentQualifyingScorePerResort(resortId: string): Promise<SnowScore | null> {
  const db = getServiceDb();
  const { data, error } = await db
    .from("snow_scores")
    .select("*")
    .eq("resort_id", resortId)
    .gte("powder_score", ALERT_POWDER_SCORE_THRESHOLD)
    .order("powder_score", { ascending: false })
    .order("computed_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data ?? [])[0] as SnowScore | undefined ?? null;
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
    const snowScore = await mostRecentQualifyingScorePerResort(resort.id);
    if (!snowScore) continue;
    if (await wasRecentlyAlerted(resort.id)) continue;
    candidates.push({ resort, snowScore });
  }
  return candidates;
}
