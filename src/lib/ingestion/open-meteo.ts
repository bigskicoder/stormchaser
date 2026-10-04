/**
 * Open-Meteo ingestion (BUILD_PRIMER section 2.1 / 2.1a).
 *
 * ASSUMPTION FLAG: this sandbox has no outbound network access to
 * api.open-meteo.com (verified — proxy policy denies the host), so these
 * request shapes are built from documented Open-Meteo API conventions, not
 * a live-validated response. Every model call funnels through
 * `buildForecastUrl` / the shared `hourly` variable list below, so if the
 * live schema diverges (param name, variable name, or elevation-batching
 * syntax), there is exactly one place to fix it. Verify against
 * https://open-meteo.com/en/docs before the first production cron run.
 */

import type { ElevationBand, ModelName } from "@/lib/db/types";
import type { Resort } from "@/lib/db/types";

export const OPEN_METEO_MODEL_PATHS: Record<ModelName, string> = {
  hrrr: "gfs", // HRRR is bundled into the /v1/gfs family endpoint's high-res CONUS blend per section 2.1
  gfs: "gfs",
  icon: "dwd-icon",
  ecmwf: "ecmwf",
  gem: "gem",
};

/**
 * Hourly variables pulled for every model/band request. Column
 * pressure-level temperatures (below 500 hPa) are requested so the Kuchera
 * SLR strategy (lib/scoring/slr/kuchera.ts) can use true column Tmax rather
 * than only surface temperature — see section 5.3's Tmax definition.
 */
export const HOURLY_VARIABLES = [
  "temperature_2m",
  "precipitation",
  "freezing_level_height",
  "cloud_cover",
  "wind_speed_10m",
  "wind_gusts_10m",
  "wind_direction_10m",
  "wind_speed_80m",
  "temperature_850hPa",
  "temperature_700hPa",
  "temperature_500hPa",
] as const;

export interface ElevationBandPoint {
  band: ElevationBand;
  elevationM: number;
}

export function bandPointsFor(resort: Resort): ElevationBandPoint[] {
  return [
    { band: "base", elevationM: resort.elevation_base_m },
    { band: "mid", elevationM: resort.elevation_mid_m },
    { band: "summit", elevationM: resort.elevation_summit_m },
  ];
}

/**
 * Builds one request URL per (model, elevation band). Section 2.1a is
 * explicit that omitting `elevation=` collapses all three bands to the same
 * grid-cell average, so this is never optional. Discrete per-band calls are
 * used rather than the API's comma-separated multi-point batching, since
 * that batching multiplexes lat/lng pairs (not a single point at multiple
 * elevations) in the documented API shape — safer to issue 3 explicit calls
 * per resort per model than assume batching semantics that may not exist.
 */
export function buildForecastUrl(params: {
  baseUrl: string;
  model: ModelName;
  resort: Resort;
  elevationM: number;
  forecastDays?: number;
  pastDays?: number;
}): string {
  const { baseUrl, model, resort, elevationM, forecastDays = 10, pastDays = 0 } = params;
  const path = OPEN_METEO_MODEL_PATHS[model];
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/v1/${path}`);
  url.searchParams.set("latitude", resort.lat.toFixed(4));
  url.searchParams.set("longitude", resort.lng.toFixed(4));
  url.searchParams.set("elevation", String(Math.round(elevationM)));
  url.searchParams.set("hourly", HOURLY_VARIABLES.join(","));
  url.searchParams.set("forecast_days", String(forecastDays));
  if (pastDays > 0) url.searchParams.set("past_days", String(pastDays));
  url.searchParams.set("timezone", "UTC");
  if (model === "hrrr") {
    // Section 2.1: HRRR sub-hourly res for T+0-48h, bundled via the GFS
    // family endpoint's model selector. If Open-Meteo's live schema exposes
    // HRRR as models=hrrr on the gfs endpoint (vs a dedicated path), this is
    // the one place to adjust.
    url.searchParams.set("models", "hrrr");
  }
  const apiKey = process.env.OPEN_METEO_API_KEY;
  if (apiKey) url.searchParams.set("apikey", apiKey);
  return url.toString();
}

export function buildEnsembleUrl(params: {
  baseUrl: string;
  resort: Resort;
  elevationM: number;
  forecastDays?: number;
}): string {
  const { baseUrl, resort, elevationM, forecastDays = 10 } = params;
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/v1/ensemble`);
  url.searchParams.set("latitude", resort.lat.toFixed(4));
  url.searchParams.set("longitude", resort.lng.toFixed(4));
  url.searchParams.set("elevation", String(Math.round(elevationM)));
  url.searchParams.set("hourly", "temperature_2m,precipitation");
  url.searchParams.set("forecast_days", String(forecastDays));
  url.searchParams.set("timezone", "UTC");
  // GEFS (NOAA) is the primary US-relevant ensemble system; adjust per live docs if needed.
  url.searchParams.set("models", "gfs_seamless");
  const apiKey = process.env.OPEN_METEO_API_KEY;
  if (apiKey) url.searchParams.set("apikey", apiKey);
  return url.toString();
}

export interface OpenMeteoHourlyResponse {
  hourly: {
    time: string[];
    temperature_2m?: (number | null)[];
    precipitation?: (number | null)[];
    freezing_level_height?: (number | null)[];
    cloud_cover?: (number | null)[];
    wind_speed_10m?: (number | null)[];
    wind_gusts_10m?: (number | null)[];
    wind_direction_10m?: (number | null)[];
    wind_speed_80m?: (number | null)[];
    temperature_850hPa?: (number | null)[];
    temperature_700hPa?: (number | null)[];
    temperature_500hPa?: (number | null)[];
    [key: string]: unknown;
  };
  hourly_units?: Record<string, string>;
}

export interface OpenMeteoEnsembleResponse {
  hourly: {
    time: string[];
    // Ensemble responses key each member as `${variable}_member${NN}`, e.g.
    // temperature_2m_member01, temperature_2m_member02, ...
    [key: string]: unknown;
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Open-Meteo request failed (${res.status}): ${url}\n${body.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

export async function fetchModelBand(params: {
  baseUrl: string;
  model: ModelName;
  resort: Resort;
  elevationM: number;
}): Promise<OpenMeteoHourlyResponse> {
  const url = buildForecastUrl(params);
  return fetchJson<OpenMeteoHourlyResponse>(url);
}

export async function fetchEnsembleBand(params: {
  baseUrl: string;
  resort: Resort;
  elevationM: number;
}): Promise<OpenMeteoEnsembleResponse> {
  const url = buildEnsembleUrl(params);
  return fetchJson<OpenMeteoEnsembleResponse>(url);
}

/**
 * Extracts the Kuchera-relevant "column Tmax" (max of surface 2m temp and
 * the sub-500hPa pressure-level temps that are present) for a single hourly
 * timestep, in Celsius. Pressure levels below terrain come back null from
 * Open-Meteo and are skipped. Falls back to surface temp alone when no
 * pressure-level data is present — a documented v1 simplification (see
 * lib/scoring/slr/kuchera.ts header).
 */
export function columnTmaxC(hourly: OpenMeteoHourlyResponse["hourly"], i: number): number | null {
  const candidates = [
    hourly.temperature_2m?.[i],
    hourly.temperature_850hPa?.[i],
    hourly.temperature_700hPa?.[i],
    hourly.temperature_500hPa?.[i],
  ].filter((v): v is number => typeof v === "number");
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}
