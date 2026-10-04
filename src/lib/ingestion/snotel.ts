/**
 * NRCS SNOTEL ground-truth ingestion (BUILD_PRIMER section 2.2).
 *
 * VERIFIED (partially) via WebSearch — this sandbox's egress proxy blocks
 * WebFetch to wcc.sc.egov.usda.gov directly (same EGRESS_BLOCKED result as
 * every other candidate source tried for the Kuchera coefficients — see
 * lib/scoring/slr/kuchera.ts), but search results surfaced a real,
 * actionable correction: the AWDB REST API does NOT support server-side
 * spatial/bounding-box queries at all. The documented pattern (per a
 * TSTool datastore reference describing this same API) is: fetch the full
 * station list for the network from the metadata endpoint, then filter by
 * area of interest client-side. This module originally assumed a `bBox`
 * query param would filter server-side — removed; now fetches the full
 * SNTL network list once and does the nearest-match client-side (which the
 * haversine loop below was already doing anyway, so this is a smaller fix
 * than it sounds: drop the non-functional bBox param, stop scoping the
 * fetch per-resort, and fetch the whole network list once per batch
 * instead). Endpoint path/field names themselves (`/stations`, `WTEQ`,
 * `stationTriplet`) are still unverified against a live response — if
 * they're wrong, this returns an empty list, which the onboarding flow
 * handles as "no coverage" rather than crashing, but it would silently
 * under-cover resorts that do have a real nearby station.
 *
 * Used strictly for post-hoc validation (backtest/accuracy_log), never
 * joined into forward-looking scoring — avoids lookahead contamination
 * per section 2.2.
 */

import { getServiceDb } from "@/lib/db/client";
import type { Resort } from "@/lib/db/types";

const AWDB_BASE_URL = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1";

interface AwdbStation {
  stationTriplet: string;
  latitude: number;
  longitude: number;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Pure nearest-match over an already-fetched station list. Exported for unit testing. */
export function findNearestStation(
  lat: number,
  lng: number,
  stations: AwdbStation[]
): { triplet: string; distanceKm: number } | null {
  let best: AwdbStation | null = null;
  let bestDistance = Infinity;
  for (const s of stations) {
    const d = haversineKm(lat, lng, s.latitude, s.longitude);
    if (d < bestDistance) {
      bestDistance = d;
      best = s;
    }
  }
  if (!best) return null;
  return { triplet: best.stationTriplet, distanceKm: bestDistance };
}

/** Fetches the full active SNTL network station list. No server-side spatial filtering — see module header. */
export async function fetchAllSnotelStations(): Promise<AwdbStation[]> {
  const url = new URL(`${AWDB_BASE_URL}/stations`);
  url.searchParams.set("networkCds", "SNTL");
  url.searchParams.set("activeOnly", "true");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`SNOTEL station list fetch failed (${res.status})`);
  return (await res.json()) as AwdbStation[];
}

/**
 * Resolves the nearest active SNOTEL station to a resort's coordinates.
 * Returns null when nothing is found (expected for most Northeast/Midwest
 * resorts — SNOTEL is a western-US network). Convenience single-resort
 * wrapper; resolveSnotelStationsForAllResorts fetches the station list
 * once and reuses it across all resorts instead of calling this per-resort.
 */
export async function resolveNearestSnotelStation(
  lat: number,
  lng: number
): Promise<{ triplet: string; distanceKm: number } | null> {
  const stations = await fetchAllSnotelStations();
  return findNearestStation(lat, lng, stations);
}

export async function resolveSnotelStationsForAllResorts(): Promise<void> {
  const db = getServiceDb();
  const { data, error } = await db.from("resorts").select("*");
  if (error) throw error;
  const resorts = (data ?? []) as Resort[];

  // Fetch the station list once and reuse it for every resort, rather than
  // one redundant full-network fetch per resort — see module header on why
  // there's no server-side spatial filter to scope this per-resort anyway.
  const stations = await fetchAllSnotelStations();

  for (const resort of resorts) {
    try {
      const match = findNearestStation(resort.lat, resort.lng, stations);
      await db
        .from("resorts")
        .update({
          snotel_station_triplet: match?.triplet ?? null,
          snotel_station_distance_km: match?.distanceKm ?? null,
          snotel_resolved_at: new Date().toISOString(),
        })
        .eq("id", resort.id);
    } catch {
      // Leave unresolved — daily SNOTEL pull will just skip this resort
      // until re-resolved. Not fatal to onboarding.
    }
  }
}

interface AwdbDataPoint {
  stationTriplet: string;
  data: Array<{
    stationElement: { elementCode: string };
    values: Array<{ date: string; value: number | null }>;
  }>;
}

/** Pulls the latest day of WTEQ (snow-water-equivalent, in) for every resort with a resolved station. */
export async function ingestSnotelActuals(): Promise<{ written: number; skipped: number; errors: string[] }> {
  const db = getServiceDb();
  const { data, error } = await db.from("resorts").select("*").not("snotel_station_triplet", "is", null);
  if (error) throw error;
  const resorts = (data ?? []) as Resort[];

  let written = 0;
  let skipped = 0;
  const errors: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const resort of resorts) {
    if (!resort.snotel_station_triplet) {
      skipped += 1;
      continue;
    }
    try {
      const url = new URL(`${AWDB_BASE_URL}/data`);
      url.searchParams.set("stationTriplets", resort.snotel_station_triplet);
      url.searchParams.set("elements", "WTEQ");
      url.searchParams.set("duration", "DAILY");
      url.searchParams.set("beginDate", today);
      url.searchParams.set("endDate", today);

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`AWDB data request failed (${res.status})`);
      const points = (await res.json()) as AwdbDataPoint[];
      const wteqSeries = points[0]?.data.find((d) => d.stationElement.elementCode === "WTEQ");
      const latest = wteqSeries?.values.at(-1);
      if (!latest || latest.value == null) {
        skipped += 1;
        continue;
      }

      const observedSweMm = latest.value * 25.4; // WTEQ reported in inches

      const { error: upsertError } = await db.from("snotel_actuals").upsert(
        {
          resort_id: resort.id,
          station_triplet: resort.snotel_station_triplet,
          date: latest.date,
          observed_swe_mm: observedSweMm,
        },
        { onConflict: "resort_id,date" }
      );
      if (upsertError) throw upsertError;
      written += 1;
    } catch (err) {
      errors.push(`${resort.slug}: ${(err as Error).message}`);
    }
  }

  return { written, skipped, errors };
}
