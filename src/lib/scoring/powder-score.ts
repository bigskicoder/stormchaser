/**
 * Composite powder_score (BUILD_PRIMER section 5.4). All weights/thresholds
 * are named constants imported from lib/config/constants.ts — never inline
 * magic numbers, per section 10.3.
 */

import {
  ACTIONABLE_WINDOW_HOURS,
  CONFIDENCE_WEIGHT_BY_LABEL,
  FULL_CREDIT_SNOWFALL_IN,
  LEAD_TIME_FIT_DECAY_PER_HOUR,
  POWDER_SCORE_WEIGHTS,
} from "@/lib/config/constants";
import type { ConfidenceLabel } from "@/lib/db/types";

/** Optional override — see ReconciliationConfigOverride's doc comment; same backward-compatibility guarantee. */
export interface LeadTimeFitConfigOverride {
  actionableWindowHours?: { min: number; max: number };
  decayPerHour?: number;
}

export interface PowderScoreConfigOverride {
  weights?: { SNOWFALL: number; CONFIDENCE: number; LEAD_TIME_FIT: number };
  confidenceWeightByLabel?: { high: number; medium: number; low: number };
}

/**
 * 1.0 inside the actionable window [min, max] hours out; decays linearly
 * outside it at LEAD_TIME_FIT_DECAY_PER_HOUR per hour, floored at 0. Applies
 * symmetrically both to very-short lead times (storm is closer than the
 * window, so plan-ahead value is lower) and very-long lead times (forecast
 * confidence hasn't matured yet).
 */
export function computeLeadTimeFit(leadTimeHours: number, configOverride?: LeadTimeFitConfigOverride): number {
  const { min, max } = configOverride?.actionableWindowHours ?? ACTIONABLE_WINDOW_HOURS;
  const decayPerHour = configOverride?.decayPerHour ?? LEAD_TIME_FIT_DECAY_PER_HOUR;
  if (leadTimeHours >= min && leadTimeHours <= max) return 1.0;
  const hoursOutside = leadTimeHours < min ? min - leadTimeHours : leadTimeHours - max;
  return Math.max(0, 1 - hoursOutside * decayPerHour);
}

/** Normalizes estimated snowfall against a rolling seasonal max for the resort (0-1, clamped). */
export function computeNormalizedSnowfall(estimatedSnowfallIn: number, seasonalMaxIn: number): number {
  if (seasonalMaxIn <= 0) return 0;
  return Math.max(0, Math.min(1, estimatedSnowfallIn / seasonalMaxIn));
}

export interface PowderScoreInput {
  normalizedSnowfall: number;
  confidenceLabel: ConfidenceLabel;
  leadTimeFit: number;
  /**
   * Forecast snowfall in inches. Scales the confidence and lead-time terms
   * (see FULL_CREDIT_SNOWFALL_IN). Omitted, they count in full, the
   * original behavior.
   */
  estimatedSnowfallIn?: number;
}

export function computePowderScore(input: PowderScoreInput, configOverride?: PowderScoreConfigOverride): number {
  const weights = configOverride?.weights ?? POWDER_SCORE_WEIGHTS;
  const confidenceWeightByLabel = configOverride?.confidenceWeightByLabel ?? CONFIDENCE_WEIGHT_BY_LABEL;
  const confidenceWeight = confidenceWeightByLabel[input.confidenceLabel];
  const snowCredit =
    input.estimatedSnowfallIn == null ? 1 : Math.max(0, Math.min(1, input.estimatedSnowfallIn / FULL_CREDIT_SNOWFALL_IN));
  const score =
    weights.SNOWFALL * input.normalizedSnowfall +
    snowCredit * (weights.CONFIDENCE * confidenceWeight + weights.LEAD_TIME_FIT * input.leadTimeFit);
  return Math.max(0, Math.min(1, score));
}
