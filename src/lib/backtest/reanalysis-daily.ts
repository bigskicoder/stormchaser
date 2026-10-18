/**
 * Turns an ERA5 archive response into one reanalysis_daily row per
 * resort-local day (migration 0014). Inputs for the planned natural
 * base-depth model; the SLR backtest's own daily buckets
 * (bucketHourlyReanalysisByLocalDay) are unchanged and separate.
 *
 * Units as Open-Meteo returns them with wind_speed_unit=ms: precipitation
 * mm, snowfall cm, temperatures and dew point °C, humidity and cloud %,
 * wind m/s, surface pressure hPa. Shortwave is an hourly mean in W/m²,
 * summed here to a daily energy in MJ/m² (W/m² x 3600 s / 1e6).
 *
 * Missing hours are skipped, never counted as zero; a variable with no
 * readings on a day is null. `hours` records how many timestamps the day
 * had (23 or 25 on DST-change days, fewer on a chunk's partial edge days)
 * so a later model can drop incomplete days.
 */

import type { HistoricalWeatherResponse } from "@/lib/ingestion/open-meteo-historical";
import { utcInstantToLocalDateIso } from "@/lib/utils/timezone";

export interface ReanalysisDailyRow {
  resort_id: string;
  date: string;
  elevation_m: number;
  hours: number;
  precip_mm: number | null;
  snowfall_cm: number | null;
  temp_min_c: number | null;
  temp_max_c: number | null;
  temp_mean_c: number | null;
  dew_point_mean_c: number | null;
  rh_mean_pct: number | null;
  wind_mean_ms: number | null;
  wind_max_ms: number | null;
  shortwave_mj_m2: number | null;
  pressure_mean_hpa: number | null;
  cloud_cover_mean_pct: number | null;
}

type Hourly = HistoricalWeatherResponse["hourly"];
type Var = Exclude<keyof Hourly, "time">;

const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;

export function reanalysisDailyRows(params: {
  resortId: string;
  timeZone: string;
  elevationM: number;
  hourly: Hourly;
}): ReanalysisDailyRow[] {
  const { resortId, timeZone, elevationM, hourly } = params;
  const byDate = new Map<string, number[]>();
  hourly.time.forEach((t, i) => {
    const date = utcInstantToLocalDateIso(new Date(`${t}Z`).getTime(), timeZone);
    const idx = byDate.get(date) ?? [];
    idx.push(i);
    byDate.set(date, idx);
  });

  const values = (v: Var, idx: number[]) => {
    const series = hourly[v];
    if (!series) return [];
    return idx.map((i) => series[i]).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  };
  const sum = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) : null);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const r = (v: number | null, places = 2) => (v == null ? null : round(v, places));

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, idx]) => {
      const temps = values("temperature_2m", idx);
      const wind = values("wind_speed_10m", idx);
      const sw = sum(values("shortwave_radiation", idx));
      return {
        resort_id: resortId,
        date,
        elevation_m: Math.round(elevationM),
        hours: idx.length,
        precip_mm: r(sum(values("precipitation", idx))),
        snowfall_cm: r(sum(values("snowfall", idx))),
        temp_min_c: temps.length ? r(Math.min(...temps)) : null,
        temp_max_c: temps.length ? r(Math.max(...temps)) : null,
        temp_mean_c: r(mean(temps)),
        dew_point_mean_c: r(mean(values("dew_point_2m", idx))),
        rh_mean_pct: r(mean(values("relative_humidity_2m", idx)), 1),
        wind_mean_ms: r(mean(wind)),
        wind_max_ms: wind.length ? r(Math.max(...wind)) : null,
        shortwave_mj_m2: sw == null ? null : r((sw * 3600) / 1e6, 3),
        pressure_mean_hpa: r(mean(values("surface_pressure", idx)), 1),
        cloud_cover_mean_pct: r(mean(values("cloud_cover", idx)), 1),
      };
    });
}
