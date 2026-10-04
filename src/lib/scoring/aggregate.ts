/**
 * DB-facing aggregation helpers for the scoring orchestrator
 * (lib/scoring/run.ts). Kept separate from the pure scoring functions
 * (reconciliation.ts, ensemble-confidence.ts, powder-score.ts, slr/*) so
 * those stay independently unit-testable without a database.
 */

import { getServiceDb } from "@/lib/db/client";
import {
  MODEL_WEIGHTS_BY_BUCKET,
  PRIMARY_SCORING_ELEVATION_BAND,
  SEASONAL_MAX_BOOTSTRAP_DEFAULT_IN,
  SEASONAL_MAX_ROLLING_WINDOW_DAYS,
  leadTimeBucketFor,
} from "@/lib/config/constants";
import type { ForecastPull, ModelName } from "@/lib/db/types";
import { localDateRangeToUtc } from "@/lib/utils/timezone";

/** Fetches the most-recent-run hourly rows per model for one resort/day (in the resort's LOCAL calendar day, not UTC) at the primary scoring band. */
export async function fetchLatestModelRunsForDay(
  resortId: string,
  targetDateIso: string,
  timeZone: string
): Promise<Record<ModelName, ForecastPull[]>> {
  const db = getServiceDb();
  const { start, end } = localDateRangeToUtc(targetDateIso, timeZone);

  const { data, error } = await db
    .from("forecast_pulls")
    .select("*")
    .eq("resort_id", resortId)
    .eq("elevation_band", PRIMARY_SCORING_ELEVATION_BAND)
    .gte("valid_time", start)
    .lt("valid_time", end)
    .order("run_init_time", { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as ForecastPull[];
  const byModel: Partial<Record<ModelName, ForecastPull[]>> = {};
  const latestRunPerModel: Partial<Record<ModelName, string>> = {};

  for (const row of rows) {
    const model = row.model_name;
    if (!latestRunPerModel[model]) latestRunPerModel[model] = row.run_init_time;
    if (row.run_init_time !== latestRunPerModel[model]) continue;
    (byModel[model] ??= []).push(row);
  }

  return byModel as Record<ModelName, ForecastPull[]>;
}

export function dailyPrecipTotalMm(rows: ForecastPull[]): number {
  return rows.reduce((sum, r) => sum + (r.swe_mm ?? 0), 0);
}

/** Mean of a numeric field across a day's hourly rows, ignoring nulls. Null if every row is null. */
function meanField(rows: ForecastPull[], field: "temp_c" | "wind_speed_kmh" | "cloud_cover_pct"): number | null {
  const values = rows.map((r) => r[field]).filter((v): v is number => typeof v === "number");
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Day's average surface temperature (°C) across a model's hourly rows — display-only, distinct from the Kuchera column-Tmax used in scoring. */
export function dailyAvgTempC(rows: ForecastPull[]): number | null {
  return meanField(rows, "temp_c");
}

/** Day's average sustained wind speed (km/h). */
export function dailyAvgWindSpeedKmh(rows: ForecastPull[]): number | null {
  return meanField(rows, "wind_speed_kmh");
}

/** Day's average cloud cover (%). */
export function dailyAvgCloudCoverPct(rows: ForecastPull[]): number | null {
  return meanField(rows, "cloud_cover_pct");
}

/** Day's peak wind gust (km/h) across a model's hourly rows. Null if no row reports a gust. */
export function dailyMaxWindGustKmh(rows: ForecastPull[]): number | null {
  const values = rows.map((r) => r.wind_gust_kmh).filter((v): v is number => typeof v === "number");
  if (values.length === 0) return null;
  return Math.max(...values);
}

/**
 * Averages a per-model daily aggregate (e.g. dailyAvgWindSpeedKmh's output
 * for each available model) into one representative value, so the detail
 * page shows a single number rather than one per model. A simple mean
 * across whichever models reported a value — this is a display aggregate,
 * not part of the reconciliation engine's scoring math.
 */
export function meanAcrossModels(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v != null);
  if (present.length === 0) return null;
  return present.reduce((sum, v) => sum + v, 0) / present.length;
}

/** Like meanAcrossModels but for a "worst case" figure (e.g. peak gust) where the max across models is more useful than the mean. */
export function maxAcrossModels(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v != null);
  if (present.length === 0) return null;
  return Math.max(...present);
}

/** Precip-weighted mean column-Tmax (°C) across a day's hourly rows; falls back to a plain mean when there's no precip signal. */
export function precipWeightedTmaxC(rows: ForecastPull[]): number {
  const withTemp = rows.filter((r) => r.temp_c != null);
  if (withTemp.length === 0) return 0;

  const totalPrecip = withTemp.reduce((sum, r) => sum + (r.swe_mm ?? 0), 0);
  if (totalPrecip <= 0) {
    return withTemp.reduce((sum, r) => sum + (r.temp_c as number), 0) / withTemp.length;
  }
  return withTemp.reduce((sum, r) => sum + (r.temp_c as number) * (r.swe_mm ?? 0), 0) / totalPrecip;
}

/**
 * Picks the single highest-weighted model for the lead-time bucket implied
 * by leadTimeHours, to drive the representative Tmax used by the SLR
 * strategy (documented simplification — see lib/scoring/run.ts).
 */
export function primaryModelForLeadTime(leadTimeHours: number, available: ModelName[]): ModelName | null {
  const weights = MODEL_WEIGHTS_BY_BUCKET[leadTimeBucketFor(leadTimeHours)];
  const ranked = (Object.entries(weights) as Array<[ModelName, number]>)
    .filter(([model]) => available.includes(model))
    .sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? null;
}

export async function fetchEnsembleMemberTotalsForDay(resortId: string, targetDateIso: string, timeZone: string): Promise<number[]> {
  const db = getServiceDb();
  const { start, end } = localDateRangeToUtc(targetDateIso, timeZone);

  const { data, error } = await db
    .from("ensemble_pulls")
    .select("member_id, swe_mm, run_init_time")
    .eq("resort_id", resortId)
    .eq("elevation_band", PRIMARY_SCORING_ELEVATION_BAND)
    .gte("valid_time", start)
    .lt("valid_time", end)
    .order("run_init_time", { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as Array<{ member_id: number; swe_mm: number | null; run_init_time: string }>;
  if (rows.length === 0) return [];

  const latestRun = rows[0]!.run_init_time;
  const totalsByMember = new Map<number, number>();
  for (const row of rows) {
    if (row.run_init_time !== latestRun) continue;
    totalsByMember.set(row.member_id, (totalsByMember.get(row.member_id) ?? 0) + (row.swe_mm ?? 0));
  }
  return Array.from(totalsByMember.values());
}

export async function fetchSeasonalMaxSnowfallIn(resortId: string): Promise<number> {
  const db = getServiceDb();
  const since = new Date(Date.now() - SEASONAL_MAX_ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from("snow_scores")
    .select("estimated_snowfall_in")
    .eq("resort_id", resortId)
    .gte("computed_at", since)
    .order("estimated_snowfall_in", { ascending: false })
    .limit(1);
  if (error) throw error;

  const max = (data ?? [])[0]?.estimated_snowfall_in as number | undefined;
  return max && max > 0 ? max : SEASONAL_MAX_BOOTSTRAP_DEFAULT_IN;
}
