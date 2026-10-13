/**
 * Reanalysis-driven SLR backtest. Validates ONLY the SLR conversion step
 * (lib/scoring/slr/*) against decades of ERA5 reanalysis data (see
 * lib/ingestion/open-meteo-historical.ts header for why reanalysis — not
 * forecast-archive — data is the right source for this specific piece) —
 * it does not exercise multi-model reconciliation or ensemble confidence at
 * all, since reanalysis has no multi-model disagreement to reconcile. See
 * lib/backtest/reconciliation-forecast-archive.ts for the backtest that
 * does exercise the full pipeline, over a much shorter history.
 *
 * Results feed accuracy_log under source='slr_reanalysis_backtest', pooled
 * into Phase B's calibration input alongside live 'powder_alert' samples —
 * see lib/calibration/generate.ts and CALIBRATION_ELIGIBLE_SOURCES in
 * lib/config/constants.ts for the pooling rationale and its one real
 * caveat (this measures SLR-only error; live samples measure end-to-end
 * error including reconciliation noise — pooled as an approximation, not a
 * methodologically perfect blend, acceptable given Phase B is bounded,
 * recommend-only, and human-approved either way).
 */

import { getServiceDb } from "@/lib/db/client";
import { DEFAULT_SLR_STRATEGY } from "@/lib/config/constants";
import { getSlrStrategy } from "@/lib/scoring/slr";
import { backfillSnotelActualsForResort } from "@/lib/ingestion/snotel";
import { fetchHistoricalWeather, type HistoricalWeatherResponse } from "@/lib/ingestion/open-meteo-historical";
import type { Resort, SlrStrategyName } from "@/lib/db/types";
import { utcInstantToLocalDateIso } from "@/lib/utils/timezone";

export interface DailyReanalysisBucket {
  date: string;
  /** Day's total precipitation (mm) — liquid equivalent input to the SLR conversion, same role dailyPrecipTotalMm plays for live forecast_pulls. */
  dailyPrecipMm: number;
  /**
   * Day's maximum hourly surface temperature (°C). NOT the same
   * "column Tmax" the live pipeline's precipWeightedTmaxC computes (that
   * blends surface + pressure-level temps across precip-weighted hours) —
   * the reanalysis archive is only requested with temperature_2m (see
   * open-meteo-historical.ts header on why pressure levels aren't
   * requested here), so this is literally the day's peak surface
   * temperature. A different, still-reasonable simplification, not the
   * same one — documented so the two are never assumed interchangeable.
   */
  tmaxC: number | null;
}

/**
 * Buckets a reanalysis archive response's hourly rows into calendar days in
 * the resort's own LOCAL timezone, not UTC — the same bug class fixed
 * twice elsewhere this session (lib/scoring/run.ts's nextNDates,
 * lib/public/resort-scores.ts's getUpcomingScoresForResort). Pure, no
 * network/DB access.
 */
