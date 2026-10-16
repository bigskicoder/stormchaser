/**
 * Regional model-weighting hypothesis — ROADMAP Phase B.5. Like
 * kuchera-wind (lib/scoring/slr/kuchera-wind.ts), this is an engineering
 * hypothesis grounded in real research done this session, NOT a
 * reproduction of any specific published verification study, and NOT
 * derived from this project's own accuracy_log data (which doesn't have
 * enough history yet to support it). To be judged on real shadow-scored
 * results as they accumulate, same as every other hypothesis this project
 * ships labeled as one.
 *
 * Each region's weights are a MODEST, DIRECTIONAL nudge away from the
 * compiled-in global baseline (MODEL_WEIGHTS_BY_BUCKET, constants.ts) —
 * never a dramatic swing — built FROM that baseline by overriding only
 * the specific (bucket, model) cells the research below actually
 * supports changing. IMPORTANT MECHANICAL NOTE: resolveScoringConfigForResort
 * replaces modelWeightsByBucket as a WHOLE OBJECT when an override sets
 * it at all (see lib/scoring/config.ts) — there is no per-bucket merge —
 * so every region's entry below must specify all three buckets explicitly,
 * even where the hypothesis is "no change from baseline," rather than
 * omitting a bucket and accidentally leaving it undefined.
 *
 * RESEARCH SUMMARY (WebSearch, this session — see each region's own
 * comment for what it actually supports):
 * - Terrain-resolving, convection-allowing models (HRRR) have real,
 *   peer-reviewed support for added skill in complex mountain terrain at
 *   short lead times: Gowan, Steenburgh & Schwartz (2018, Weather and
 *   Forecasting) found HRRR and other high-resolution systems more
 *   deterministically skillful than coarser models in narrow interior
 *   ranges, verified against SNOTEL, attributed to better-resolved
 *   topography/orographic precipitation. This finding is NOT specific to
 *   one side of the mountain west — it does not, on its own, support
 *   differentiating Pacific Maritime from Interior West/Continental
 *   Rockies at short range, only mountain-west-broadly from flatter
 *   terrain. (One older, dated source hinted West Coast skill might
 *   exceed Intermountain generally, but the search itself flagged this as
 *   uncertain in what it actually measures — not acted on here.)
 * - ECMWF has a real, multi-source-supported medium-range edge over GFS
 *   (avoiding GFS's periodic skill "dropouts," a documented recent GFS
 *   skill decline relative to ECMWF) — but this is a GENERAL finding, not
 *   regional, and the compiled-in baseline already reflects it (ECMWF is
 *   already the plurality weight at T48_120/T120_PLUS for every resort).
 * - ECMWF ALSO has a specific, well-known reputation for East Coast
 *   storm-track forecasting (Hurricane Sandy's 7-day-early landfall call
 *   is the canonical example, with some NOAA verification support, though
 *   dated) — but this reputation is NOT infallible: the January 2015
 *   "Snowpocalypse" is a documented case where GFS's revised run actually
 *   verified better than the ECMWF guidance forecasters leaned on. Treated
 *   here as a real but imperfect basis for a MODEST additional nudge
 *   toward ECMWF specifically for the Northeast, on top of the baseline's
 *   already-general lean — not a claim that ECMWF reliably wins there.
 * - No usable regional evidence was found for ICON or GEM in this
 *   session's research (a GEM/Pacific-Northwest search turned up only an
 *   informal forum claim, not real verification data) — both are left at
 *   their baseline weights everywhere rather than adjusted on a guess.
 * - Lake-effect snow (the Midwest/Great Lakes region's defining
 *   phenomenon) is a meso-scale process driven by lake-surface
 *   temperature, ice cover, and fetch/wind-direction — none of which any
 *   of these five synoptic-scale models resolve well, HRRR included at
 *   3km. No regional hypothesis is offered for this region; see this
 *   file's own MIDWEST section for why it's deliberately absent rather
 *   than forced.
 */

import { MODEL_WEIGHTS_BY_BUCKET } from "./constants";
import type { LeadTimeBucket } from "./constants";
import type { ModelName } from "@/lib/db/types";
import type { ClimateRegion } from "./resort-regions";

type WeightsByBucket = Record<LeadTimeBucket, Partial<Record<ModelName, number>>>;

/**
 * Pacific Maritime and both interior/continental regions share this
 * profile: a modest HRRR nudge at T0_48 only (complex-terrain orographic
 * QPF is the hard part everywhere in the mountain west per the research
 * above), taken from GFS specifically — the short-range model with the
 * least regional evidence either way in this session's research, rather
 * than from ECMWF or ICON. T48_120/T120_PLUS unchanged from baseline:
 * no regional evidence was found to justify differentiating medium-range
 * weighting within the mountain west.
 */
const MOUNTAIN_WEST_WEIGHTS: WeightsByBucket = {
  T0_48: { hrrr: 0.55, gfs: 0.15, icon: 0.15, ecmwf: 0.15 },
  T48_120: MODEL_WEIGHTS_BY_BUCKET.T48_120,
  T120_PLUS: MODEL_WEIGHTS_BY_BUCKET.T120_PLUS,
};

/**
 * Northeast/Coastal-East: the inverse short-range nudge from the mountain
 * west (HRRR held closer to baseline rather than boosted — a developing
 * coastal low's broad structure matters more here than resolving one
 * sharp terrain feature), plus a modest additional ECMWF nudge at BOTH
 * medium and long range, layered on top of the baseline's already-general
 * ECMWF lean, reflecting (imperfectly) ECMWF's East Coast storm-track
 * reputation specifically — see this file's header for the honest
 * caveat on that reputation (real, but not infallible).
 */
const NORTHEAST_COASTAL_WEIGHTS: WeightsByBucket = {
  T0_48: { hrrr: 0.45, gfs: 0.2, icon: 0.15, ecmwf: 0.2 },
  T48_120: { gfs: 0.25, ecmwf: 0.4, icon: 0.2, gem: 0.15 },
  T120_PLUS: { ecmwf: 0.5, gfs: 0.25, gem: 0.25 },
};

/**
 * No regional weighting hypothesis for midwest-great-lakes — deliberately
 * absent from this map rather than present with a forced/guessed value.
 * A resort whose region has no entry here simply inherits the active
 * version's global baseline unchanged (see buildRegionalResortScoringOverrides
 * in lib/model-versions/regional-overrides.ts) — the same "no override =
 * no behavior change" guarantee every other resort_scoring_overrides
 * consumer already relies on.
 */
export const REGIONAL_MODEL_WEIGHTS: Partial<Record<ClimateRegion, WeightsByBucket>> = {
  "pacific-maritime": MOUNTAIN_WEST_WEIGHTS,
  "interior-west": MOUNTAIN_WEST_WEIGHTS,
  "continental-rockies": MOUNTAIN_WEST_WEIGHTS,
  "northeast-coastal": NORTHEAST_COASTAL_WEIGHTS,
};
