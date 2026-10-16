/**
 * Climate/storm-track region classification for the full resort roster —
 * ROADMAP Phase B.5, requested directly: "we should be able to
 * individually select the best weather model for each mtn out of our
 * model pool... to mix and match at the resort level. As well as
 * regionally for the incoming weather as performance develops", then
 * "develop the best regional model u can."
 *
 * This is a geographic/climatological classification ONLY — which storm
 * mechanism and terrain profile dominates each resort's weather. It does
 * NOT by itself imply any particular model-weighting choice; see
 * regional-model-weights.ts for the actual (separately reasoned, honestly
 * confidence-flagged) weighting hypothesis per region.
 *
 * Five regions, chosen to reflect genuinely different storm mechanisms,
 * not an arbitrary grid:
 * - pacific-maritime: the FIRST mountain range Pacific moisture hits
 *   (Sierra Nevada, WA Cascades) — large, well-organized, moisture-rich
 *   systems; the forecasting challenge is orographic QPF (how much falls
 *   exactly where), not storm detection.
 * - interior-west / continental-rockies: storms have already crossed 1+
 *   ranges and lost significant moisture before arriving — more
 *   synoptic-timing-dependent (did the trough dig far enough, did enough
 *   moisture survive) than terrain-QPF-dependent. Kept as two separate
 *   region LABELS (UT/ID/NM high-desert vs. CO/WY/MT central Rockies) for
 *   future refinement, but see regional-model-weights.ts for why they
 *   share one weighting profile today — the research behind this phase
 *   didn't surface evidence to differentiate them from each other yet.
 * - northeast-coastal: nor'easter / East Coast cyclogenesis-dominated —
 *   a fundamentally different storm mechanism (synoptic-scale coastal
 *   lows, not Pacific-sourced orographic systems).
 * - midwest-great-lakes: lake-effect-influenced in places, low elevation,
 *   flat terrain — genuinely distinct from all of the above, kept
 *   separate rather than force-fit into "continental" just because
 *   neither coast fits.
 *
 * A few classifications are real judgment calls, flagged inline rather
 * than presented as equally confident as the clear cases.
 */

export type ClimateRegion =
  | "pacific-maritime"
  | "interior-west"
  | "continental-rockies"
  | "northeast-coastal"
  | "midwest-great-lakes";

export const RESORT_REGIONS: Record<string, ClimateRegion> = {
  // ---- Pacific Maritime (Sierra Nevada, WA Cascades) ----
  heavenly: "pacific-maritime",
  northstar: "pacific-maritime",
  kirkwood: "pacific-maritime",
  "stevens-pass": "pacific-maritime",
  "palisades-tahoe": "pacific-maritime",
  "mammoth-mountain": "pacific-maritime",
  "june-mountain": "pacific-maritime",
  "crystal-mountain-wa": "pacific-maritime",
  // Judgment call: Southern California (San Gabriel/San Bernardino
  // ranges) — much lower elevation and a marginal snow climate compared
  // to the Sierra/Cascades, but still the same Pacific-storm-track
  // mechanism, not a continental one. Included here as the closest fit,
  // not a confident match.
  "mountain-high": "pacific-maritime",
  "snow-valley": "pacific-maritime",
  // Judgment call: Idaho panhandle — gets real, fairly direct Pacific
  // moisture via the Columbia Basin corridor, unlike UT/CO/NM which sit
  // behind multiple ranges. Classified Pacific Maritime on that basis,
  // though it's geographically separate from the Sierra/Cascades cluster.
  schweitzer: "pacific-maritime",

  // ---- Interior West (UT/ID/NM high desert — moisture-depleted) ----
  "park-city": "interior-west",
  "deer-valley": "interior-west",
  solitude: "interior-west",
  alta: "interior-west",
  snowbird: "interior-west",
  brighton: "interior-west",
  "sun-valley": "interior-west",
  "taos-ski-valley": "interior-west",

  // ---- Continental Rockies (CO/WY/MT central and northern Rockies) ----
  vail: "continental-rockies",
  "beaver-creek": "continental-rockies",
  breckenridge: "continental-rockies",
  keystone: "continental-rockies",
  "crested-butte": "continental-rockies",
  steamboat: "continental-rockies",
  "winter-park": "continental-rockies",
  "copper-mountain": "continental-rockies",
  eldora: "continental-rockies",
  "arapahoe-basin": "continental-rockies",
  "aspen-mountain": "continental-rockies",
  "aspen-highlands": "continental-rockies",
  buttermilk: "continental-rockies",
  snowmass: "continental-rockies",
  "jackson-hole": "continental-rockies",
  "big-sky": "continental-rockies",

  // ---- Northeast / Coastal-East (nor'easter-dominated) ----
  okemo: "northeast-coastal",
  "mount-snow": "northeast-coastal",
  stowe: "northeast-coastal",
  "hunter-mountain": "northeast-coastal",
  windham: "northeast-coastal",
  wildcat: "northeast-coastal",
  attitash: "northeast-coastal",
  "crotched-mountain": "northeast-coastal",
  "liberty-mountain": "northeast-coastal",
  "roundtop-mountain": "northeast-coastal",
  whitetail: "northeast-coastal",
  "jack-frost": "northeast-coastal",
  "big-boulder": "northeast-coastal",
  "seven-springs": "northeast-coastal",
  "hidden-valley-pa": "northeast-coastal",
  "laurel-mountain": "northeast-coastal",
  sugarbush: "northeast-coastal",
  stratton: "northeast-coastal",
  killington: "northeast-coastal",
  "pico-mountain": "northeast-coastal",
  "loon-mountain": "northeast-coastal",
  // Judgment call: West Virginia, Appalachian — a different mountain
  // range than New England's, but the same broad Atlantic/Appalachian
  // storm-track mechanism, not a western one.
  snowshoe: "northeast-coastal",

  // ---- Midwest / Great Lakes ----
  "afton-alps": "midwest-great-lakes",
  "mt-brighton": "midwest-great-lakes",
  "wilmot-mountain": "midwest-great-lakes",
  "paoli-peaks": "midwest-great-lakes",
  "hidden-valley-mo": "midwest-great-lakes",
  "snow-creek": "midwest-great-lakes",
  "boyne-mountain": "midwest-great-lakes",
  "boyne-highlands": "midwest-great-lakes",
};
