/**
 * Ensemble confidence scoring (BUILD_PRIMER section 5.2). Independent
 * signal from model reconciliation (section 5.1) — both are checked, and
 * disagreement between models downgrades the ensemble-derived confidence
 * label by one tier as a cross-check.
 */

import { ENSEMBLE_CONFIDENCE_THRESHOLDS, ENSEMBLE_SPREAD_NORMALIZATION_CEILING_MM } from "@/lib/config/constants";
import type { ConfidenceLabel } from "@/lib/db/types";

/** Optional override — see ReconciliationConfigOverride's doc comment; same backward-compatibility guarantee. */
export interface EnsembleConfidenceConfigOverride {
  thresholds?: { HIGH_MIN: number; MEDIUM_MIN: number };
  spreadNormalizationCeilingMm?: number;
}

export interface EnsembleConfidenceResult {
  ensembleSpreadScore: number;
  confidenceLabel: ConfidenceLabel;
  downgradedForDisagreement: boolean;
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function labelForSpreadScore(spreadScore: number, thresholds: { HIGH_MIN: number; MEDIUM_MIN: number }): ConfidenceLabel {
  if (spreadScore > thresholds.HIGH_MIN) return "high";
  if (spreadScore >= thresholds.MEDIUM_MIN) return "medium";
  return "low";
}

function downgrade(label: ConfidenceLabel): ConfidenceLabel {
  if (label === "high") return "medium";
  if (label === "medium") return "low";
  return "low";
}

/**
 * `memberValues` are the ensemble members' SWE values (mm) for the target
 * date/band. `disagreementFlag` comes from the independent multi-model
 * reconciliation check (lib/scoring/reconciliation.ts) — both signals are
 * evaluated before the final label is chosen, per section 5.2.
 */
export function scoreEnsembleConfidence(
  memberValues: number[],
  disagreementFlag: boolean,
  configOverride?: EnsembleConfidenceConfigOverride
): EnsembleConfidenceResult {
  const sd = stdDev(memberValues);
  const ceilingMm = configOverride?.spreadNormalizationCeilingMm ?? ENSEMBLE_SPREAD_NORMALIZATION_CEILING_MM;
  const tightnessRaw = 1 - sd / ceilingMm;
  const ensembleSpreadScore = Math.max(0, Math.min(1, tightnessRaw));

  const rawLabel = labelForSpreadScore(ensembleSpreadScore, configOverride?.thresholds ?? ENSEMBLE_CONFIDENCE_THRESHOLDS);
  const confidenceLabel = disagreementFlag ? downgrade(rawLabel) : rawLabel;

  return {
    ensembleSpreadScore,
    confidenceLabel,
    downgradedForDisagreement: disagreementFlag && confidenceLabel !== rawLabel,
  };
}
