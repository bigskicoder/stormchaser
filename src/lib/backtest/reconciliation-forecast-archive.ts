/**
 * Forecast-archive-driven reconciliation backtest. Unlike
 * lib/backtest/slr-reanalysis.ts (which validates only the SLR conversion
 * against ~85 years of retrospective-truth reanalysis), this one exercises
 * the FULL pipeline — multi-model reconciliation, then SLR, via the exact
 * same pure computeScoreFromInputs function the live cron uses — against
 * archived output from real historical model runs (genuine forecast
 * uncertainty, not retrospective truth). Much shallower coverage: per
 * lib/ingestion/open-meteo-historical.ts, ~2021+ depending on model, and
 * HRRR isn't available in this archive at all (excluded, not guessed at).
 *
 * ONE HONEST LIMITATION, stated plainly rather than glossed over: the
 * Historical Forecast API returns a single STITCHED continuous series per
 * model, not the full set of distinct forecast runs made at different lead
 * times the live pipeline reconciles across (T+24h from one run, T+96h
 * from an earlier one, etc.) — true distinct archived runs only exist
 * since March 2024 (ECMWF) / September 2025 (everything else) via a
 * separate "Single Runs API," too shallow to be worth a third pipeline
 * here. So this backtest does NOT validate the T48_120/T120_PLUS
 * lead-time weight buckets specifically — it approximates a short-lead
 * ("yesterday's forecast for today") regime and is scored accordingly,
 * at a documented nominal lead time (RECONCILIATION_BACKTEST_NOMINAL_LEAD_TIME_HOURS)
 * that keeps it in the T0_48 bucket rather than claiming fidelity it
 * doesn't have. What it DOES validate honestly: whether reconciling
 * several real models' near-term forecasts, then applying SLR, would have
 * tracked real storms — a meaningfully different and complementary check
 * from the SLR-only reanalysis backtest.
 *
 * No archived ensemble data exists for this product, so ensembleMemberTotals
 * is always []; per ScoreInputs' own doc comment, the resulting
 * confidence_label/ensemble_spread_score aren't meaningful and (same as the
 * SLR reanalysis backtest) are never persisted — accuracy_log only stores
 * predicted_snowfall_in and accuracy_error_in.
 *
 * Ground truth uses snotel_actuals.observed_depth_change_in (independent
 * measured snow depth change), not a WTEQ-converted-through-our-own-SLR-ratio
 * figure like the live accuracy.ts backtest uses — deliberately, so the SLR
 * step is genuinely being checked against something that isn't itself
 * derived from the very ratio under test.
 */

import { getServiceDb } from "@/lib/db/client";
import { upsertInBatches } from "@/lib/db/batch-upsert";
import { PRIMARY_SCORING_ELEVATION_BAND, SEASONAL_MAX_BOOTSTRAP_DEFAULT_IN } from "@/lib/config/constants";
import { HOURLY_VARIABLES, columnTmaxC, type OpenMeteoHourlyResponse } from "@/lib/ingestion/open-meteo";
import {
  fetchHistoricalForecast,
  HISTORICAL_FORECAST_MODEL_IDS,
  HISTORICAL_FORECAST_UNAVAILABLE_MODELS,
} from "@/lib/ingestion/open-meteo-historical";
import { backfillSnotelActualsForResort } from "@/lib/ingestion/snotel";
import { computeScoreFromInputs } from "@/lib/scoring/run";
import type { ScoringConfig } from "@/lib/scoring/config";
import type { ForecastPull, ModelName, Resort } from "@/lib/db/types";
import { utcInstantToLocalDateIso } from "@/lib/utils/timezone";
import type { EnsoAdjustablePhase } from "@/lib/enso/oni";
import { backtestMultiplierByDate } from "./enso-multiplier";

/**
 * See this module's header: the archive is a stitched short-lead series,
 * not the full lead-time spectrum, so this is a documented approximation
 * placing every backtest day in the T0_48 reconciliation-weight bucket —
 * not a measurement of any real forecast's actual lead time.
 */
