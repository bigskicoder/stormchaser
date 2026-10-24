/** Hand-written types mirroring supabase/migrations/0001_init.sql. */

import type { EnsoAdjustablePhase } from "@/lib/enso/oni";

export type PassAffiliation = "epic" | "ikon" | "independent" | "none";
export type ElevationBand = "base" | "mid" | "summit";
export type ModelName = "hrrr" | "gfs" | "icon" | "ecmwf" | "gem";
export type ConfidenceLabel = "low" | "medium" | "high";
export type DeliveryStatus = "pending" | "sent" | "failed" | "skipped_rate_limited";
export type SocialPostStatus = "draft" | "approved" | "publishing" | "posted" | "failed";
/** 'kuchera-wind' is an experimental, explicitly-labeled hypothesis (not a reproduction of any published model) — see lib/scoring/slr/kuchera-wind.ts for the full rationale. */
export type SlrStrategyName = "kuchera" | "fixed-ratio" | "cobb-waldstreicher" | "kuchera-wind";
/**
 * accuracy_log.source — no DB-level CHECK constraint (see migration 0004's
 * comment), so this union is the only place new values are declared.
 * 'powder_alert' = live production predictions. 'nws' = the public-baseline
 * comparison (Phase A.1). 'slr_reanalysis_backtest' / 'reconciliation_forecast_backtest'
 * = the two historical backtest pipelines (lib/backtest/) — see their own
 * header comments for what each validates and why they're separate.
 */
export type AccuracyLogSource = "powder_alert" | "nws" | "slr_reanalysis_backtest" | "reconciliation_forecast_backtest";

