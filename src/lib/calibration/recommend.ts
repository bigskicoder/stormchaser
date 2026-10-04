/**
 * ROADMAP Phase B — self-tuning SLR calibration, recommend-only.
 *
 * Pure update-rule logic, deliberately separated from DB access (same
 * pattern as lib/scoring/reconciliation.ts vs lib/scoring/aggregate.ts):
 * a simple bounded proportional controller, not a black box. Given recent
 * (predicted, error) pairs for a resort, proposes a new
 * slr_calibration_multiplier — never applies it. See
 * lib/calibration/generate.ts for the DB-facing orchestrator and
 * lib/calibration/apply.ts for the admin-approval write path.
 */

import {
  CALIBRATION_MAX_STEP_FRACTION,
  CALIBRATION_MIN_SAMPLE_SIZE,
  CALIBRATION_MULTIPLIER_BOUNDS,
} from "@/lib/config/constants";

export interface AccuracySample {
  /** accuracy_log.predicted_snowfall_in */
  predictedIn: number;
  /** accuracy_log.accuracy_error_in — signed, predicted minus observed. Positive = we over-predicted. */
  errorIn: number;
}

export interface CalibrationRecommendationResult {
  eligible: boolean;
  reason?: string;
  sampleCount: number;
  meanSignedErrorIn: number;
  recommendedMultiplier: number;
}

/**
 * Proportional-controller-style update: nudges the multiplier opposite the
 * mean signed error, scaled relative to the mean predicted amount so the
 * step is a meaningful fraction of typical storm size rather than a fixed
 * inch value. Clamped to CALIBRATION_MAX_STEP_FRACTION per call and to
 * CALIBRATION_MULTIPLIER_BOUNDS overall — deliberately conservative, since
 * this proposes a change a human reviews, not one that silently compounds.
 */
export function computeCalibrationRecommendation(
  currentMultiplier: number,
  samples: AccuracySample[]
): CalibrationRecommendationResult {
  const sampleCount = samples.length;

  if (sampleCount < CALIBRATION_MIN_SAMPLE_SIZE) {
    return {
      eligible: false,
      reason: `only ${sampleCount} samples, need at least ${CALIBRATION_MIN_SAMPLE_SIZE}`,
      sampleCount,
      meanSignedErrorIn: 0,
      recommendedMultiplier: currentMultiplier,
    };
  }

  const meanSignedErrorIn = samples.reduce((sum, s) => sum + s.errorIn, 0) / sampleCount;
  const meanPredictedIn = samples.reduce((sum, s) => sum + s.predictedIn, 0) / sampleCount;

  if (meanPredictedIn <= 0) {
    return {
      eligible: false,
      reason: "mean predicted snowfall is zero — nothing to calibrate against",
      sampleCount,
      meanSignedErrorIn,
      recommendedMultiplier: currentMultiplier,
    };
  }

  // Positive error (over-predicting) -> negative adjustment (lower the ratio).
  const rawAdjustmentFraction = -meanSignedErrorIn / meanPredictedIn;
  const clampedAdjustmentFraction = Math.max(
    -CALIBRATION_MAX_STEP_FRACTION,
    Math.min(CALIBRATION_MAX_STEP_FRACTION, rawAdjustmentFraction)
  );

  const rawRecommended = currentMultiplier * (1 + clampedAdjustmentFraction);
  const recommendedMultiplier = Math.max(
    CALIBRATION_MULTIPLIER_BOUNDS.min,
    Math.min(CALIBRATION_MULTIPLIER_BOUNDS.max, rawRecommended)
  );

  return { eligible: true, sampleCount, meanSignedErrorIn, recommendedMultiplier };
}
