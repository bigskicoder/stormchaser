/**
 * Natural snowpack model: one daily step per resort, natural snow only (no
 * snowmaking or grooming). Nick approved the plan on 2026-10-20 ("Go on
 * natural base depth modeling"); the plan is the "Natural snow base model:
 * plan" doc (https://claude.ai/code/artifact/8f743290-1a08-4661-b481-3b779584ad27).
 *
 * Structure follows SNOW-17 (Anderson 1973/2006, NWS), adapted from its
 * 6-hour step to a daily one, plus bulk sublimation and Anderson (1976)
 * compaction for depth. Each day:
 *   1. Split precipitation into snow and rain (linear between -1 and 3 °C).
 *   2. New snow adds SWE (times the fitted snowfall correction SCF) and
 *      depth at the Hedstrom & Pomeroy (1998) new-snow density.
 *   3. Melt: temperature index on dry days, SNOW-17's rain-on-snow energy
 *      balance on rain days. A cold pack first has to pay off its cold
 *      content (heat deficit) before anything melts.
 *   4. Sublimation: bulk transfer, E = rho_air * C_E * U * (q_sat(Ts) - q_air).
 *   5. Liquid water: the pack holds 5% of its ice as liquid; the rest runs
 *      off. Held water refreezes on cold days.
 *   6. Settling: Anderson compaction under the pack's own weight, plus
 *      destructive metamorphism of fresh, light snow.
 *
 * Daily-step adaptations, all judgment calls:
 * - Melt uses positive degree-days from a sine curve through the day's
 *   min and max (a day at -1 °C mean with a +6 °C afternoon still melts),
 *   instead of SNOW-17's 6-hourly air temperature.
 * - SNOW-17's 6-hour constants are scaled to a day: negative melt factor
 *   0.15 mm/°C/6h -> 0.6/day (seasonal, like the melt factor), antecedent
 *   temperature index weight 0.15/6h -> 1-(0.85^4) per day, rain-on-snow
 *   wind function 0.04 mm/mb/6h -> x4.
 * - One bulk layer, so depth = SWE / bulk density.
 *
 * Pure: no network or database access.
 */

export interface SnowpackParams {
  /** Snowfall correction factor: gauge undercatch, wind drift, grid-vs-site precipitation. */
  scf: number;
  /** Melt factor on Dec 21, mm per °C per day. */
  mfMin: number;
  /** Melt factor on Jun 21, mm per °C per day. */
  mfMax: number;
  /** Bulk sublimation exchange coefficient (dimensionless). */
  cE: number;
  /** Anderson compaction coefficient, per cm per hour (Anderson 1976: 0.026). */
  c1: number;
  /** Anderson compaction density coefficient, cm³/g (Anderson 1976: 21). */
  c2: number;
}

/** SNOW-17 / Anderson starting values, also the "uncalibrated" defaults. */
export const DEFAULT_SNOWPACK_PARAMS: SnowpackParams = {
  scf: 1.1,
  mfMin: 1.2,
  mfMax: 4.4,
  cE: 0.0015,
  c1: 0.026,
  c2: 21,
};

/**
 * Fitting bounds. Started inside SNOW-17's published ranges (SCF 0.7-1.6;
 * MFMAX 0.5-2.0 and MFMIN 0.05-0.6 mm/°C/6h, x4 for a day) plus Anderson's
 * compaction constants. The first real fit (2026-10-20, 12 resorts) pinned
 * several resorts against those edges, so four were widened:
 * - SCF to 2.5: here it corrects ERA5's ~30 km grid, not just gauge
 *   undercatch. ERA5 smooths the mountains away and underestimates
 *   orographic snowfall; Alta wanted more than 1.6.
 * - Melt factor max to 10/day: spring melt from daily ERA5 temperatures
 *   needed more than SNOW-17's 8 at several Colorado and Montana sites.
 * - Sublimation coefficient down to 0.0001: most resorts sat on 0.0005,
 *   i.e. daily-mean ERA5 humidity and wind overstate the vapour deficit.
 * - Compaction c1 down to 0.002: most sat on 0.01 (settling too fast).
 */