export interface Resort {
  id: string;
  slug: string;
  name: string;
  pass_affiliation: PassAffiliation;
  state: string | null;
  lat: number;
  lng: number;
  elevation_base_m: number;
  elevation_mid_m: number;
  elevation_summit_m: number;
  elevation_checked_at: string | null;
  elevation_check_flag: boolean;
  elevation_check_notes: string | null;
  timezone: string;
  slr_calibration_multiplier: number;
  snotel_station_triplet: string | null;
  snotel_station_distance_km: number | null;
  snotel_resolved_at: string | null;
  nws_grid_id: string | null;
  nws_grid_x: number | null;
  nws_grid_y: number | null;
  nws_resolved_at: string | null;
  /** NOAA GHCND station id for a manually-researched, resort-specific ground-truth pairing (e.g. Stowe <-> the Mount Mansfield snow stake) — not resolved by a nearest-match search like snotel_station_triplet. See lib/ingestion/mansfield-stake.ts and migration 0011 for the "unverified, flagged" caveat on any seeded value. */
  ghcnd_station_id: string | null;
  /** Operator-curated iframe-embeddable webcam URL. Never scraped — see ROADMAP.md Phase D. */
  webcam_url: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ForecastPull {
  id: string;
  resort_id: string;
  model_name: ModelName;
  elevation_band: ElevationBand;
  run_init_time: string;
  valid_time: string;
  pulled_at: string;
  raw_payload: unknown;
  swe_mm: number | null;
  precip_mm: number | null;
  temp_c: number | null;
  wind_speed_kmh: number | null;
  wind_gust_kmh: number | null;
  wind_dir_deg: number | null;
  freezing_level_m: number | null;
  cloud_cover_pct: number | null;
  created_at: string;
}

export interface EnsemblePull {
  id: string;
  resort_id: string;
  elevation_band: ElevationBand;
  member_id: number;
  run_init_time: string;
  valid_time: string;
  pulled_at: string;
  swe_mm: number | null;
  created_at: string;
}

export interface SnowScore {
  id: string;
  resort_id: string;
  target_date: string;
  computed_at: string;
  reconciled_swe_mm: number;
  disagreement_flag: boolean;
  model_agreement_score: number;
  ensemble_spread_score: number;
  confidence_label: ConfidenceLabel;
  slr_strategy: SlrStrategyName;
  snow_to_liquid_ratio: number;
  /** True only when none of the day's precipitation falls as snow (hour-by-hour split since migration 0015). */
  is_rain_case: boolean;
  /** Share of the day's liquid falling as snow, 0-1; null on dry days and rows before migration 0015. */
  snow_fraction: number | null;
  /** Rain turning to snow or the reverse during the day, and the first hour of the new phase. */
  phase_change: "rain_to_snow" | "snow_to_rain" | null;
  phase_change_at: string | null;
  estimated_snowfall_in: number;
  normalized_snowfall: number;
  lead_time_hours: number;
  lead_time_fit: number;
  powder_score: number;
  /** Daily weather/wind summary + wind-hold estimate, computed once at scoring time (lib/scoring/run.ts). Nullable: a day's model runs may not report every field. */
  avg_temp_c: number | null;
  avg_wind_speed_kmh: number | null;
  max_wind_gust_kmh: number | null;
  avg_cloud_cover_pct: number | null;
  /** Generic lift-industry wind-hold estimate, NOT resort-specific — see lib/scoring/wind-hold.ts. */
  wind_hold_probability: number | null;
  /** Which model_versions row's config computed this score — null for rows predating model versioning (falls back to hardcoded defaults either way). */
  model_version_id: string | null;
  /** True = the production score for this resort/date (drives the public site + alert trigger). False = a shadow version's score, comparison-only — see lib/model-versions/shadow.ts. Always true for rows predating shadow scoring. */
  is_primary: boolean;
  created_at: string;
}

/** 'ghcnd' = NOAA GHCND (e.g. the Mount Mansfield stake, lib/ingestion/mansfield-stake.ts) — a resort-specific manual pairing, not a nearest-match network search like 'snotel'. */
export type GroundTruthSource = "snotel" | "ghcnd";

export interface SnotelActual {
  id: string;
  resort_id: string;
  station_triplet: string | null;
  date: string;
  observed_swe_mm: number | null;
  /** Raw snow depth (inches) from whichever network `source` names. observed_depth_change_in is the day-over-day delta of this, computed in lib/ingestion/snotel.ts's computeDepthChangeSeries (shared by both SNOTEL and GHCND ingestion — same transformation, different upstream source). */
  snow_depth_in: number | null;
  observed_depth_change_in: number | null;
  /** Which ground-truth network this row came from. Defaults to 'snotel' for every row predating this field (migration 0011). */
  source: GroundTruthSource;
  pulled_at: string;
  created_at: string;
}

export interface AlertFired {
  id: string;
  resort_id: string;
  snow_score_id: string | null;
  fired_at: string;
  target_date_start: string;
  target_date_end: string;
  powder_score_at_trigger: number;
  confidence_label: ConfidenceLabel;
  trip_opportunity_payload: TripOpportunityPayload;
  delivery_status: DeliveryStatus;
  recipients_count: number;
  created_at: string;
}

export interface FareCacheRow {
  id: string;
  resort_id: string;
  origin_airport_code: string;
  price_usd: number | null;
  airline: string | null;
  depart_date: string | null;
  return_date: string | null;
  fetched_at: string;
  created_at: string;
}

export interface Subscriber {
  id: string;
  email: string;
  clerk_user_id: string | null;
  resort_prefs: string[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SocialPost {
  id: string;
  alert_id: string;
  graphic_url: string;
  caption_text: string;
  status: SocialPostStatus;
  ig_container_id: string | null;
  ig_media_id: string | null;
  posted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccuracyLogRow {
  id: string;
  resort_id: string;
  snow_score_id: string | null;
  target_date: string;
  predicted_snowfall_in: number;
  observed_equivalent_in: number | null;
  accuracy_error_in: number | null;
  lead_time_hours_at_prediction: number;
  source: AccuracyLogSource;
  /** Which model_versions row was active/under-test when this row was computed — lets the comparison view aggregate real historical results by version without re-running anything. */
  model_version_id: string | null;
  /** True = this row traces back to a production (primary) snow_scores row; false = a shadow version's row. getAccuracySummary filters to true so shadow-version experiments never skew the "how are we doing live" report. Always true for NWS/backtest-sourced rows, which don't involve shadow scoring. */
  is_primary: boolean;
  logged_at: string;
}

/** Public-baseline comparison forecast (currently NWS api.weather.gov gridded data). Never OpenSnow or another proprietary source — see ROADMAP.md. */
export interface BenchmarkForecast {
  id: string;
  resort_id: string;
  source: "nws";
  target_date: string;
  estimated_snowfall_in: number;
  lead_time_hours: number;
  raw_payload: unknown;
  pulled_at: string;
  created_at: string;
}

/** ROADMAP Phase B — a proposed (not yet applied) change to a resort's SLR calibration multiplier, pending admin review. */
export interface CalibrationRecommendation {
  id: string;
  resort_id: string;
  computed_at: string;
  sample_count: number;
  mean_signed_error_in: number;
  current_multiplier: number;
  recommended_multiplier: number;
  /** null = the resort's base multiplier; otherwise the El Nino / La Nina one (ROADMAP Phase B.6). */
  enso_phase: EnsoAdjustablePhase | null;
  status: "pending" | "approved" | "rejected" | "superseded";
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export type ModelVersionStatus = "draft" | "active" | "archived";

/**
 * A resort's partial override of a model_versions row's own global config —
 * ROADMAP Phase B.3, "I want the model to be as precise as possible so code
 * the individual resorts." Every field is optional and named/shaped exactly
 * like its counterpart on ModelVersion itself (snake_case, matching DB
 * column shapes — see lib/scoring/config.ts's resolveScoringConfigForResort
 * for the per-field fallback: a field a resort doesn't set here falls back
 * to that SAME version's own global field, never straight to the compiled-in
 * defaults). Deliberately NOT a full ScoringConfig — every field is
 * optional, since the whole point is "override only what this resort
 * actually needs to differ on."
 */
export interface ResortScoringOverride {
  model_weights_by_bucket?: Record<string, Record<string, number>>;
  model_disagreement_threshold?: number;
  ensemble_confidence_thresholds?: { HIGH_MIN: number; MEDIUM_MIN: number };
  ensemble_spread_normalization_ceiling_mm?: number;
  slr_strategy_name?: SlrStrategyName;
  powder_score_weights?: { SNOWFALL: number; CONFIDENCE: number; LEAD_TIME_FIT: number };
  confidence_weight_by_label?: { high: number; medium: number; low: number };
  actionable_window_hours?: { min: number; max: number };
  lead_time_fit_decay_per_hour?: number;
}

/**
 * A named, timestamped snapshot of the scoring engine's tunable
 * configuration — requested directly ("save previous model versions which
 * can be run and viewed," with comparison and rollback). JSONB fields are
 * typed loosely here (this is the raw DB row); lib/scoring/config.ts's
 * toScoringConfig() narrows a row into the strict ScoringConfig shape the
 * scoring engine actually consumes — see that file for why the split (avoids
 * a circular import between this file and lib/config/constants.ts, which
 * already imports ModelName from here).
 *
 * Deliberately NOT included: Kuchera's own internal physics constants
 * (threshold temperature, slopes) — those stay fixed, literature-grounded
 * code (see slr/kuchera.ts), not an admin-tunable business parameter.
 */
export interface ModelVersion {
  id: string;
  name: string;
  description: string | null;
  status: ModelVersionStatus;
  model_weights_by_bucket: Record<string, Record<string, number>>;
  model_disagreement_threshold: number;
  ensemble_confidence_thresholds: { HIGH_MIN: number; MEDIUM_MIN: number };
  ensemble_spread_normalization_ceiling_mm: number;
  slr_strategy_name: SlrStrategyName;
  powder_score_weights: { SNOWFALL: number; CONFIDENCE: number; LEAD_TIME_FIT: number };
  confidence_weight_by_label: { high: number; medium: number; low: number };
  actionable_window_hours: { min: number; max: number };
  lead_time_fit_decay_per_hour: number;
  /** resort_id -> slr_calibration_multiplier, snapshotted at save time. Not the live read path — see this interface's own doc comment. */
  resort_slr_multipliers: Record<string, number>;
  /** resort_id -> partial scoring-config override, snapshotted at save time. Every resort defaults to absent (fully inherits this version's global config) — see ResortScoringOverride and lib/scoring/config.ts's resolveScoringConfigForResort. */
  resort_scoring_overrides: Record<string, ResortScoringOverride>;
  /** resort_id -> per-ENSO-phase SLR multiplier, used instead of the base one in that phase's winters (lib/scoring/enso-multiplier.ts). Absent phase = base multiplier. */
  resort_enso_slr_multipliers: Record<string, Partial<Record<EnsoAdjustablePhase, number>>>;
  parent_version_id: string | null;
  created_by: string;
  /** Who activated the CURRENT activation — distinct from created_by. See the migration's own comment on why this isn't a full activation history. */
  activated_by: string | null;
  activated_at: string | null;
  /** True while this version is being scored in parallel alongside whichever version is active — see lib/model-versions/shadow.ts. Mutually exclusive with status='active' (DB-enforced): the active version is already scored as the primary row every run. */
  is_shadow: boolean;
  created_at: string;
}

/** section 6 output contract — the only interface surface for future phases. */
export interface TripOpportunityPayload {
  resort_id: string;
  resort_name: string;
  target_date_start: string;
  target_date_end: string;
  powder_score: number;
  confidence_label: ConfidenceLabel;
  estimated_snowfall_in: number;
  resort_lat: number;
  resort_lng: number;
  lead_time_hours: number;
  generated_at: string;
  indicative_fares: IndicativeFare[] | null;
}

export interface IndicativeFare {
  origin_airport_code: string;
  price_usd: number;
  as_of: string;
}
