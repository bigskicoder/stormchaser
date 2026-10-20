/**
 * Snowpack jobs: the per-resort fit (scripts/snowpack-fit.ts, on GitHub
 * Actions) and the daily season run (/api/cron/snowpack, on Vercel).
 */

import { getServiceDb } from "@/lib/db/client";
import { upsertInBatches } from "@/lib/db/batch-upsert";
import type { Resort } from "@/lib/db/types";
import { mapWithConcurrency } from "@/lib/utils/concurrency";
import { addCalendarDays, localTodayIso } from "@/lib/utils/timezone";
import { DEFAULT_SNOWPACK_PARAMS, runSnowpack, waterYearOf, type SnowpackDay, type SnowpackParams } from "./model";
import { fitAndScoreResort, type SnowpackFit } from "./fit";
import { FALLBACK_RH_PCT, LAPSE_RATE_C_PER_M, buildWinters, loadForecastDays, loadObservations, loadReanalysisDays } from "./data";

/** How far the projection runs past today: the forecast models' 10 days. */
export const SNOWPACK_PROJECTION_DAYS = 10;

/**
 * Fits one resort against its reference station. The weather is ERA5 at the
 * resort's mid elevation; temperatures are moved to the station's elevation
 * with the standard lapse rate when the station's elevation is known, so
 * the fitted melt factors describe the snow, not the height difference.
 */
export async function fitResortSnowpack(resort: Resort, stationElevationM: number | null): Promise<{ fit: SnowpackFit | null; winters: number; weatherElevationM: number | null }> {
  const raw = await loadReanalysisDays(resort.id);
  const weatherElevationM = raw.elevationM;
  const offset = stationElevationM != null && weatherElevationM != null ? -LAPSE_RATE_C_PER_M * (stationElevationM - weatherElevationM) : 0;
  const days = offset === 0 ? raw.days : raw.days.map((d) => ({ ...d, tMeanC: d.tMeanC + offset, tMinC: d.tMinC + offset, tMaxC: d.tMaxC + offset }));
  const obs = await loadObservations(resort.id);
  const winters = buildWinters(days, obs);
  return { fit: fitAndScoreResort(winters), winters: winters.length, weatherElevationM };
}

export async function saveSnowpackFit(
  resort: Resort,
  result: { fit: SnowpackFit; winters: number; weatherElevationM: number | null },
  stationElevationM: number | null
): Promise<void> {
  const { error } = await getServiceDb()
    .from("snowpack_params")
    .upsert({
      resort_id: resort.id,
      params: result.fit.params,
      held_out: result.fit.heldOut,
      in_sample: result.fit.inSample,
      passes: result.fit.passes,
      failed_checks: result.fit.failedChecks,
      station_triplet: resort.snotel_station_triplet ?? resort.ghcnd_station_id ?? null,
      station_elevation_m: stationElevationM,
      weather_elevation_m: result.weatherElevationM,
      winters: result.winters,
      fitted_at: new Date().toISOString(),
    });
  if (error) throw error;
}

interface ParamsRow {
  resort_id: string;
  params: SnowpackParams;
  passes: boolean;
}

/**
 * Which parameters a resort runs on: its fitted ones when they clear the
 * bar; SNOW-17 defaults ("uncalibrated") when it has no reference station;
 * none when it has a station but failed the bar (the plan: no estimate
 * rather than a bad one).
 */
export function paramsForResort(resort: Resort, row: ParamsRow | undefined): { params: SnowpackParams; calibrated: boolean } | null {
  if (row) return row.passes ? { params: row.params, calibrated: true } : null;
  const hasStation = Boolean(resort.snotel_station_triplet || resort.ghcnd_station_id);
  // A station but no fit yet: wait for the fit rather than show defaults.
  return hasStation ? null : { params: DEFAULT_SNOWPACK_PARAMS, calibrated: false };
}

/**
 * Glues ERA5 days to forecast days into one contiguous season from Oct 1:
 * ERA5 wherever it has the day, forecast weather after its last day. Stops
 * at the first gap neither covers. Pure.
 */
export function seasonDays(waterYear: number, era5: SnowpackDay[], forecast: SnowpackDay[], lastDate: string): SnowpackDay[] {
  const byDate = new Map<string, SnowpackDay>();
  for (const d of forecast) byDate.set(d.date, d);
  for (const d of era5) byDate.set(d.date, d);
  const out: SnowpackDay[] = [];
  for (let d = `${waterYear - 1}-10-01`; d <= lastDate; d = addCalendarDays(d, 1)) {
    const day = byDate.get(d);
    if (!day) break;
    out.push(day);
  }
  return out;
}

export interface SnowpackRunSummary {
  resorts: number;
  rowsWritten: number;
  skipped: number;
  errors: string[];
}

/** Recomputes this season's natural snowpack and projection for every active resort. */
export async function runSnowpackForAllResorts(now: Date = new Date()): Promise<SnowpackRunSummary> {
  const db = getServiceDb();
  const { data: resortData, error } = await db.from("resorts").select("*").eq("active", true);
  if (error) throw error;
  const resorts = (resortData ?? []) as Resort[];
  const { data: paramData, error: paramError } = await db.from("snowpack_params").select("resort_id, params, passes");
  if (paramError) throw paramError;
  const paramsByResort = new Map(((paramData ?? []) as ParamsRow[]).map((r) => [r.resort_id, r]));

  const summary: SnowpackRunSummary = { resorts: 0, rowsWritten: 0, skipped: 0, errors: [] };
  await mapWithConcurrency(resorts, 4, async (resort) => {
    try {
      const chosen = paramsForResort(resort, paramsByResort.get(resort.id));
      if (!chosen) {
        summary.skipped += 1;
        return;
      }
      const today = localTodayIso(resort.timezone, now);
      const wy = waterYearOf(today);
      const { days: era5 } = await loadReanalysisDays(resort.id, { from: `${wy - 1}-10-01` });
      if (era5.length === 0 || era5[0]!.date !== `${wy - 1}-10-01`) {
        // No ERA5 for this season's start yet; the history run fills it.
        summary.skipped += 1;
        return;
      }
      const lastEra5 = era5[era5.length - 1]!.date;
      const recent = era5.slice(-30);
      const rh = recent.length ? recent.reduce((s, d) => s + d.rhPct, 0) / recent.length : FALLBACK_RH_PCT;
      const lastDate = addCalendarDays(today, SNOWPACK_PROJECTION_DAYS);
      const forecast = await loadForecastDays(resort, addCalendarDays(lastEra5, 1), lastDate, rh);
      const days = seasonDays(wy, era5, forecast, lastDate);
      const results = runSnowpack(days, chosen.params);
      const computedAt = now.toISOString();
      const rows = results.map((r) => ({
        resort_id: resort.id,
        date: r.date,
        swe_mm: Math.round(r.sweMm * 10) / 10,
        depth_in: Math.round((r.depthCm / 2.54) * 10) / 10,
        density: r.density != null ? Math.round(r.density * 1000) / 1000 : null,
        kind: r.date < today ? "modeled" : "projected",
        calibrated: chosen.calibrated,
        computed_at: computedAt,
      }));
      summary.rowsWritten += await upsertInBatches(db, "snowpack_daily", rows, "resort_id,date");
      summary.resorts += 1;
    } catch (err) {
      summary.errors.push(`${resort.slug}: ${(err as Error).message}`);
    }
  });
  return summary;
}
