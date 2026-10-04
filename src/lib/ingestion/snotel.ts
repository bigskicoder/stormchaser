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
 * A second WebSearch pass confirmed the `/data` endpoint's parameter
 * names and order (`stationTriplets`, `elements`, `duration`, `beginDate`,
 * `endDate`) match what this module sends — but also surfaced that the
 * documented `duration` values are lowercase (`daily`, `hourly`, ...);
 * this originally sent `"DAILY"` uppercase, fixed below.
 *
 * Used strictly for post-hoc validation (backtest/accuracy_log), never
 * joined into forward-looking scoring — avoids lookahead contamination
 * per section 2.2.
 *
 * Also now pulls SNWD (snow depth) alongside WTEQ, for the resort detail
 * page's "snowfall in the past week" visual — see computeDepthChangeSeries
 * below for why that's depth-delta-based rather than WTEQ-delta-based.
 * Still display-only, same no-lookahead guarantee as the rest of this file.
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

/**
 * Re-pulled and re-upserted every run so a rolling window of history is
 * always current (idempotent via the (resort_id, date) unique constraint) —
 * also means a brand-new deploy has a full week of "past snowfall" to show
 * within one ingestion cycle instead of needing to wait 7 days for daily
 * single-day pulls to accumulate one row at a time. The +1 is a buffer day
 * so the oldest date in the displayed window still gets a real
 * day-over-day depth change instead of a null "no previous reading."
 */
const SNOTEL_BACKFILL_WINDOW_DAYS = 10;

/**
 * Converts a station's raw SNWD (snow depth, inches) daily series into
 * day-over-day new-snow deltas — the standard SNOTEL-based "new snowfall"
 * proxy (depth increases mean new snow; decreases mean settling/melt, not
 * negative snowfall, so clamped to 0). Deliberately NOT derived from WTEQ:
 * WTEQ is cumulative snow-water-equivalent and would conflate settling with
 * melt in a way raw depth doesn't. Carries the last known depth across any
 * gap in the series (a day the station didn't report) rather than resetting
 * to null, so one missing day doesn't also blank out the next valid one.
 * Exported for unit testing — pure, no network/DB access.
 */
export function computeDepthChangeSeries(
  points: Array<{ date: string; depthIn: number | null }>
): Array<{ date: string; depthIn: number | null; changeIn: number | null }> {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const result: Array<{ date: string; depthIn: number | null; changeIn: number | null }> = [];
  let previousDepthIn: number | null = null;

  for (const point of sorted) {
    const changeIn = point.depthIn != null && previousDepthIn != null ? Math.max(0, point.depthIn - previousDepthIn) : null;
    result.push({ date: point.date, depthIn: point.depthIn, changeIn });
    if (point.depthIn != null) previousDepthIn = point.depthIn;
  }

  return result;
}

/** Pulls a rolling window of WTEQ + SNWD for every resort with a resolved station, upserting one row per (resort, date). */
export async function ingestSnotelActuals(): Promise<{ written: number; skipped: number; errors: string[] }> {
  const db = getServiceDb();
  const { data, error } = await db.from("resorts").select("*").not("snotel_station_triplet", "is", null);
  if (error) throw error;
  const resorts = (data ?? []) as Resort[];

  let written = 0;
  let skipped = 0;
  const errors: string[] = [];
  const today = new Date();
  const endDate = today.toISOString().slice(0, 10);
  const beginDate = new Date(today.getTime() - SNOTEL_BACKFILL_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  for (const resort of resorts) {
    if (!resort.snotel_station_triplet) {
      skipped += 1;
      continue;
    }
    try {
      const url = new URL(`${AWDB_BASE_URL}/data`);
      url.searchParams.set("stationTriplets", resort.snotel_station_triplet);
      url.searchParams.set("elements", "WTEQ,SNWD");
      // Confirmed via WebSearch this session: documented values are
      // lowercase ("daily", "hourly", etc.) — this originally sent
      // "DAILY" uppercase, which the API may or may not accept.
      url.searchParams.set("duration", "daily");
      url.searchParams.set("beginDate", beginDate);
      url.searchParams.set("endDate", endDate);

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`AWDB data request failed (${res.status})`);
      const points = (await res.json()) as AwdbDataPoint[];
      const wteqSeries = points[0]?.data.find((d) => d.stationElement.elementCode === "WTEQ");
      const snwdSeries = points[0]?.data.find((d) => d.stationElement.elementCode === "SNWD");
      if (!wteqSeries && !snwdSeries) {
        skipped += 1;
        continue;
      }

      const wteqByDate = new Map((wteqSeries?.values ?? []).map((v) => [v.date, v.value]));
      const depthPoints = (snwdSeries?.values ?? []).map((v) => ({ date: v.date, depthIn: v.value }));
      const depthChanges = computeDepthChangeSeries(depthPoints);

      // Union of every date either element reported, so a day with only
      // WTEQ (or only SNWD) still gets a row instead of being dropped.
      const allDates = new Set<string>([...wteqByDate.keys(), ...depthChanges.map((d) => d.date)]);
      const changeByDate = new Map(depthChanges.map((d) => [d.date, d]));

      for (const date of allDates) {
        const wteqValue = wteqByDate.get(date);
        const depthChange = changeByDate.get(date);
        const observedSweMm = wteqValue != null ? wteqValue * 25.4 : null; // WTEQ reported in inches

        const { error: upsertError } = await db.from("snotel_actuals").upsert(
          {
            resort_id: resort.id,
            station_triplet: resort.snotel_station_triplet,
            date,
            observed_swe_mm: observedSweMm,
            snow_depth_in: depthChange?.depthIn ?? null,
            observed_depth_change_in: depthChange?.changeIn ?? null,
          },
          { onConflict: "resort_id,date" }
        );
        if (upsertError) throw upsertError;
        written += 1;
      }
    } catch (err) {
      errors.push(`${resort.slug}: ${(err as Error).message}`);
    }
  }

  return { written, skipped, errors };
}
