/**
 * Cobb-Waldstreicher method (Cobb & Waldstreicher 2005/2011, NOAA/MDL) —
 * documented as a future alternate strategy per BUILD_PRIMER section 5.3.
 * NOT implemented in PART_1: it's physically-based, keyed to layer
 * temperature plus vertical-motion/moisture criteria via a published
 * layer-temperature-to-snow-ratio lookup table, which requires vertical
 * motion/RH data this pipeline does not currently ingest (Open-Meteo
 * variables pulled today are temperature/precip/wind/freezing-level/cloud
 * cover only — see lib/ingestion/open-meteo.ts HOURLY_VARIABLES).
 *
 * Stub only, matching the pattern used for the deferred seasonal-pattern
 * module (section 1). Wiring this in later means: (1) add vertical-motion +
 * RH variables to the Open-Meteo ingestion, (2) transcribe NOAA/MDL's
 * public-domain layer-ratio table, (3) implement computeRatio() below, (4)
 * register it in lib/scoring/slr/index.ts. No production code path may call
 * this until then.
 */

import type { SlrInput, SlrResult, SlrStrategy } from "./types";

export const cobbWaldstreicherStrategy: SlrStrategy = {
  name: "cobb-waldstreicher",
  computeRatio(_input: SlrInput): SlrResult {
    throw new Error(
      "cobb-waldstreicher SLR strategy is a documented stub (BUILD_PRIMER section 5.3) and is not implemented in PART_1."
    );
  },
};