export const SNOWPACK_PARAM_BOUNDS: Record<keyof SnowpackParams, [number, number]> = {
  scf: [0.7, 2.5],
  mfMin: [0.2, 2.4],
  mfMax: [2, 10],
  cE: [0.0001, 0.004],
  c1: [0.002, 0.05],
  c2: [15, 30],
};

export interface SnowpackDay {
  /** Resort-local calendar date, YYYY-MM-DD. */
  date: string;
  precipMm: number;
  tMeanC: number;
  tMinC: number;
  tMaxC: number;
  /** Relative humidity, %. */
  rhPct: number;
  /** 10 m wind, m/s. */
  windMs: number;
  /** Surface pressure, hPa. */
  pressureHpa: number;
}

export interface SnowpackState {
  /** Ice + liquid in the pack, mm water. */
  sweMm: number;
  /** Liquid water held in the pack, mm (part of sweMm). */
  liquidMm: number;
  /** Heat deficit, mm of water that would have to refreeze to warm the pack to 0 °C. */
  coldContentMm: number;
  /** Antecedent temperature index, °C (SNOW-17's proxy for snow-surface temperature). */
  atiC: number;
  depthCm: number;
}

export interface SnowpackDayResult {
  date: string;
  sweMm: number;
  depthCm: number;
  /** Bulk density, g/cm³; null with no snow on the ground. */
  density: number | null;
  newSnowSweMm: number;
  meltMm: number;
  sublimationMm: number;
  runoffMm: number;
}

export const EMPTY_SNOWPACK: SnowpackState = { sweMm: 0, liquidMm: 0, coldContentMm: 0, atiC: 0, depthCm: 0 };

const SNOW_ALL_BELOW_C = -1;
const RAIN_ALL_ABOVE_C = 3;
const LIQUID_HOLDING_FRACTION = 0.05;
const MAX_DENSITY = 0.55;
/** Below this the ground counts as bare; the pack is cleared so trace SWE can't linger all summer. */
const BARE_GROUND_SWE_MM = 0.5;
/** SNOW-17's rain-on-snow threshold, 0.25 mm per 6 h, as a daily total. */
const RAIN_ON_SNOW_MIN_MM = 1;
const STEFAN_BOLTZMANN_MM_PER_K4_DAY = 6.12e-10 * 24;
const UADJ_DAILY = 0.04 * 4;
const NMF_DAILY_MAX = 0.6;
const TIPM_DAILY = 1 - Math.pow(1 - 0.15, 4);

/** Day of year, 1-366, from a YYYY-MM-DD date. */
function dayOfYear(date: string): number {
  const d = new Date(`${date}T00:00:00Z`);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - start) / 86_400_000) + 1;
}

/** Seasonal melt factor: MF_min on Dec 21 (day 355), MF_max on Jun 21 (day 172), sinusoidal between (SNOW-17's form). */
export function seasonalMeltFactor(date: string, mfMin: number, mfMax: number): number {
  const n = dayOfYear(date);
  const season = Math.sin(((n - 81) * 2 * Math.PI) / 366);
  return (mfMax + mfMin) / 2 + ((mfMax - mfMin) / 2) * season;
}

/** Fraction of precipitation falling as snow at mean air temperature tC. */
export function snowFraction(tC: number): number {
  if (tC <= SNOW_ALL_BELOW_C) return 1;
  if (tC >= RAIN_ALL_ABOVE_C) return 0;
  return (RAIN_ALL_ABOVE_C - tC) / (RAIN_ALL_ABOVE_C - SNOW_ALL_BELOW_C);
}

/** Hedstrom & Pomeroy (1998) new-snow density, g/cm³ (their formula is kg/m³). */
export function newSnowDensity(tC: number): number {
  return (67.9 + 51.3 * Math.exp(Math.min(tC, 0) / 2.59)) / 1000;
}

/**
 * Positive degree-days above 0 °C for one day, assuming temperature follows
 * a sine curve between the day's min and max.
 */
export function positiveDegreeDays(tMinC: number, tMaxC: number): number {
  if (tMaxC <= 0) return 0;
  if (tMinC >= 0) return (tMinC + tMaxC) / 2;
  const mean = (tMinC + tMaxC) / 2;
  const amp = (tMaxC - tMinC) / 2;
  // Fraction of the cycle above zero, and the mean excess over that part.
  const theta = Math.acos(-mean / amp);
  return (mean * theta + amp * Math.sin(theta)) / Math.PI;
}

