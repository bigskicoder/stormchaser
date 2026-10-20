/**
 * Saves ERA5 daily weather for one resort and date range to
 * reanalysis_daily without running the SLR backtest. Used by the historical
 * run's first step to keep the current season's weather fresh for every
 * resort, including the ones with no SNOTEL station (the SLR step only
 * covers resorts with one, and the natural snowpack model needs the
 * season's weather for all of them).
 */

import { getServiceDb } from "@/lib/db/client";
import { upsertInBatches } from "@/lib/db/batch-upsert";
import type { Resort } from "@/lib/db/types";
import { fetchHistoricalWeatherWithFallback } from "@/lib/ingestion/open-meteo-historical";
import { reanalysisDailyRows } from "./reanalysis-daily";

/** 23, not 24: the spring daylight-saving day has 23 local hours. */
const MIN_HOURS_FOR_WHOLE_DAY = 23;

export async function saveReanalysisWeather(resort: Resort, startDate: string, endDate: string): Promise<{ days: number; errors: string[] }> {
  try {
    const { weather, warning } = await fetchHistoricalWeatherWithFallback({ resort, elevationM: resort.elevation_mid_m, startDate, endDate });
    const rows = reanalysisDailyRows({ resortId: resort.id, timeZone: resort.timezone, elevationM: resort.elevation_mid_m, hourly: weather.hourly })
      .filter((r) => r.hours >= MIN_HOURS_FOR_WHOLE_DAY && r.temp_mean_c != null && r.precip_mm != null)
      .map((r) => ({ ...r, fetched_at: new Date().toISOString() }));
    const days = await upsertInBatches(getServiceDb(), "reanalysis_daily", rows, "resort_id,date");
    return { days, errors: warning ? [warning] : [] };
  } catch (err) {
    return { days: 0, errors: [(err as Error).message] };
  }
}
