/**
 * Public-site data access. Deliberately uses the anon Supabase client (RLS
 * policies in supabase/migrations/0002_rls.sql), not the service-role
 * client — the public site must only ever see what an unauthenticated
 * visitor is allowed to see, per section 10.5 (no paywall on core
 * transparency surface).
 */

import { getAnonDb } from "@/lib/db/client";
import type { Resort, SnowScore } from "@/lib/db/types";

export interface ResortWithScore {
  resort: Resort;
  bestUpcomingScore: SnowScore | null;
}

/** For each active resort, the single best-scoring upcoming day currently on the books. */
export async function getResortsWithBestUpcomingScore(): Promise<ResortWithScore[]> {
  const db = getAnonDb();
  const today = new Date().toISOString().slice(0, 10);

  const { data: resorts, error: resortsError } = await db
    .from("resorts")
    .select("*")
    .eq("active", true)
    .order("name");
  if (resortsError) throw resortsError;

  const results: ResortWithScore[] = [];
  for (const resort of (resorts ?? []) as Resort[]) {
    const { data: scores, error: scoresError } = await db
      .from("snow_scores")
      .select("*")
      .eq("resort_id", resort.id)
      .gte("target_date", today)
      .order("powder_score", { ascending: false })
      .order("computed_at", { ascending: false })
      .limit(1);
    if (scoresError) throw scoresError;

    results.push({ resort, bestUpcomingScore: (scores ?? [])[0] as SnowScore | undefined ?? null });
  }

  return results;
}

export async function getResortBySlug(slug: string): Promise<Resort | null> {
  const db = getAnonDb();
  const { data, error } = await db.from("resorts").select("*").eq("slug", slug).eq("active", true).maybeSingle();
  if (error) throw error;
  return (data as Resort | null) ?? null;
}

export async function getUpcomingScoresForResort(resortId: string): Promise<SnowScore[]> {
  const db = getAnonDb();
  const today = new Date().toISOString().slice(0, 10);

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