/** Saturation vapour pressure, hPa, over ice below 0 °C and water above (Magnus). */
export function saturationVapourPressureHpa(tC: number): number {
  return tC < 0 ? 6.112 * Math.exp((22.46 * tC) / (272.62 + tC)) : 6.112 * Math.exp((17.62 * tC) / (243.12 + tC));
}

function specificHumidity(vapourHpa: number, pressureHpa: number): number {
  return (0.622 * vapourHpa) / (pressureHpa - 0.378 * vapourHpa);
}

/** Bulk-transfer sublimation for one day, mm water. Never negative (frost deposition is ignored). */
export function dailySublimationMm(day: SnowpackDay, cE: number): number {
  const ts = Math.min(day.tMeanC, 0);
  const qSat = specificHumidity(saturationVapourPressureHpa(ts), day.pressureHpa);
  const qAir = specificHumidity((Math.max(0, Math.min(100, day.rhPct)) / 100) * saturationVapourPressureHpa(day.tMeanC), day.pressureHpa);
  const rhoAir = (day.pressureHpa * 100) / (287.05 * (day.tMeanC + 273.15));
  const kgPerM2PerS = rhoAir * cE * Math.max(0, day.windMs) * (qSat - qAir);
  return Math.max(0, kgPerM2PerS * 86_400);
}

/** SNOW-17 rain-on-snow melt for one day, mm (Anderson 2006, eq. for rain periods). */
export function rainOnSnowMeltMm(day: SnowpackDay, rainMm: number): number {
  const ta = Math.max(day.tMeanC, 0);
  const radiation = STEFAN_BOLTZMANN_MM_PER_K4_DAY * (Math.pow(ta + 273, 4) - Math.pow(273, 4));
  const rainHeat = 0.0125 * rainMm * ta;
  const condensation = 8.5 * UADJ_DAILY * (0.9 * saturationVapourPressureHpa(ta) - 6.11 + 0.00057 * day.pressureHpa * ta);
  return Math.max(0, radiation + rainHeat + condensation);
}

/** Standard-atmosphere surface pressure at an elevation, hPa: for days with no pressure reading. */
export function standardPressureHpa(elevationM: number): number {
  return 1013.25 * Math.pow(1 - 2.25577e-5 * elevationM, 5.25588);
}

/** Advances the pack one day. Returns the new state and the day's fluxes. */
export interface SnowpackRunOptions {
  /** SWE doesn't depend on settling, so a SWE-only fit can skip it. */
  skipDepth?: boolean;
}

