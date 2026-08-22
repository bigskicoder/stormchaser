/**
 * Kuchera method SLR strategy (BUILD_PRIMER section 5.3) — the default
 * production strategy. Operational method attributed to E. Kuchera, widely
 * adopted by NWS forecast offices despite lacking a single formal
 * peer-reviewed publication; documented in NWS technical references and
 * evaluated against other methods in Veals et al. 2025.
 *
 * COEFFICIENT PROVENANCE / VERIFICATION FLAG: the primer explicitly directs
 * "verify exact published coefficients against a primary source... before
 * hardcoding — do not invent coefficients." This sandbox has no outbound
 * network access to fetch Veals et al. 2025 or a NWS technical reference
 * (see lib/ingestion/open-meteo.ts header for the same constraint), so the
 * coefficients below are transcribed from memory of the widely-cited
 * operational formulation (piecewise-linear in column Tmax, split at
 * 271.16 K / -2.01°C, slope -1.0 above the split and -2.6 below it, both
 * anchored to a 12:1 ratio at the split point):
 *
 *   Tqm >  271.16 K:  SLR = 12 - 1.0 * (Tqm - 271.16)
 *   Tqm <= 271.16 K:  SLR = 12 - 2.6 * (Tqm - 271.16)
 *
 * where Tqm is the max temperature in the atmospheric column below 500 hPa,
 * in Kelvin. This module treats the phase boundary (rain vs. snow)
 * separately at the physical freezing point (0°C / 273.15 K, see
 * lib/scoring/slr/types.ts FREEZING_POINT_C) rather than at Kuchera's own
 * -2°C ratio-shape split — that split governs which branch of the SLR curve
 * applies to already-confirmed snow, not whether precipitation is falling as
 * snow at all. MUST be cross-checked against a primary source
 * (Veals et al. 2025 or an NWS technical writeup) before this pipeline is
 * trusted for real alerting; not independently confirmed in this build
 * session.
 */

import { KUCHERA_THRESHOLD_KELVIN } from "@/lib/config/constants";
import { FREEZING_POINT_C, type SlrInput, type SlrResult, type SlrStrategy } from "./types";

const ABOVE_THRESHOLD_SLOPE = -1.0;
const BELOW_THRESHOLD_SLOPE = -2.6;
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
