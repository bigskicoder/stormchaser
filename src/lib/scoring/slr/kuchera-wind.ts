/**
 * Kuchera + a wind-speed adjustment — EXPERIMENTAL, built to generate real
 * season-1 parallel-scoring comparison data (ROADMAP Phase B.2, shadow
 * scoring: "produce multiple models, run them parallel this season, compare"
 * — requested directly), not to assert this is already a better model.
 *
 * WHAT THIS IS NOT: a reproduction of Veals, Pletcher, Schwartz, Chase,
 * Harnos, Correia, Wessler & Steenburgh 2025 — the same paper this
 * codebase's Kuchera coefficients cite. That paper found a regression on
 * temperature AND wind speed predicts SLR with "considerably more skill"
 * than temperature-only methods, and a follow-on random-forest study found
 * even larger gains. But neither paper's actual fitted coefficients were
 * retrievable in a form this project could verify (WebFetch was blocked for
 * every primary-source domain tried — see README's "Flagged assumptions"),
 * so hardcoding invented numbers and presenting them as "the Veals model"
 * would be fabricating a citation, not implementing one.
 *
 * WHAT THIS IS INSTEAD: the one part of that finding that doesn't require
 * the unavailable coefficients — the DIRECTION of the relationship. Higher
 * wind correlates with denser, lower-SLR snow (wind-packing and riming
 * produce denser crystals — the same physical basis for "wind slab" in
 * avalanche forecasting), a qualitative relationship well-established
 * independent of this specific paper. This strategy applies that direction
 * as a conservative, modest, named-constant adjustment
 * (WIND_SLR_ADJUSTMENT_PER_KMH / _FLOOR, lib/config/constants.ts) on top of
 * the existing Kuchera curve. The point of shadow-scoring this for a season
 * is to let real accuracy_log data say whether the hypothesis actually
 * helps here — not to assume it does before the data exists.
 */

import { KUCHERA_THRESHOLD_KELVIN, WIND_SLR_ADJUSTMENT_FLOOR, WIND_SLR_ADJUSTMENT_PER_KMH } from "@/lib/config/constants";
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

/** No wind data this run (null/undefined) -> no adjustment (factor 1), not a guessed value — same "missing data means no claim" convention as the rest of this codebase (e.g. windLabel in conditions-strip.tsx). */
function windAdjustmentFactor(avgWindSpeedKmh: number | null | undefined): number {
  if (avgWindSpeedKmh == null) return 1;
  const raw = 1 - WIND_SLR_ADJUSTMENT_PER_KMH * avgWindSpeedKmh;
  return Math.max(WIND_SLR_ADJUSTMENT_FLOOR, raw);
}

export const kucheraWindStrategy: SlrStrategy = {
  name: "kuchera-wind",
  computeRatio(input: SlrInput): SlrResult {
    if (input.tmaxC >= FREEZING_POINT_C) {
      return { strategy: "kuchera-wind", ratio: 0, isRainCase: true };
    }
    const base = Math.max(0, rawKucheraRatio(input.tmaxC));
    const ratio = base * windAdjustmentFactor(input.avgWindSpeedKmh) * input.calibrationMultiplier;
    return { strategy: "kuchera-wind", ratio, isRainCase: false };
  },
};
