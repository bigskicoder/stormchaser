/**
 * Composite powder_score (BUILD_PRIMER section 5.4). All weights/thresholds
 * are named constants imported from lib/config/constants.ts — never inline
 * magic numbers, per section 10.3.
 */

import {
  ACTIONABLE_WINDOW_HOURS,
  CONFIDENCE_WEIGHT_BY_LABEL,
  LEAD_TIME_FIT_DECAY_PER_HOUR,
  POWDER_SCORE_WEIGHTS,
} from "@/lib/config/constants";
import type { ConfidenceLabel } from "@/lib/db/types";

/**
 * 1.0 inside the actionable window [min, max] hours out; decays linearly
 * outside it at LEAD_TIME_FIT_DECAY_PER_HOUR per hour, floored at 0. Applies
 * symmetrically both to very-short lead times (storm is closer than the
 * window, so plan-ahead value is lower) and very-long lead times (forecast
 * confidence hasn't matured yet).
 */
export function computeLeadTimeFit(leadTimeHours: number): number {
  const { min, max } = ACTIONABLE_WINDOW_HOURS;
  if (leadTimeHours >= min && leadTimeHours <= max) return 1.0;
  const hoursOutside = leadTimeHours < min ? min - leadTimeHours : leadTimeHours - max;
  return Math.max(0, 1 - hoursOutside * LEAD_TIME_FIT_DECAY_PER_HOUR);
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
}

export function computePowderScore(input: PowderScoreInput): number {
  const confidenceWeight = CONFIDENCE_WEIGHT_BY_LABEL[input.confidenceLabel];
  const score =
    POWDER_SCORE_WEIGHTS.SNOWFALL * input.normalizedSnowfall +
    POWDER_SCORE_WEIGHTS.CONFIDENCE * confidenceWeight +
    POWDER_SCORE_WEIGHTS.LEAD_TIME_FIT * input.leadTimeFit;
  return Math.max(0, Math.min(1, score));
}
