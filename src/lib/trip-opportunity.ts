/**
 * trip_opportunity payload emission (BUILD_PRIMER section 6). This is the
 * ONLY interface surface intended for future (PART_2 booking) phases — it
 * must never leak internal scoring implementation details (model names,
 * SLR strategy, disagreement flags, etc. all stay out of this object) per
 * section 10.4.
 */

import { getServiceDb } from "@/lib/db/client";
import type { IndicativeFare, Resort, SnowScore, TripOpportunityPayload } from "@/lib/db/types";

const FARE_STALENESS_HOURS = 48;

async function fetchIndicativeFares(resortId: string): Promise<IndicativeFare[] | null> {
  const db = getServiceDb();
  const since = new Date(Date.now() - FARE_STALENESS_HOURS * 60 * 60 * 1000).toISOString();

  // Fare enrichment is optional and must never block alert firing (section
  // 2.4) — any failure here is swallowed and returns null, not thrown.
  try {
    const { data, error } = await db
      .from("fare_cache")
      .select("origin_airport_code, price_usd, fetched_at")
      .eq("resort_id", resortId)
      .gte("fetched_at", since)
      .order("fetched_at", { ascending: false });
    if (error || !data || data.length === 0) return null;

    // One fare per origin airport — most recently fetched.
    const seen = new Set<string>();
    const fares: IndicativeFare[] = [];
    for (const row of data) {
      if (seen.has(row.origin_airport_code) || row.price_usd == null) continue;
      seen.add(row.origin_airport_code);
      fares.push({
        origin_airport_code: row.origin_airport_code,
        price_usd: row.price_usd,
        as_of: row.fetched_at,
      });
    }
    return fares.length > 0 ? fares : null;
  } catch {
    return null;
  }
}

export async function buildTripOpportunityPayload(
  resort: Resort,
  snowScore: SnowScore,
  targetDateEnd?: string
): Promise<TripOpportunityPayload> {
  const indicativeFares = await fetchIndicativeFares(resort.id);

  return {
    resort_id: resort.id,
    resort_name: resort.name,
    target_date_start: new Date(`${snowScore.target_date}T00:00:00Z`).toISOString(),
    target_date_end: new Date(`${targetDateEnd ?? snowScore.target_date}T00:00:00Z`).toISOString(),
    powder_score: snowScore.powder_score,
    confidence_label: snowScore.confidence_label,
    estimated_snowfall_in: snowScore.estimated_snowfall_in,
    resort_lat: resort.lat,
    resort_lng: resort.lng,
    lead_time_hours: snowScore.lead_time_hours,
    generated_at: new Date().toISOString(),
    indicative_fares: indicativeFares,
  };
}
