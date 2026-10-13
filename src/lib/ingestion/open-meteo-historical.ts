/**
 * Open-Meteo's two historical products, used by the two backtest pipelines
 * (lib/backtest/slr-reanalysis.ts, lib/backtest/reconciliation-forecast-archive.ts).
 * They are NOT the same kind of data and shouldn't be confused:
 *
 * - Historical Weather API (archive-api.open-meteo.com) — ERA5/ERA5-Land
 *   REANALYSIS: the best retrospective reconstruction of what the
 *   atmosphere actually did, back to 1940. There is no forecast
 *   uncertainty in it — it's not "what a model predicted in advance," it's
 *   closer to ground truth itself. Good for validating the SLR formula
 *   (which only needs temperature + precipitation at the time of the
 *   storm), useless for validating multi-model reconciliation (there's
 *   only ever one value per hour, not several models disagreeing).
 * - Historical Forecast API (historical-forecast-api.open-meteo.com) —
 *   archived output from actual model runs, i.e. what GFS/ICON/etc.
 *   genuinely predicted at the time, preserving real forecast uncertainty.
 *   Much shallower coverage (~2021+, varies by model) but the only one of
 *   the two that can validate reconciliation/confidence logic.
 *
 * VERIFICATION STATUS: this sandbox's egress proxy blocks WebFetch to
 * every open-meteo.com subdomain (same EGRESS_BLOCKED result as the live
 * forecast API — see open-meteo.ts's own header), so none of this is
 * checked against a live response. WebSearch (which runs through separate
 * infrastructure) confirmed: both hosts/paths below, that the Historical
 * Weather API's hourly variables include temperature_2m/precipitation/
 * cloud_cover/wind_speed_10m (official docs, confirmed by name), that the
 * Historical Forecast API documents itself as taking "the same parameters
 * as the forecast API, plus start_date/end_date" (third-party summary of
 * the official docs, not the docs verbatim), and per-model start dates
 * (GFS 2021-03-23, ICON 2022-11-24). NOT confirmed: whether the archive
 * endpoint accepts the pressure-level temperature variables used for
 * Kuchera's "column Tmax" refinement (so this module deliberately
 * requests a smaller, high-confidence variable set for that endpoint
 * rather than risk an invalid param failing the whole request — Kuchera's
 * existing surface-temp fallback, see slr/kuchera.ts, already handles the
 * no-pressure-levels case, so this isn't a new simplification, just an
 * existing one applying here too); the exact `models=` identifier strings
 * accepted by the Historical Forecast API (HISTORICAL_FORECAST_MODEL_IDS
 * below is a best-effort mapping — one place to fix if any model ID is
 * wrong); and whether HRRR has historical-forecast-api coverage at all
 * (no source mentioned it, unlike GFS/ICON — deliberately excluded from
 * the reconciliation backtest's requested models rather than guessed at).
 */

import type { ModelName, Resort } from "@/lib/db/types";
import type { OpenMeteoHourlyResponse } from "./open-meteo";

const ARCHIVE_BASE_URL = process.env.OPEN_METEO_ARCHIVE_BASE_URL ?? "https://archive-api.open-meteo.com";
const HISTORICAL_FORECAST_BASE_URL =
  process.env.OPEN_METEO_HISTORICAL_FORECAST_BASE_URL ?? "https://historical-forecast-api.open-meteo.com";

/** Models NOT available in the Historical Forecast API's archive — see this module's header. Excluded from the reconciliation backtest's requested set entirely, not silently skipped per-request. */
export const HISTORICAL_FORECAST_UNAVAILABLE_MODELS: ModelName[] = ["hrrr"];

/** Best-effort `models=` identifiers for the Historical Forecast API — see this module's header for confidence level per model. */
export const HISTORICAL_FORECAST_MODEL_IDS: Partial<Record<ModelName, string>> = {
  gfs: "gfs_seamless",
  icon: "icon_seamless",
  ecmwf: "ecmwf_ifs04",
  gem: "gem_global",
};

/** Minimal, high-confidence hourly variable set for the reanalysis archive — see module header on why this is narrower than the live forecast API's list. */
export const HISTORICAL_WEATHER_HOURLY_VARIABLES = ["temperature_2m", "precipitation"] as const;

export interface HistoricalWeatherResponse {
  hourly: {
    time: string[];
    temperature_2m?: (number | null)[];
    precipitation?: (number | null)[];
  };
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

export function buildHistoricalWeatherUrl(params: { resort: Resort; elevationM: number; startDate: string; endDate: string }): string {
  const { resort, elevationM, startDate, endDate } = params;
  const url = new URL(`${ARCHIVE_BASE_URL.replace(/\/$/, "")}/v1/archive`);
  url.searchParams.set("latitude", resort.lat.toFixed(4));
  url.searchParams.set("longitude", resort.lng.toFixed(4));
  url.searchParams.set("elevation", String(Math.round(elevationM)));
  url.searchParams.set("start_date", dateOnly(startDate));
  url.searchParams.set("end_date", dateOnly(endDate));
  url.searchParams.set("hourly", HISTORICAL_WEATHER_HOURLY_VARIABLES.join(","));
  url.searchParams.set("timezone", "UTC");
  return url.toString();
}

export function buildHistoricalForecastUrl(params: {
  resort: Resort;
  model: ModelName;
  elevationM: number;
  startDate: string;
  endDate: string;
  hourlyVariables: readonly string[];
}): string {
  const { resort, model, elevationM, startDate, endDate, hourlyVariables } = params;
  const modelId = HISTORICAL_FORECAST_MODEL_IDS[model];
  if (!modelId) throw new Error(`No Historical Forecast API model id configured for ${model}`);

  const url = new URL(`${HISTORICAL_FORECAST_BASE_URL.replace(/\/$/, "")}/v1/forecast`);
  url.searchParams.set("latitude", resort.lat.toFixed(4));
  url.searchParams.set("longitude", resort.lng.toFixed(4));
  url.searchParams.set("elevation", String(Math.round(elevationM)));
  url.searchParams.set("start_date", dateOnly(startDate));
  url.searchParams.set("end_date", dateOnly(endDate));
  url.searchParams.set("hourly", hourlyVariables.join(","));
  url.searchParams.set("models", modelId);
  url.searchParams.set("timezone", "UTC");
  return url.toString();
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Open-Meteo historical request failed (${res.status}): ${url}\n${body.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

export async function fetchHistoricalWeather(params: {
  resort: Resort;
  elevationM: number;
  startDate: string;
  endDate: string;
}): Promise<HistoricalWeatherResponse> {
  return fetchJson<HistoricalWeatherResponse>(buildHistoricalWeatherUrl(params));
}

export async function fetchHistoricalForecast(params: {
  resort: Resort;
  model: ModelName;
  elevationM: number;
  startDate: string;
  endDate: string;
  hourlyVariables: readonly string[];
}): Promise<OpenMeteoHourlyResponse> {
  return fetchJson<OpenMeteoHourlyResponse>(buildHistoricalForecastUrl(params));
}
