/**
 * Scoring orchestrator (BUILD_PRIMER section 5, AGENT_DIRECTIVE step 3).
 * Runs the full reconcile -> ensemble-confidence -> SLR -> powder-score
 * pipeline for one resort/target-date, using the primary (mid) elevation
 * band as the representative band for the single snow_scores row per
 * resort/day (see PRIMARY_SCORING_ELEVATION_BAND in lib/config/constants.ts).
 */

import { getServiceDb } from "@/lib/db/client";
import { DEFAULT_SLR_STRATEGY } from "@/lib/config/constants";
import type { ModelName, Resort } from "@/lib/db/types";
import {
  dailyAvgCloudCoverPct,
  dailyAvgTempC,
  dailyAvgWindSpeedKmh,
  dailyMaxWindGustKmh,
  dailyPrecipTotalMm,
  fetchEnsembleMemberTotalsForDay,
  fetchLatestModelRunsForDay,
  fetchSeasonalMaxSnowfallIn,
  maxAcrossModels,
  meanAcrossModels,
  precipWeightedTmaxC,
  primaryModelForLeadTime,
} from "./aggregate";
import { scoreEnsembleConfidence } from "./ensemble-confidence";
import { computeLeadTimeFit, computeNormalizedSnowfall, computePowderScore } from "./powder-score";
import { reconcileModels } from "./reconciliation";
import { getSlrStrategy } from "./slr";
import { estimateWindHoldProbability } from "./wind-hold";
import { addCalendarDays, localDateRangeToUtc, localTodayIso } from "@/lib/utils/timezone";

export interface ScoreComputation {
  resortId: string;
  targetDate: string;
  reconciledSweMm: number;
  disagreementFlag: boolean;
  modelAgreementScore: number;
  ensembleSpreadScore: number;
  confidenceLabel: "low" | "medium" | "high";
  slrStrategy: string;
  snowToLiquidRatio: number;
  isRainCase: boolean;
  estimatedSnowfallIn: number;
  normalizedSnowfall: number;
  leadTimeHours: number;
  leadTimeFit: number;
  powderScore: number;
  avgTempC: number | null;
  avgWindSpeedKmh: number | null;
  maxWindGustKmh: number | null;
  avgCloudCoverPct: number | null;
  windHoldProbability: number | null;
}

/** Hours from `now` until the target date's LOCAL midnight (the resort's ski-day start), not UTC midnight. */
function leadTimeHoursFor(targetDateIso: string, timeZone: string, now: Date): number {
  const { start } = localDateRangeToUtc(targetDateIso, timeZone);
  return Math.max(0, (new Date(start).getTime() - now.getTime()) / (1000 * 60 * 60));
}

export async function computeScoreForResortDay(
  resort: Resort,
  targetDateIso: string,
  now: Date = new Date()
): Promise<ScoreComputation | null> {
  const leadTimeHours = leadTimeHoursFor(targetDateIso, resort.timezone, now);
  const modelRuns = await fetchLatestModelRunsForDay(resort.id, targetDateIso, resort.timezone);
  const availableModels = Object.keys(modelRuns) as ModelName[];
  if (availableModels.length === 0) return null;

  const modelDailyTotals: Partial<Record<ModelName, number>> = {};
  for (const model of availableModels) {
    modelDailyTotals[model] = dailyPrecipTotalMm(modelRuns[model] ?? []);
  }

  const reconciliation = reconcileModels(modelDailyTotals, leadTimeHours);

  const ensembleMemberTotals = await fetchEnsembleMemberTotalsForDay(resort.id, targetDateIso, resort.timezone);
  const ensembleConfidence = scoreEnsembleConfidence(ensembleMemberTotals, reconciliation.disagreementFlag);

  const primaryModel = primaryModelForLeadTime(leadTimeHours, availableModels) ?? availableModels[0]!;
  const tmaxC = precipWeightedTmaxC(modelRuns[primaryModel] ?? []);

  const slrStrategy = getSlrStrategy(DEFAULT_SLR_STRATEGY);
  const slrResult = slrStrategy.computeRatio({
    tmaxC,
    calibrationMultiplier: resort.slr_calibration_multiplier,
  });

  const estimatedSnowfallIn = slrResult.isRainCase
    ? 0
    : (reconciliation.reconciledValue * slrResult.ratio) / 25.4;

  const seasonalMaxIn = await fetchSeasonalMaxSnowfallIn(resort.id);
  const normalizedSnowfall = computeNormalizedSnowfall(estimatedSnowfallIn, seasonalMaxIn);
  const leadTimeFit = computeLeadTimeFit(leadTimeHours);

  const powderScore = computePowderScore({
    normalizedSnowfall,
    confidenceLabel: ensembleConfidence.confidenceLabel,
    leadTimeFit,
  });

  // Display-only daily weather/wind summary (resort detail page) — averaged
  // across whichever models reported a day, not part of the scoring math
  // above. See lib/scoring/aggregate.ts header on meanAcrossModels/maxAcrossModels.
  const avgTempC = meanAcrossModels(availableModels.map((m) => dailyAvgTempC(modelRuns[m] ?? [])));
  const avgWindSpeedKmh = meanAcrossModels(availableModels.map((m) => dailyAvgWindSpeedKmh(modelRuns[m] ?? [])));
  const maxWindGustKmh = maxAcrossModels(availableModels.map((m) => dailyMaxWindGustKmh(modelRuns[m] ?? [])));
  const avgCloudCoverPct = meanAcrossModels(availableModels.map((m) => dailyAvgCloudCoverPct(modelRuns[m] ?? [])));
  const windHoldProbability = estimateWindHoldProbability({ maxWindGustKmh, avgWindSpeedKmh });

  return {
    resortId: resort.id,
    targetDate: targetDateIso,
    reconciledSweMm: reconciliation.reconciledValue,
    disagreementFlag: reconciliation.disagreementFlag,
    modelAgreementScore: reconciliation.modelAgreementScore,
    ensembleSpreadScore: ensembleConfidence.ensembleSpreadScore,
    confidenceLabel: ensembleConfidence.confidenceLabel,
    slrStrategy: slrResult.strategy,
    snowToLiquidRatio: slrResult.ratio,
    isRainCase: slrResult.isRainCase,
    estimatedSnowfallIn,
    normalizedSnowfall,
    leadTimeHours,
    leadTimeFit,
    powderScore,
    avgTempC,
    avgWindSpeedKmh,
    maxWindGustKmh,
    avgCloudCoverPct,
    windHoldProbability,
  };
}

