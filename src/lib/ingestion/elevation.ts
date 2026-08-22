/**
 * Onboarding elevation sanity-check (BUILD_PRIMER section 2.1a): run once
 * per resort at seed time, not on every pull. Calls Open-Meteo's Elevation
 * API (/v1/elevation, 90m DEM) and flags operator-entered base/mid/summit
 * values that differ from actual terrain by more than the configured
 * threshold, for manual review rather than silently trusting operator input.
 */

import { getServiceDb } from "@/lib/db/client";
import { ELEVATION_DISCREPANCY_FLAG_THRESHOLD_M } from "@/lib/config/constants";
import type { Resort } from "@/lib/db/types";

const OPEN_METEO_BASE_URL = process.env.OPEN_METEO_BASE_URL ?? "https://api.open-meteo.com";

interface ElevationApiResponse {
  elevation: number[];
}

async function fetchDemElevationM(lat: number, lng: number): Promise<number> {
  const url = new URL(`${OPEN_METEO_BASE_URL.replace(/\/$/, "")}/v1/elevation`);
  url.searchParams.set("latitude", lat.toFixed(4));
  url.searchParams.set("longitude", lng.toFixed(4));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Elevation API failed (${res.status})`);
  const body = (await res.json()) as ElevationApiResponse;
  const value = body.elevation?.[0];
  if (typeof value !== "number") throw new Error("Elevation API returned no value");
  return value;
}

export interface ElevationCheckResult {
  resortSlug: string;
  demElevationM: number;
  flagged: boolean;
  notes: string;
}

/**
 * Checks a resort's operator-entered summit elevation (the terrain-defining
 * figure) against DEM ground truth at the resort's lat/lng. The DEM query is
 * a single point, so it inherently compares against summit — base/mid are
 * synthetic band offsets from the same operator estimate and are not
 * independently checkable without per-band coordinates, which are out of
 * scope for this onboarding pass.
 */
export async function runElevationCheck(resort: Resort): Promise<ElevationCheckResult> {
  const demElevationM = await fetchDemElevationM(resort.lat, resort.lng);
  const delta = Math.abs(demElevationM - resort.elevation_summit_m);
  const flagged = delta > ELEVATION_DISCREPANCY_FLAG_THRESHOLD_M;
  const notes = flagged
    ? `DEM elevation at (${resort.lat}, ${resort.lng}) is ${demElevationM.toFixed(0)}m, ` +
      `differs from seeded summit elevation ${resort.elevation_summit_m}m by ${delta.toFixed(0)}m ` +
      `(threshold ${ELEVATION_DISCREPANCY_FLAG_THRESHOLD_M}m). Manual review needed — the lat/lng ` +
      `may be centered on base/village rather than summit, or the seeded elevation may be wrong.`
    : `DEM elevation ${demElevationM.toFixed(0)}m within tolerance of seeded ${resort.elevation_summit_m}m.`;

  return { resortSlug: resort.slug, demElevationM, flagged, notes };
}

export async function runElevationCheckAndPersist(resort: Resort): Promise<ElevationCheckResult> {
  const result = await runElevationCheck(resort);
  const db = getServiceDb();
  const { error } = await db
    .from("resorts")
    .update({
      elevation_checked_at: new Date().toISOString(),
      elevation_check_flag: result.flagged,
      elevation_check_notes: result.notes,
    })
    .eq("id", resort.id);
  if (error) throw error;
  return result;
}

export async function runElevationCheckForAllResorts(): Promise<ElevationCheckResult[]> {
  const db = getServiceDb();
  const { data, error } = await db.from("resorts").select("*");
  if (error) throw error;
  const resorts = (data ?? []) as Resort[];

  const results: ElevationCheckResult[] = [];
  for (const resort of resorts) {
    try {
      results.push(await runElevationCheckAndPersist(resort));
    } catch (err) {
      results.push({
        resortSlug: resort.slug,
        demElevationM: NaN,
        flagged: true,
        notes: `Elevation check request failed: ${(err as Error).message}`,
      });
    }
  }
  return results;
}
