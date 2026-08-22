/**
 * Fixed-ratio (12:1) SLR strategy (BUILD_PRIMER section 5.3). Per Veals et
 * al. 2025, a plain fixed 12.0 ratio performed competitively (MAE=4.01)
 * against several dynamic methods on Western US mountain data. Used as a
 * backtest sanity-check baseline to validate the Kuchera implementation
 * against — NOT the production default (see DEFAULT_SLR_STRATEGY in
 * lib/config/constants.ts).
 */

import { FIXED_SLR_RATIO } from "@/lib/config/constants";
import { FREEZING_POINT_C, type SlrInput, type SlrResult, type SlrStrategy } from "./types";

export const fixedRatioStrategy: SlrStrategy = {
  name: "fixed-ratio",
  computeRatio(input: SlrInput): SlrResult {
    if (input.tmaxC >= FREEZING_POINT_C) {
      return { strategy: "fixed-ratio", ratio: 0, isRainCase: true };
    }
    return { strategy: "fixed-ratio", ratio: FIXED_SLR_RATIO * input.calibrationMultiplier, isRainCase: false };
  },
};