/**
 * The next `n` calendar dates starting from the resort's own LOCAL today,
 * not UTC today.
 *
 * BUG FIXED (found while building the resort detail page, same class as
 * the aggregate.ts/nws.ts fix): this previously took one `now` Date and
 * sliced its UTC ISO string, computed once outside the per-resort loop and
 * reused for every resort regardless of timezone. For US timezones (always
 * behind UTC), UTC's calendar date rolls over to "tomorrow" several hours
 * before any US resort's local midnight — e.g. at 6pm Mountain time, it's
 * already past midnight UTC the next day. During that multi-hour window
 * (roughly evening through early morning local time, every single day),
 * the date list would start at local tomorrow instead of local today,
 * silently skipping today's target_date entirely for a large fraction of
 * each day's cron runs. Fixed by resolving each resort's own local today
 * via localTodayIso(timeZone) and stepping forward with calendar-date
 * arithmetic (addCalendarDays), not millisecond arithmetic.
 */
export function nextNDates(n: number, timeZone: string, now: Date = new Date()): string[] {
  const today = localTodayIso(timeZone, now);
  const dates: string[] = [today];
  for (let i = 1; i < n; i++) dates.push(addCalendarDays(today, i));
  return dates;
}

/** Computes and persists snow_scores rows for every active resort across the forecast horizon. */
export async function runScoringForAllResorts(
  horizonDays = 10
): Promise<{ resorts: number; scoresWritten: number; errors: string[] }> {
  const db = getServiceDb();
  const { data, error } = await db.from("resorts").select("*").eq("active", true);
  if (error) throw error;
  const resorts = (data ?? []) as Resort[];

  let scoresWritten = 0;
  const errors: string[] = [];

  for (const resort of resorts) {
    // Per-resort, not hoisted above the loop — see nextNDates' own doc
    // comment for why a single shared date list was a real bug.
    const targetDates = nextNDates(horizonDays, resort.timezone);
    for (const targetDate of targetDates) {
      try {
        const score = await computeScoreForResortDay(resort, targetDate);
        if (!score) continue;

        const { error: insertError } = await db.from("snow_scores").insert({
          resort_id: score.resortId,
          target_date: score.targetDate,
          reconciled_swe_mm: score.reconciledSweMm,
          disagreement_flag: score.disagreementFlag,
          model_agreement_score: score.modelAgreementScore,
          ensemble_spread_score: score.ensembleSpreadScore,
          confidence_label: score.confidenceLabel,
          slr_strategy: score.slrStrategy,
          snow_to_liquid_ratio: score.snowToLiquidRatio,
          is_rain_case: score.isRainCase,
          estimated_snowfall_in: score.estimatedSnowfallIn,
          normalized_snowfall: score.normalizedSnowfall,
          lead_time_hours: score.leadTimeHours,
          lead_time_fit: score.leadTimeFit,
          powder_score: score.powderScore,
          avg_temp_c: score.avgTempC,
          avg_wind_speed_kmh: score.avgWindSpeedKmh,
          max_wind_gust_kmh: score.maxWindGustKmh,
          avg_cloud_cover_pct: score.avgCloudCoverPct,
          wind_hold_probability: score.windHoldProbability,
        });
        if (insertError) throw insertError;
        scoresWritten += 1;
      } catch (err) {
        errors.push(`${resort.slug}/${targetDate}: ${(err as Error).message}`);
      }
    }
  }

  return { resorts: resorts.length, scoresWritten, errors };
}
