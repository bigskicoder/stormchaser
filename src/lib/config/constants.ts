/**
 * Named configuration constants for the scoring engine and alerting.
 * BUILD_PRIMER section 10.3: "All scoring thresholds/weights are named
 * configuration constants, not magic numbers inline." Nothing in
 * lib/scoring or lib/alerts should hardcode a number that appears here.
 */

import type { ModelName } from "@/lib/db/types";

// ---------------------------------------------------------------------------
// 5.1 Multi-model reconciliation weights, bucketed by lead time
// ---------------------------------------------------------------------------
export type LeadTimeBucket = "T0_48" | "T48_120" | "T120_PLUS";

export const LEAD_TIME_BUCKET_BOUNDS_HOURS = {
  T0_48: { min: 0, max: 48 },
  T48_120: { min: 48, max: 120 },
  T120_PLUS: { min: 120, max: Infinity },
} as const;

export function leadTimeBucketFor(leadTimeHours: number): LeadTimeBucket {
  if (leadTimeHours <= LEAD_TIME_BUCKET_BOUNDS_HOURS.T0_48.max) return "T0_48";
  if (leadTimeHours <= LEAD_TIME_BUCKET_BOUNDS_HOURS.T48_120.max) return "T48_120";
  return "T120_PLUS";
}

/** Model weights per lead-time bucket (BUILD_PRIMER section 5.1). Must sum to 1 per bucket. */
export const MODEL_WEIGHTS_BY_BUCKET: Record<LeadTimeBucket, Partial<Record<ModelName, number>>> = {
  T0_48: { hrrr: 0.5, gfs: 0.2, icon: 0.15, ecmwf: 0.15 },
  T48_120: { gfs: 0.3, ecmwf: 0.35, icon: 0.2, gem: 0.15 },
  // HRRR has no skill / is unavailable beyond ~T+48h — dropped from the blend.
  T120_PLUS: { ecmwf: 0.45, gfs: 0.3, gem: 0.25 },
};

/** (max-min)/mean model spread threshold above which disagreement_flag is set. */
export const MODEL_DISAGREEMENT_THRESHOLD = 0.4;

// ---------------------------------------------------------------------------
// 5.2 Ensemble confidence scoring
// ---------------------------------------------------------------------------
export const ENSEMBLE_CONFIDENCE_THRESHOLDS = {
  HIGH_MIN: 0.7,
  MEDIUM_MIN: 0.4,
} as const;

/**
 * Normalization ceiling for ensemble member std-dev (mm SWE) used to convert
 * raw spread into a 0-1 "tightness" score before inversion. Values at or
 * above this spread are floored to spread_score = 0 (i.e. lowest confidence).
 * Tunable post-backtest; not derived from a specific paper, an engineering
 * default sized to typical multi-day SWE ensemble spread magnitudes.
 */
export const ENSEMBLE_SPREAD_NORMALIZATION_CEILING_MM = 25;

// ---------------------------------------------------------------------------
// 5.3 Snow-to-liquid ratio (SLR)
// ---------------------------------------------------------------------------
export const DEFAULT_SLR_STRATEGY = "kuchera" as const;

/** Fixed-ratio baseline per Veals et al. 2025 — used as a backtest sanity check, not production default. */
export const FIXED_SLR_RATIO = 12.0;

/** Kuchera method threshold split point: 271.16 K (~-2.01°C / ~28.1°F). */
export const KUCHERA_THRESHOLD_KELVIN = 271.16;

// ---------------------------------------------------------------------------
// 5.4 Composite powder_score
// ---------------------------------------------------------------------------
export const POWDER_SCORE_WEIGHTS = {
  SNOWFALL: 0.5,
  CONFIDENCE: 0.35,
  LEAD_TIME_FIT: 0.15,
} as const;

export const CONFIDENCE_WEIGHT_BY_LABEL = {
  high: 1.0,
  medium: 0.6,
  low: 0.3,
} as const;

/** "Actionable window" (hours) within which lead_time_fit = 1.0, decaying outside it. */
export const ACTIONABLE_WINDOW_HOURS = { min: 24, max: 96 } as const;

/**
 * Decay rate outside the actionable window, in lead_time_fit units lost per
 * hour beyond the window edge. Linear decay, floored at 0.
 */
export const LEAD_TIME_FIT_DECAY_PER_HOUR = 0.01;

/** Rolling window (days) used to compute each resort's seasonal max snowfall for normalization. */
export const SEASONAL_MAX_ROLLING_WINDOW_DAYS = 120;

/**
 * Cold-start fallback ceiling (inches) for normalizing snowfall before any
 * scoring history exists for a resort. Purely a bootstrap value so
 * powder_score isn't undefined on day one — gets superseded by real rolling
 * history within SEASONAL_MAX_ROLLING_WINDOW_DAYS of live operation.
 */
export const SEASONAL_MAX_BOOTSTRAP_DEFAULT_IN = 24;

/** Which elevation band drives the single per-resort/day snow_scores row. Base/summit stay queryable in forecast_pulls for future band-specific display. */
export const PRIMARY_SCORING_ELEVATION_BAND = "mid" as const;

// ---------------------------------------------------------------------------
// 7. Alerting
// ---------------------------------------------------------------------------
export const ALERT_POWDER_SCORE_THRESHOLD = 0.7;
export const ALERT_RATE_LIMIT_HOURS_PER_RESORT = 24;

// ---------------------------------------------------------------------------
// 2.1a Elevation onboarding check
// ---------------------------------------------------------------------------
export const ELEVATION_DISCREPANCY_FLAG_THRESHOLD_M = 150;

// ---------------------------------------------------------------------------
// ROADMAP Phase B — self-tuning SLR calibration (recommend-only).
// Guardrails as designed in ROADMAP.md: a minimum sample size before any
// recommendation is generated, a bounded step size per update, and hard
// bounds on the multiplier itself so one bad storm can't swing a resort's
// calibration wildly. Recommend-only per the roadmap's default — nothing
// here writes to resorts.slr_calibration_multiplier without an admin
// approving it (see lib/calibration/apply.ts).
// ---------------------------------------------------------------------------

/** Minimum accuracy_log sample count (source='powder_alert') before a resort is eligible for a recommendation at all. */
export const CALIBRATION_MIN_SAMPLE_SIZE = 15;

/** Rolling lookback window (days) of accuracy_log history considered per recommendation. */
export const CALIBRATION_LOOKBACK_DAYS = 120;

/** Max fractional change to the multiplier per recommendation (e.g. 0.05 = ±5%). */
export const CALIBRATION_MAX_STEP_FRACTION = 0.05;

/** Hard bounds on resorts.slr_calibration_multiplier — a recommendation is clamped into this range, never outside it. */
export const CALIBRATION_MULTIPLIER_BOUNDS = { min: 0.7, max: 1.4 } as const;

/** Skip generating a new recommendation for a resort while one is still pending review, to avoid pileup. */
export const CALIBRATION_SKIP_IF_PENDING_EXISTS = true;
