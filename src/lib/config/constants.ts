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

/**
 * kuchera-wind strategy (src/lib/scoring/slr/kuchera-wind.ts) — EXPERIMENTAL,
 * built to generate real season-1 shadow-scoring comparison data, not a
 * reproduction of Veals et al. 2025's actual fitted wind+temperature
 * regression (that paper's own coefficients were never published in a form
 * this codebase could verify — see README's "Flagged assumptions"). These
 * two constants instead apply a conservative, literature-motivated
 * DIRECTION on top of the existing Kuchera curve: higher wind -> denser,
 * wind-packed/rimed snow -> lower SLR, a well-established qualitative
 * relationship in snow science, not a precisely fitted one here.
 */
/** Fractional SLR-ratio reduction per km/h of mean daily wind speed. 0.003 = 0.3% per km/h (12% reduction at 40km/h, 24% at 80km/h) — a deliberately modest magnitude pending real backtest validation, not a derived coefficient. */
export const WIND_SLR_ADJUSTMENT_PER_KMH = 0.003;
/** Floor on the wind-adjustment factor — the ratio is never reduced below this fraction of its wind-free value, however extreme the wind input, so a data gap or an outlier gust can't zero out an otherwise-reasonable forecast. */
export const WIND_SLR_ADJUSTMENT_FLOOR = 0.6;

// ---------------------------------------------------------------------------
// 5.4 Composite powder_score
// ---------------------------------------------------------------------------
/**
 * Forecast snowfall (inches) at which confidence and lead-time fit earn
 * their full share of the powder score. Below it they scale down linearly,
 * so a confident 0" day scores 0 rather than 50 (Nick, 2026-10-18; the
 * first live dry week tied every resort at 50). 6" matches POWDER_DAY_IN.
 */
export const FULL_CREDIT_SNOWFALL_IN = 6;

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

/**
 * Farthest a SNOTEL station can be from a resort and still count as its
 * ground truth. Every western resort here has a SNTL site within ~10 km;
 * past this, terrain and elevation differ too much for the station's daily
 * depth change to say anything about the resort. Resorts with nothing in
 * range get no station (Stowe has the Mansfield stake instead).
 */
export const SNOTEL_MAX_STATION_DISTANCE_KM = 40;

// ---------------------------------------------------------------------------
// ROADMAP Phase B — self-tuning SLR calibration (recommend-only).
// Guardrails as designed in ROADMAP.md: a minimum sample size before any
// recommendation is generated, a bounded step size per update, and hard
// bounds on the multiplier itself so one bad storm can't swing a resort's
// calibration wildly. Recommend-only per the roadmap's default — nothing
// here writes to resorts.slr_calibration_multiplier without an admin
// approving it (see lib/calibration/apply.ts).
// ---------------------------------------------------------------------------

/** Minimum pooled accuracy_log sample count (live 'powder_alert' + the two backtest sources, see CALIBRATION_BACKTEST_SOURCES below) before a resort is eligible for a recommendation at all. */
export const CALIBRATION_MIN_SAMPLE_SIZE = 15;

/** Rolling lookback window (days) of accuracy_log history considered per recommendation. */
export const CALIBRATION_LOOKBACK_DAYS = 120;

/** Max fractional change to the multiplier per recommendation (e.g. 0.05 = ±5%). */
export const CALIBRATION_MAX_STEP_FRACTION = 0.05;

/** Hard bounds on resorts.slr_calibration_multiplier — a recommendation is clamped into this range, never outside it. */
export const CALIBRATION_MULTIPLIER_BOUNDS = { min: 0.7, max: 1.4 } as const;

/** Skip generating a new recommendation for a resort while one is still pending review, to avoid pileup. */
export const CALIBRATION_SKIP_IF_PENDING_EXISTS = true;

/**
 * accuracy_log sources pooled alongside live 'powder_alert' data when
 * computing a calibration recommendation — see lib/backtest/ for what each
 * one actually validates, and lib/calibration/generate.ts for how they're
 * combined. Not cut off by CALIBRATION_LOOKBACK_DAYS (a storm from years
 * ago run through today's SLR formula is still a valid data point about
 * that formula), but down-weighted by age — see
 * CALIBRATION_RECENCY_HALF_LIFE_YEARS.
 * This pooling is a methodological approximation, not a perfectly clean
 * blend — see lib/backtest/slr-reanalysis.ts's header for the one real
 * caveat (SLR-only error vs. end-to-end error). Acceptable given Phase B
 * stays bounded, recommend-only, and human-approved regardless of which
 * source proposed it.
 */
export const CALIBRATION_BACKTEST_SOURCES = ["slr_reanalysis_backtest", "reconciliation_forecast_backtest"] as const;

/**
 * Age at which a calibration sample counts half as much as one from today
 * (weight = 0.5 ^ (age in years / half-life)). Requested directly ("are
 * more recent years weighted more?"): without it, a full 40-year backtest
 * (~14,000 resort-days) drowns out a season of live results, and the
 * oldest reanalysis years rest on far fewer observations than recent ones.
 * 10 years keeps the 1980s at ~6% weight each rather than dropping them.
 * A judgment call, not a fitted value; change it here.
 */
export const CALIBRATION_RECENCY_HALF_LIFE_YEARS = 10;

/**
 * ENSO-specific multipliers (ROADMAP Phase B.6). A resort only gets its own
 * El Nino or La Nina multiplier proposed when its backtest error in that
 * phase differs from its neutral-winter error by at least this many
 * standard errors (Welch's t), with at least ENSO_MIN_PHASE_SAMPLES days on
 * both sides. 3 rather than the textbook 2 because consecutive days'
 * errors are correlated (one storm spans several days), which overstates
 * the effective sample size; this keeps the bar honest without modelling
 * the autocorrelation. Once a phase multiplier exists it keeps being
 * nudged like the base one, still bounded and still admin-approved.
 */
export const ENSO_SIGNIFICANCE_T = 3;
export const ENSO_MIN_PHASE_SAMPLES = 100;

// ---------------------------------------------------------------------------
// Resort detail page — wind-hold-probability estimate (lib/scoring/wind-hold.ts)
//
// NOT derived from any specific resort's actual lift wind-hold policy — this
// codebase has no per-lift/per-resort threshold data. These are generic
// ski-industry rule-of-thumb figures (high-speed quads/gondolas commonly
// start holding somewhere in the 35-45 mph sustained / higher-gust range),
// expressed as a smooth logistic curve rather than a hard cliff, since real
// hold decisions are operator judgment calls, not a fixed threshold. Treat
// the output as an informational estimate, flagged as such in the UI —
// never as a guarantee a lift will or won't run.
// ---------------------------------------------------------------------------

/** Wind-gust midpoint (km/h, ~40 mph) where the logistic curve crosses 50% hold probability. */
export const WIND_HOLD_LOGISTIC_MIDPOINT_KMH = 65;

/** Logistic steepness — tuned so probability is ~3% near 40 km/h gust and ~95%+ near 90 km/h gust. */
export const WIND_HOLD_LOGISTIC_STEEPNESS = 0.139;

/**
 * When only sustained wind speed is available (no gust data), approximate
 * an "effective gust" by scaling it up — gusts in storm conditions are
 * typically noticeably higher than sustained speed. A documented
 * approximation, not a measured gust factor for any specific site.
 */
export const WIND_HOLD_GUST_FROM_SUSTAINED_MULTIPLIER = 1.4;
