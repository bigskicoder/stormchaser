/**
 * The strict, runtime shape of a scoring configuration — what every scoring
 * pure function actually accepts, as opposed to ModelVersion (lib/db/types.ts),
 * which is the loosely-typed raw DB row. Kept in this separate file rather
 * than lib/db/types.ts specifically to avoid a circular import: this needs
 * LeadTimeBucket/ModelName from lib/config/constants.ts, and constants.ts
 * already imports ModelName from lib/db/types.ts — db/types.ts importing
 * back from here (or from constants.ts) would complete a cycle.
 *
 * DEFAULT_SCORING_CONFIG is built directly from the named constants in
 * lib/config/constants.ts, so that file remains the single source of truth
 * for "what the defaults are" — this is just a repackaging into the shape
 * the config-injectable scoring functions accept. It's also the fallback
 * every live scoring run uses until a baseline model_versions row exists
 * (see lib/model-versions/resolve.ts) and what every existing test exercises
 * implicitly by omitting the optional config parameter.
 */

import {
  ACTIONABLE_WINDOW_HOURS,
  CONFIDENCE_WEIGHT_BY_LABEL,
  ENSEMBLE_CONFIDENCE_THRESHOLDS,
  ENSEMBLE_SPREAD_NORMALIZATION_CEILING_MM,
  LEAD_TIME_FIT_DECAY_PER_HOUR,
  MODEL_DISAGREEMENT_THRESHOLD,
  MODEL_WEIGHTS_BY_BUCKET,
  POWDER_SCORE_WEIGHTS,
  type LeadTimeBucket,
} from "@/lib/config/constants";
import type { ModelName, ModelVersion, SlrStrategyName } from "@/lib/db/types";

export interface ScoringConfig {
  modelWeightsByBucket: Record<LeadTimeBucket, Partial<Record<ModelName, number>>>;
  modelDisagreementThreshold: number;
  ensembleConfidenceThresholds: { HIGH_MIN: number; MEDIUM_MIN: number };
  ensembleSpreadNormalizationCeilingMm: number;
  slrStrategyName: SlrStrategyName;
  powderScoreWeights: { SNOWFALL: number; CONFIDENCE: number; LEAD_TIME_FIT: number };
  confidenceWeightByLabel: { high: number; medium: number; low: number };
  actionableWindowHours: { min: number; max: number };
  leadTimeFitDecayPerHour: number;
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  modelWeightsByBucket: MODEL_WEIGHTS_BY_BUCKET,
  modelDisagreementThreshold: MODEL_DISAGREEMENT_THRESHOLD,
  ensembleConfidenceThresholds: ENSEMBLE_CONFIDENCE_THRESHOLDS,
  ensembleSpreadNormalizationCeilingMm: ENSEMBLE_SPREAD_NORMALIZATION_CEILING_MM,
  slrStrategyName: "kuchera",
  powderScoreWeights: POWDER_SCORE_WEIGHTS,
  confidenceWeightByLabel: CONFIDENCE_WEIGHT_BY_LABEL,
  actionableWindowHours: ACTIONABLE_WINDOW_HOURS,
  leadTimeFitDecayPerHour: LEAD_TIME_FIT_DECAY_PER_HOUR,
};

/** Narrows a raw model_versions DB row's loosely-typed JSONB columns into the strict ScoringConfig shape the scoring engine consumes. */
export function toScoringConfig(version: ModelVersion): ScoringConfig {
  return {
    modelWeightsByBucket: version.model_weights_by_bucket as ScoringConfig["modelWeightsByBucket"],
    modelDisagreementThreshold: version.model_disagreement_threshold,
    ensembleConfidenceThresholds: version.ensemble_confidence_thresholds,
    ensembleSpreadNormalizationCeilingMm: version.ensemble_spread_normalization_ceiling_mm,
    slrStrategyName: version.slr_strategy_name,
    powderScoreWeights: version.powder_score_weights,
    confidenceWeightByLabel: version.confidence_weight_by_label,
    actionableWindowHours: version.actionable_window_hours,
    leadTimeFitDecayPerHour: version.lead_time_fit_decay_per_hour,
  };
}

/** The flip side of toScoringConfig — used when snapshotting the current config (defaults or an existing version) into a new model_versions row. */
export function scoringConfigToVersionFields(
  config: ScoringConfig
): Pick<
  ModelVersion,
  | "model_weights_by_bucket"
  | "model_disagreement_threshold"
  | "ensemble_confidence_thresholds"
  | "ensemble_spread_normalization_ceiling_mm"
  | "slr_strategy_name"
  | "powder_score_weights"
  | "confidence_weight_by_label"
  | "actionable_window_hours"
  | "lead_time_fit_decay_per_hour"
> {
  return {
    model_weights_by_bucket: config.modelWeightsByBucket,
    model_disagreement_threshold: config.modelDisagreementThreshold,
    ensemble_confidence_thresholds: config.ensembleConfidenceThresholds,
    ensemble_spread_normalization_ceiling_mm: config.ensembleSpreadNormalizationCeilingMm,
    slr_strategy_name: config.slrStrategyName,
    powder_score_weights: config.powderScoreWeights,
    confidence_weight_by_label: config.confidenceWeightByLabel,
    actionable_window_hours: config.actionableWindowHours,
    lead_time_fit_decay_per_hour: config.leadTimeFitDecayPerHour,
  };
}
