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
  dailyPrecipTotalMm,
  fetchEnsembleMemberTotalsForDay,
  fetchLatestModelRunsForDay,
  fetchSeasonalMaxSnowfallIn,
  precipWeightedTmaxC,
  primaryModelForLeadTime,
} from "./aggregate";
import { scoreEnsembleConfidence } from "./ensemble-confidence";
import { computeLeadTimeFit, computeNormalizedSnowfall, computePowderScore } from "./powder-score";
import { reconcileModels } from "./reconciliation";
import { getSlrStrategy } from "./slr";
import { localDateRangeToUtc } from "@/lib/utils/timezone";

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
  };
}

function nextNDates(n: number, from: Date = new Date()): string[] {
  const dates: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(from.getTime() + i * 24 * 60 * 60 * 1000);
    dates.push(d.toISOString().slice(0, 10));
  }
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

  const targetDates = nextNDates(horizonDays);
  let scoresWritten = 0;
  const errors: string[] = [];

  for (const resort of resorts) {
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
