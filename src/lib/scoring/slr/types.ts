import type { SlrStrategyName } from "@/lib/db/types";

export interface SlrInput {
  /** Kuchera-relevant column Tmax, in Celsius (see lib/ingestion/open-meteo.ts columnTmaxC). */
  tmaxC: number;
  /** Per-resort calibration multiplier (resorts.slr_calibration_multiplier), default 1.0. */
  calibrationMultiplier: number;
}

export interface SlrResult {
  strategy: SlrStrategyName;
  /** Snow-to-liquid ratio, e.g. 12 means 12in snow per 1in liquid. */
  ratio: number;
  /** True when the phase is rain, not snow — ratio is 0 and must not be silently dropped (section 5.3). */
  isRainCase: boolean;
}

/**
 * Swappable SLR strategy interface (BUILD_PRIMER section 10.2 / 5.3):
 * calling code (lib/scoring/index.ts) depends only on this interface, never
 * on a specific method's internals, so alternates can be swapped in without
 * touching the orchestrator.
 */
export interface SlrStrategy {
  name: SlrStrategyName;
  computeRatio(input: SlrInput): SlrResult;
}

/** Phase boundary: 0°C / 273.15 K. Governs rain-vs-snow, independent of any strategy's own internal ratio-shape threshold. */
export const FREEZING_POINT_C = 0;
