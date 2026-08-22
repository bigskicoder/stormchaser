/**
 * NRCS SNOTEL ground-truth ingestion (BUILD_PRIMER section 2.2).
 *
 * ASSUMPTION FLAG: same network constraint as open-meteo.ts — this sandbox
 * cannot reach wcc.sc.egov.usda.gov, so the AWDB REST API shape below is
 * built from documented NRCS conventions (bounding-box station search,
 * WTEQ = snow-water-equivalent element code) rather than a live-validated
 * response. Verify against https://wcc.sc.egov.usda.gov/awdbRestApi/swagger-ui.html
 * before the first production run.
 *
 * Used strictly for post-hoc validation (backtest/accuracy_log), never
 * joined into forward-looking scoring — avoids lookahead contamination
 * per section 2.2.
 */

import { getServiceDb } from "@/lib/db/client";
import type { Resort } from "@/lib/db/types";

const AWDB_BASE_URL = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1";
const SEARCH_RADIUS_DEG = 0.5; // ~55km bounding box half-width at mid-latitudes

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

/**
 * Resolves the nearest active SNOTEL station to a resort's coordinates.
 * Returns null when nothing is found within the search radius (expected
 * for most Northeast/Midwest resorts — SNOTEL is a western-US network).
 */
export async function resolveNearestSnotelStation(
  lat: number,
  lng: number
): Promise<{ triplet: string; distanceKm: number } | null> {
  const url = new URL(`${AWDB_BASE_URL}/stations`);
  url.searchParams.set("networkCds", "SNTL");
  url.searchParams.set("activeOnly", "true");
  url.searchParams.set(
    "bBox",
    [lng - SEARCH_RADIUS_DEG, lat - SEARCH_RADIUS_DEG, lng + SEARCH_RADIUS_DEG, lat + SEARCH_RADIUS_DEG].join(",")
  );

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`SNOTEL station search failed (${res.status})`);
  const stations = (await res.json()) as AwdbStation[];
  if (!stations || stations.length === 0) return null;

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

export async function resolveSnotelStationsForAllResorts(): Promise<void> {
  const db = getServiceDb();
  const { data, error } = await db.from("resorts").select("*");
  if (error) throw error;
  const resorts = (data ?? []) as Resort[];

  for (const resort of resorts) {
    try {
      const match = await resolveNearestSnotelStation(resort.lat, resort.lng);
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
