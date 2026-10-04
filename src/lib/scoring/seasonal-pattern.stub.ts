/**
 * Long-range seasonal pattern modeling (ENSO / La Niña-El Niño
 * teleconnections) — documented placeholder per BUILD_PRIMER section 1:
 * "long-range seasonal pattern modeling (La Niña/El Niño teleconnections)
 * — [DEFAULT_OK: stub a placeholder module, do not implement logic]".
 *
 * GAP FOUND DURING A FULL PRIMER AUDIT: this stub didn't exist until now,
 * even though lib/scoring/slr/cobb-waldstreicher.stub.ts's own header
 * comment already referenced "the pattern used for the deferred
 * seasonal-pattern module" as if it did. Added to close that gap.
 *
 * Deferred indefinitely — same status as Tier 3 wind-loading/aspect
 * microclimate modeling (BUILD_PRIMER section 1). This is explicitly NOT
 * part of PART_1 scope. No production code path calls this; it exists
 * only so the primer's stub requirement is satisfied and the intended
 * integration point is documented for whoever picks this up later.
 *
 * Intended eventual use (not built, not decided — both of these are
 * speculative integration points, not a committed design):
 * - A seasonal ENSO state (El Niño / La Niña / neutral), sourced from
 *   NOAA's ONI (Oceanic Niño Index) or CPC ENSO advisories, could adjust
 *   a resort's seasonal snowfall expectation via a regional multiplier —
 *   applied ALONGSIDE, not instead of, the existing per-resort
 *   slr_calibration_multiplier (ROADMAP.md Phase B), since ENSO state is
 *   a regional/seasonal signal while that multiplier is a per-resort
 *   accuracy correction — conflating the two would make Phase B's
 *   calibration loop attribute ENSO-driven bias to the wrong cause.
 * - Alternatively (or additionally), it could adjust the seasonal-max
 *   normalization ceiling in lib/scoring/powder-score.ts
 *   (SEASONAL_MAX_BOOTSTRAP_DEFAULT_IN / SEASONAL_MAX_ROLLING_WINDOW_DAYS)
 *   for a resort's region before real rolling history exists for that
 *   particular ENSO phase.
 */

export type EnsoState = "el_nino" | "la_nina" | "neutral";

export interface SeasonalPatternAdjustment {
  ensoState: EnsoState;
  /** Regional multiplier on seasonal snowfall expectation; 1.0 = neutral/no adjustment. */
  regionalMultiplier: number;
}

export function getSeasonalPatternAdjustment(_resortId: string): SeasonalPatternAdjustment {
  throw new Error(
    "Seasonal pattern modeling (ENSO / La Niña-El Niño teleconnections) is a documented stub " +
      "(BUILD_PRIMER section 1) and is not implemented in PART_1."
  );
}