export const RECONCILIATION_BACKTEST_NOMINAL_LEAD_TIME_HOURS = 24;

/** Every model this backtest can request — HRRR excluded, see open-meteo-historical.ts. */
export const RECONCILIATION_BACKTEST_MODELS: ModelName[] = (Object.keys(HISTORICAL_FORECAST_MODEL_IDS) as ModelName[]).filter(
  (m) => !HISTORICAL_FORECAST_UNAVAILABLE_MODELS.includes(m)
);

/**
 * Converts one model's historical-forecast hourly response into
 * ForecastPull-shaped rows — the same shape fetchLatestModelRunsForDay
 * produces from live data, so computeScoreFromInputs can't tell the
 * difference. run_init_time has no real meaning for a stitched archive
 * series (see module header), so it's set equal to valid_time — a
 * documented placeholder, never read by computeScoreFromInputs itself
 * (only the DB-facing fetchLatestModelRunsForDay cares about run_init_time,
 * for live run-deduplication, which doesn't apply here).
 */
export function forecastPullsFromHistoricalResponse(params: {
  resortId: string;
  model: ModelName;
  response: OpenMeteoHourlyResponse["hourly"];
}): ForecastPull[] {
  const { resortId, model, response } = params;
  const times = response.time ?? [];
  return times.map((t, i) => {
    const validTime = new Date(`${t}Z`).toISOString();
    return {
      id: `backtest-${model}-${t}`,
      resort_id: resortId,
      model_name: model,
      elevation_band: PRIMARY_SCORING_ELEVATION_BAND,
      run_init_time: validTime,
      valid_time: validTime,
      pulled_at: validTime,
      raw_payload: {},
      swe_mm: response.precipitation?.[i] ?? null,
      precip_mm: response.precipitation?.[i] ?? null,
      temp_c: columnTmaxC(response, i),
      wind_speed_kmh: response.wind_speed_10m?.[i] ?? null,
      wind_gust_kmh: response.wind_gusts_10m?.[i] ?? null,
      wind_dir_deg: response.wind_direction_10m?.[i] ?? null,
      freezing_level_m: response.freezing_level_height?.[i] ?? null,
      cloud_cover_pct: response.cloud_cover?.[i] ?? null,
      created_at: validTime,
    };
  });
}

/**
 * Groups ForecastPull rows by the resort's LOCAL calendar day — same
 * timezone-correctness requirement as every other day-bucketing function
 * in this codebase (see bucketHourlyReanalysisByLocalDay's own comment on
 * why this bug class keeps recurring and must be guarded against each
 * time). Pure, exported for unit testing.
 */
export function groupForecastPullsByLocalDay(rows: ForecastPull[], timeZone: string): Map<string, ForecastPull[]> {
  const byDate = new Map<string, ForecastPull[]>();
  for (const row of rows) {
    const date = utcInstantToLocalDateIso(new Date(row.valid_time).getTime(), timeZone);
    const existing = byDate.get(date);
    if (existing) existing.push(row);
    else byDate.set(date, [row]);
  }
  return byDate;
}

export interface ReconciliationBacktestSummary {
  resortSlug: string;
  daysCompared: number;
  daysSkipped: number;
  modelErrors: string[];
  error?: string;
}

/**
 * Same purpose as SlrReanalysisBacktestOverrides (see that interface's
 * comment) but for the full-pipeline backtest: scoringConfig flows straight
 * into computeScoreFromInputs — the exact function live scoring calls — so
 * backtesting under a draft model version exercises its reconciliation
 * weights, confidence thresholds, SLR strategy, and powder-score weights
 * all at once, not just the SLR step.
 */
export interface ReconciliationBacktestOverrides {
  scoringConfig?: ScoringConfig;
  calibrationMultiplier?: number;
  /** The version's El Nino / La Nina multipliers for this resort; undefined = the active version's. */
  ensoSlrMultipliers?: Partial<Record<EnsoAdjustablePhase, number>>;
  modelVersionId?: string | null;
}

