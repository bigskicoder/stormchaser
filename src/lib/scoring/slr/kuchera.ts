/**
 * Kuchera method SLR strategy (BUILD_PRIMER section 5.3) — the default
 * production strategy. Operational method attributed to E. Kuchera, widely
 * adopted by NWS forecast offices despite lacking a single formal
 * peer-reviewed publication; documented in NWS technical references and
 * evaluated against other methods in Veals et al. 2025.
 *
 * COEFFICIENT PROVENANCE / VERIFICATION: the primer required verifying
 * these coefficients against a primary source before hardcoding. This
 * sandbox's outbound network is allowlist-restricted and WebFetch is
 * blocked for every candidate source domain tried (inscc.utah.edu,
 * pivotalweather.com, weather.gov, repository.library.noaa.gov all
 * returned EGRESS_BLOCKED), so the actual PDF text was never read
 * directly. Two independent WebSearch queries, run separately, both
 * returned Veals et al. 2025 as the primary source and both converged on
 * the identical formula below — stronger evidence than the single-source
 * memory recall this module originally shipped with (which had the slope
 * magnitudes swapped between branches — see git history on this file),
 * but still short of reading the primary source directly. If that
 * matters for your use case, the paper is "Predicting Snow-to-Liquid
 * Ratio in the Mountains of the Western United States" (Veals et al.
 * 2025) — worth a direct read before fully trusting this for real alerts.
 *
 *   Tqm >  271.16 K:  SLR = 12 + 2 * (271.16 - Tqm)   [slope magnitude 2]
 *   Tqm <= 271.16 K:  SLR = 12 + 1 * (271.16 - Tqm)   [slope magnitude 1]
 *
 * where Tqm is the max temperature in the atmospheric column below 500 hPa,
 * in Kelvin. Note the shape: the WARMER branch (closer to/above freezing)
 * has the STEEPER slope (ratio collapses fast as it nears melting), while
 * the COLDER branch has the shallower slope (still unbounded — very cold
 * Tqm still produces very high ratios, just less steeply per degree). This
 * module treats the phase boundary (rain vs. snow) separately at the
 * physical freezing point (0°C / 273.15 K, see lib/scoring/slr/types.ts
 * FREEZING_POINT_C) rather than at Kuchera's own -2°C ratio-shape split —
 * that split governs which branch of the SLR curve applies to
 * already-confirmed snow, not whether precipitation is falling as snow at
 * all.
 */

import { KUCHERA_THRESHOLD_KELVIN } from "@/lib/config/constants";
import { FREEZING_POINT_C, type SlrInput, type SlrResult, type SlrStrategy } from "./types";

const ABOVE_THRESHOLD_SLOPE = -2.0;
const BELOW_THRESHOLD_SLOPE = -1.0;
const ANCHOR_RATIO = 12;

function celsiusToKelvin(c: number): number {
  return c + 273.15;
}

function rawKucheraRatio(tmaxC: number): number {
  const tqmKelvin = celsiusToKelvin(tmaxC);
  const slope = tqmKelvin > KUCHERA_THRESHOLD_KELVIN ? ABOVE_THRESHOLD_SLOPE : BELOW_THRESHOLD_SLOPE;
  return ANCHOR_RATIO + slope * (tqmKelvin - KUCHERA_THRESHOLD_KELVIN);
}

export const kucheraStrategy: SlrStrategy = {
  name: "kuchera",
  computeRatio(input: SlrInput): SlrResult {
    if (input.tmaxC >= FREEZING_POINT_C) {
      return { strategy: "kuchera", ratio: 0, isRainCase: true };
    }
    const ratio = Math.max(0, rawKucheraRatio(input.tmaxC)) * input.calibrationMultiplier;
    return { strategy: "kuchera", ratio, isRainCase: false };
  },
};