export function bucketHourlyReanalysisByLocalDay(hourly: HistoricalWeatherResponse["hourly"], timeZone: string): DailyReanalysisBucket[] {
  const byDate = new Map<string, { precipMm: number; temps: number[] }>();

  hourly.time.forEach((t, i) => {
    const utcMs = new Date(`${t}Z`).getTime();
    const date = utcInstantToLocalDateIso(utcMs, timeZone);
    const entry = byDate.get(date) ?? { precipMm: 0, temps: [] };
    const precip = hourly.precipitation?.[i];
    if (typeof precip === "number") entry.precipMm += precip;
    const temp = hourly.temperature_2m?.[i];
    if (typeof temp === "number") entry.temps.push(temp);
    byDate.set(date, entry);
  });

  return Array.from(byDate.entries())
    .map(([date, { precipMm, temps }]) => ({
      date,
      dailyPrecipMm: precipMm,
      tmaxC: temps.length > 0 ? Math.max(...temps) : null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface SlrBacktestDayResult {
  predictedSnowfallIn: number;
  slrRatio: number;
  isRainCase: boolean;
  observedSnowfallIn: number;
  errorIn: number;
}

/**
 * Pure SLR-vs-observed comparison for one resort-day. Returns null when
 * there's no observed ground truth or no temperature reading for that day
 * (nothing to compare against, not an error case). Exported for unit
 * testing — no network/DB access.
 */
export function computeSlrBacktestDay(params: {
  bucket: DailyReanalysisBucket;
  calibrationMultiplier: number;
  observedSnowfallIn: number | null;
  slrStrategyName?: Parameters<typeof getSlrStrategy>[0];
}): SlrBacktestDayResult | null {
  const { bucket, calibrationMultiplier, observedSnowfallIn, slrStrategyName } = params;
  if (observedSnowfallIn == null || bucket.tmaxC == null) return null;

  const strategy = getSlrStrategy(slrStrategyName ?? DEFAULT_SLR_STRATEGY);
  const slrResult = strategy.computeRatio({ tmaxC: bucket.tmaxC, calibrationMultiplier });
  const predictedSnowfallIn = slrResult.isRainCase ? 0 : (bucket.dailyPrecipMm * slrResult.ratio) / 25.4;

  return {
    predictedSnowfallIn,
    slrRatio: slrResult.ratio,
    isRainCase: slrResult.isRainCase,
    observedSnowfallIn,
    errorIn: predictedSnowfallIn - observedSnowfallIn,
  };
}

/**
 * Not a real forecast lead time — the reanalysis backtest uses retrospective
 * truth as if it were a same-day nowcast, so there's no genuine lead-time
 * concept to record. 0 is a documented convention, not a measurement.
 */
const SLR_REANALYSIS_BACKTEST_LEAD_TIME_HOURS = 0;

export interface SlrReanalysisBacktestSummary {
  resortSlug: string;
  daysCompared: number;
  daysSkipped: number;
  error?: string;
}

/**
 * Lets an operator backtest under a specific model_versions row (e.g. a
 * draft that hasn't been activated yet) instead of this resort's live
 * `slr_calibration_multiplier` + the compiled-in DEFAULT_SLR_STRATEGY — see
 * scripts/backtest-slr-reanalysis.ts's --version flag and
 * lib/model-versions/compare.ts's header on why "run a backtest under this
 * version first" is the intended workflow for comparing draft versions
 * before activating one. modelVersionId is pure bookkeeping, tagged onto
 * the accuracy_log rows this writes so compareModelVersions can find them.
 */
export interface SlrReanalysisBacktestOverrides {
  slrStrategyName?: SlrStrategyName;
  calibrationMultiplier?: number;
  modelVersionId?: string | null;
}

/**
 * Runs the reanalysis SLR backtest for one resort over [startDate, endDate],
 * writing one accuracy_log row per day that has both a reanalysis reading
 * and SNOTEL ground truth. Ensures SNOTEL coverage for the range first
 * (backfillSnotelActualsForResort) since most resorts won't have historical
 * snotel_actuals rows yet — this is the same AWDB pull the live cron does,
 * just pointed at a historical range instead of "the last 10 days."
 */
export async function runSlrReanalysisBacktestForResort(
  resort: Resort,
  startDate: string,
  endDate: string,
  overrides: SlrReanalysisBacktestOverrides = {}
): Promise<SlrReanalysisBacktestSummary> {
  if (!resort.snotel_station_triplet) {
    return { resortSlug: resort.slug, daysCompared: 0, daysSkipped: 0, error: "no SNOTEL station resolved for this resort" };
  }

  const db = getServiceDb();

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

    const weather = await fetchHistoricalWeather({ resort, elevationM: resort.elevation_mid_m, startDate, endDate });
    const buckets = bucketHourlyReanalysisByLocalDay(weather.hourly, resort.timezone);

    let daysCompared = 0;
    let daysSkipped = 0;

    for (const bucket of buckets) {
      const result = computeSlrBacktestDay({
        bucket,
        calibrationMultiplier: overrides.calibrationMultiplier ?? resort.slr_calibration_multiplier,
        observedSnowfallIn: observedByDate.get(bucket.date) ?? null,
        slrStrategyName: overrides.slrStrategyName,
      });
      if (!result) {
        daysSkipped += 1;
        continue;
      }

      const { error: upsertError } = await db.from("accuracy_log").upsert(
        {
          resort_id: resort.id,
          snow_score_id: null,
          target_date: bucket.date,
          predicted_snowfall_in: result.predictedSnowfallIn,
          observed_equivalent_in: result.observedSnowfallIn,
          accuracy_error_in: result.errorIn,
          lead_time_hours_at_prediction: SLR_REANALYSIS_BACKTEST_LEAD_TIME_HOURS,
          source: "slr_reanalysis_backtest",
          model_version_id: overrides.modelVersionId ?? null,
        },
        { onConflict: "resort_id,target_date,lead_time_hours_at_prediction,source,model_version_id" }
      );
      if (upsertError) throw upsertError;
      daysCompared += 1;
    }

    return { resortSlug: resort.slug, daysCompared, daysSkipped };
  } catch (err) {
    return { resortSlug: resort.slug, daysCompared: 0, daysSkipped: 0, error: (err as Error).message };
  }
}