export async function runReconciliationBacktestForResort(
  resort: Resort,
  startDate: string,
  endDate: string,
  overrides: ReconciliationBacktestOverrides = {}
): Promise<ReconciliationBacktestSummary> {
  if (!resort.snotel_station_triplet) {
    return { resortSlug: resort.slug, daysCompared: 0, daysSkipped: 0, modelErrors: [], error: "no SNOTEL station resolved for this resort" };
  }

  const db = getServiceDb();
  const modelErrors: string[] = [];

  try {
    await backfillSnotelActualsForResort(resort, startDate, endDate);
    const { data: actualsData, error: actualsError } = await db
      .from("snotel_actuals")
      .select("date, observed_depth_change_in")
      .eq("resort_id", resort.id)
      .gte("date", startDate)
      .lte("date", endDate);
    if (actualsError) throw actualsError;
    const observedByDate = new Map(
      (actualsData ?? []).map((r) => [r.date as string, r.observed_depth_change_in as number | null])
    );

    // modelRunsByDate[date][model] = that model's hourly rows for that day.
    const modelRunsByDate = new Map<string, Partial<Record<ModelName, ForecastPull[]>>>();

    for (const model of RECONCILIATION_BACKTEST_MODELS) {
      try {
        const response = await fetchHistoricalForecast({
          resort,
          model,
          elevationM: resort.elevation_mid_m,
          startDate,
          endDate,
          hourlyVariables: HOURLY_VARIABLES,
        });
        const rows = forecastPullsFromHistoricalResponse({ resortId: resort.id, model, response: response.hourly });
        const byDay = groupForecastPullsByLocalDay(rows, resort.timezone);
        for (const [date, dayRows] of byDay) {
          const entry = modelRunsByDate.get(date) ?? {};
          entry[model] = dayRows;
          modelRunsByDate.set(date, entry);
        }
      } catch (err) {
        modelErrors.push(`${model}: ${(err as Error).message}`);
      }
    }

    let daysSkipped = 0;
    const rows: Record<string, unknown>[] = [];
    const multiplierFor = await backtestMultiplierByDate(resort, overrides);

    for (const [date, modelRuns] of modelRunsByDate) {
      const observedSnowfallIn = observedByDate.get(date) ?? null;
      if (observedSnowfallIn == null) {
        daysSkipped += 1;
        continue;
      }

      const score = computeScoreFromInputs({
        resortId: resort.id,
        targetDate: date,
        leadTimeHours: RECONCILIATION_BACKTEST_NOMINAL_LEAD_TIME_HOURS,
        modelRuns,
        ensembleMemberTotals: [],
        slrCalibrationMultiplier: multiplierFor(date),
        seasonalMaxSnowfallIn: SEASONAL_MAX_BOOTSTRAP_DEFAULT_IN,
        scoringConfig: overrides.scoringConfig,
        modelVersionId: overrides.modelVersionId,
      });
      if (!score) {
        daysSkipped += 1;
        continue;
      }

      rows.push({
        resort_id: resort.id,
        snow_score_id: null,
        target_date: date,
        predicted_snowfall_in: score.estimatedSnowfallIn,
        observed_equivalent_in: observedSnowfallIn,
        accuracy_error_in: score.estimatedSnowfallIn - observedSnowfallIn,
        lead_time_hours_at_prediction: RECONCILIATION_BACKTEST_NOMINAL_LEAD_TIME_HOURS,
        source: "reconciliation_forecast_backtest",
        model_version_id: score.modelVersionId,
      });
    }
    const daysCompared = await upsertInBatches(
      db,
      "accuracy_log",
      rows,
      "resort_id,target_date,lead_time_hours_at_prediction,source,model_version_id"
    );

    return { resortSlug: resort.slug, daysCompared, daysSkipped, modelErrors };
  } catch (err) {
    return { resortSlug: resort.slug, daysCompared: 0, daysSkipped: 0, modelErrors, error: (err as Error).message };
  }
}