export function stepSnowpack(
  state: SnowpackState,
  day: SnowpackDay,
  p: SnowpackParams,
  opts: SnowpackRunOptions = {}
): { state: SnowpackState; result: SnowpackDayResult } {
  let { sweMm, liquidMm, coldContentMm, atiC, depthCm } = state;
  const precip = Math.max(0, day.precipMm);
  const f = snowFraction(day.tMeanC);
  const newSnow = p.scf * f * precip;
  const rain = (1 - f) * precip;
  const mf = seasonalMeltFactor(day.date, p.mfMin, p.mfMax);

  // 1-2. Accumulation. New snow brings its own cold content (SNOW-17: -Tn * Pn / 160).
  if (newSnow > 0) {
    depthCm += newSnow / 10 / newSnowDensity(day.tMeanC);
    sweMm += newSnow;
    coldContentMm += (-Math.min(day.tMeanC, 0) * newSnow) / 160;
    atiC = newSnow > 1.5 ? Math.min(day.tMeanC, 0) : atiC;
  }

  let melt = 0;
  let sublimation = 0;
  let runoff = 0;

  if (sweMm > 0) {
    // 3. Energy in: melt (dry day) or rain-on-snow melt, plus the heat rain carries.
    const potentialMelt = rain >= RAIN_ON_SNOW_MIN_MM ? rainOnSnowMeltMm(day, rain) : mf * positiveDegreeDays(day.tMinC, day.tMaxC);

    // Cold content: grows on cold days (negative melt factor), is paid off first by melt energy.
    atiC = atiC + TIPM_DAILY * (Math.min(day.tMeanC, 0) - atiC);
    if (potentialMelt <= 0) {
      const nmf = NMF_DAILY_MAX * (mf / p.mfMax);
      coldContentMm = Math.max(0, coldContentMm + nmf * (atiC - day.tMeanC));
    }
    const energy = potentialMelt;
    const toCold = Math.min(coldContentMm, energy);
    coldContentMm -= toCold;
    melt = Math.min(sweMm - liquidMm, energy - toCold);
    // Rain refreezes into a cold pack before it can add liquid.
    const rainRefrozen = Math.min(coldContentMm, rain);
    coldContentMm -= rainRefrozen;

    // Melt turns ice into liquid at constant bulk density.
    liquidMm += melt;
    // Rain onto the pack: what refroze becomes ice, the rest liquid.
    sweMm += rain;
    liquidMm += rain - rainRefrozen;

    // 4. Sublimation from the ice.
    sublimation = Math.min(sweMm - liquidMm, dailySublimationMm(day, p.cE));
    const iceBefore = sweMm - liquidMm;
    sweMm -= sublimation;
    if (iceBefore > 0) depthCm *= Math.max(0, (iceBefore - sublimation) / iceBefore);

    // 5. Liquid holding and refreeze.
    if (day.tMeanC < 0 && liquidMm > 0) liquidMm = 0;
    const capacity = LIQUID_HOLDING_FRACTION * (sweMm - liquidMm);
    if (liquidMm > capacity) {
      runoff = liquidMm - capacity;
      const iceFraction = sweMm > 0 ? (sweMm - runoff) / sweMm : 0;
      sweMm -= runoff;
      liquidMm = capacity;
      // Losing melted ice shrinks the pack at constant density.
      depthCm *= Math.max(0, iceFraction);
    }

    // 6. Settling, in four 6-hour sub-steps: fresh snow compacts fast, and
    // one explicit daily step overshoots. Skipped when only SWE is wanted.
    if (!opts.skipDepth && sweMm > 0 && depthCm > 0) {
      let rho = sweMm / 10 / depthCm;
      const ts = Math.min(day.tMeanC, 0);
      const wetFactor = liquidMm > 0 ? 2 : 1;
      // Weight above the middle of the pack, cm of water.
      const w = sweMm / 10 / 2;
      for (let k = 0; k < 4; k++) {
        const compaction = p.c1 * w * Math.exp(0.08 * ts - p.c2 * rho);
        const metamorphism = 0.01 * Math.exp(0.04 * ts) * (rho > 0.15 ? Math.exp(-46 * (rho - 0.15)) : 1);
        rho = Math.min(MAX_DENSITY, rho * (1 + 6 * wetFactor * (compaction + metamorphism)));
      }
      depthCm = Math.min(depthCm, sweMm / 10 / rho);
    }
  }

  if (sweMm < BARE_GROUND_SWE_MM) {
    runoff += sweMm;
    sweMm = 0;
    liquidMm = 0;
    coldContentMm = 0;
    depthCm = 0;
  }

  const next: SnowpackState = { sweMm, liquidMm, coldContentMm, atiC, depthCm };
  return {
    state: next,
    result: {
      date: day.date,
      sweMm,
      depthCm,
      density: sweMm > 0 && depthCm > 0 ? sweMm / 10 / depthCm : null,
      newSnowSweMm: newSnow,
      meltMm: melt,
      sublimationMm: sublimation,
      runoffMm: runoff,
    },
  };
}

/** Runs consecutive days from a starting state (bare ground by default). */
export function runSnowpack(
  days: SnowpackDay[],
  p: SnowpackParams,
  start: SnowpackState = EMPTY_SNOWPACK,
  opts: SnowpackRunOptions = {}
): SnowpackDayResult[] {
  let state = start;
  const out: SnowpackDayResult[] = [];
  for (const day of days) {
    const step = stepSnowpack(state, day, p, opts);
    state = step.state;
    out.push(step.result);
  }
  return out;
}

/** The water year a date belongs to (Oct 1 starts the next year's). */
export function waterYearOf(date: string): number {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return m >= 10 ? y + 1 : y;
}
