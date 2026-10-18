/**
 * Hour-by-hour rain/snow split for one resort-day (Nick, 2026-10-18:
 * "why can't we split days into mix of snow and rain? change over is
 * important").
 *
 * Before this, a day got one temperature (precip-weighted across the day)
 * and was all snow or all rain. Now each hour of the primary model is
 * phased on its own column temperature: an hour at or above freezing is
 * rain, a colder hour is snow with that hour's own SLR. The day's split
 * (what share of the liquid fell as snow, and the SLR of that snow) is then
 * applied to the reconciled multi-model total, the same way the single
 * daily temperature was before. Each hour is still all one phase at the
 * strategy's freezing line; there is no melting-layer blend inside an hour.
 *
 * Changeover: the first precipitating hour from which the phase stays the
 * same through the end of the day's precipitation, when that phase differs
 * from the one the day started with. A day that wobbles back and forth and
 * ends where it began reports no changeover, just a mix.
 */

import type { ForecastPull } from "@/lib/db/types";
import type { SlrStrategy } from "./slr/types";

/** Hours with less liquid than this don't decide phase or changeover. */
export const PHASE_HOUR_MIN_PRECIP_MM = 0.1;

export type PhaseChange = "rain_to_snow" | "snow_to_rain";

export interface PhaseSplit {
  /** Share of the day's liquid that falls as snow, 0-1. */
  snowFraction: number;
  /** Liquid-weighted SLR over the snow hours (0 when there are none). */
  snowRatio: number;
  phaseChange: PhaseChange | null;
  /** valid_time (UTC ISO) of the first hour of the new phase. */
  phaseChangeAt: string | null;
}

export function hourlyPhaseSplit(params: {
  rows: ForecastPull[];
  strategy: SlrStrategy;
  calibrationMultiplier: number;
  avgWindSpeedKmh: number | null;
}): PhaseSplit | null {
  const { strategy, calibrationMultiplier, avgWindSpeedKmh } = params;
  const hours = params.rows
    .filter((r) => r.temp_c != null && (r.swe_mm ?? 0) > 0)
    .sort((a, b) => a.valid_time.localeCompare(b.valid_time))
    .map((r) => {
      const slr = strategy.computeRatio({ tmaxC: r.temp_c as number, calibrationMultiplier, avgWindSpeedKmh });
      return { at: r.valid_time, mm: r.swe_mm as number, snow: !slr.isRainCase, ratio: slr.ratio };
    });
  const totalMm = hours.reduce((sum, h) => sum + h.mm, 0);
  if (totalMm <= 0) return null;

  const snowHours = hours.filter((h) => h.snow);
  const snowMm = snowHours.reduce((sum, h) => sum + h.mm, 0);
  const snowRatio = snowMm > 0 ? snowHours.reduce((sum, h) => sum + h.mm * h.ratio, 0) / snowMm : 0;

  const wet = hours.filter((h) => h.mm >= PHASE_HOUR_MIN_PRECIP_MM);
  let phaseChange: PhaseChange | null = null;
  let phaseChangeAt: string | null = null;
  if (wet.length > 1 && wet[0]!.snow !== wet[wet.length - 1]!.snow) {
    const endSnow = wet[wet.length - 1]!.snow;
    let i = wet.length - 1;
    while (i > 0 && wet[i - 1]!.snow === endSnow) i--;
    phaseChange = endSnow ? "rain_to_snow" : "snow_to_rain";
    phaseChangeAt = wet[i]!.at;
  }

  return { snowFraction: snowMm / totalMm, snowRatio, phaseChange, phaseChangeAt };
}
