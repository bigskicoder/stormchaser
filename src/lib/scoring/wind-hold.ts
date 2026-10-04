/**
 * Wind-hold-probability estimate for the resort detail page, requested
 * directly ("if we can factor in some kind of wind hold probability
 * calculation as well that would be good"). This codebase has no
 * per-resort/per-lift wind-hold threshold data (that's each resort's own
 * operational policy, not published anywhere this pipeline ingests), so
 * this is deliberately a generic, documented estimate — see the constants'
 * header comment in lib/config/constants.ts for the thresholds used and why.
 * Surfaced in the UI as an estimate, never as a guarantee.
 */

import {
  WIND_HOLD_GUST_FROM_SUSTAINED_MULTIPLIER,
  WIND_HOLD_LOGISTIC_MIDPOINT_KMH,
  WIND_HOLD_LOGISTIC_STEEPNESS,
} from "@/lib/config/constants";

/**
 * Returns a 0-1 estimate of the probability that wind conditions would
 * cause lift holds, from a day's max wind gust (preferred) or average
 * sustained wind speed (fallback, scaled up to approximate an effective
 * gust — see WIND_HOLD_GUST_FROM_SUSTAINED_MULTIPLIER). Returns null when
 * neither is available, rather than guessing.
 */
export function estimateWindHoldProbability(params: {
  maxWindGustKmh: number | null;
  avgWindSpeedKmh: number | null;
}): number | null {
  const { maxWindGustKmh, avgWindSpeedKmh } = params;

  const effectiveGustKmh =
    maxWindGustKmh ?? (avgWindSpeedKmh != null ? avgWindSpeedKmh * WIND_HOLD_GUST_FROM_SUSTAINED_MULTIPLIER : null);
  if (effectiveGustKmh == null) return null;

  const x = WIND_HOLD_LOGISTIC_STEEPNESS * (effectiveGustKmh - WIND_HOLD_LOGISTIC_MIDPOINT_KMH);
  const probability = 1 / (1 + Math.exp(-x));
  return Math.min(1, Math.max(0, probability));
}
