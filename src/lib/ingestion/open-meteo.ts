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
    // Section 2.1: HRRR (CONUS, T+0-48h) via the GFS-family endpoint's model
    // selector. This was `models=hrrr`, which Open-Meteo rejects: the first
    // live cron runs (2026-10-18) wrote GFS rows for most resorts and zero
    // HRRR rows. Open-Meteo's GFS docs name the domain `ncep_hrrr_conus`,
    // matching their ncep_gfs_seamless / ncep_nbm_conus naming.
    url.searchParams.set("models", "ncep_hrrr_conus");
  }
  const apiKey = process.env.OPEN_METEO_API_KEY;
  if (apiKey) url.searchParams.set("apikey", apiKey);
  return url.toString();
}

/**
 * The ensemble API lives on its own host (ensemble-api.open-meteo.com, or
 * customer-ensemble-api... with a paid key), not under api.open-meteo.com.
 * The first live ensemble run (06:15 UTC 2026-10-18) got 404 on all 195
 * calls because it used the forecast host. Any other base URL (a test
 * mock, a proxy) is used as given.
 */
export function ensembleBaseUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  if (u.hostname === "api.open-meteo.com" || u.hostname === "customer-api.open-meteo.com") {
    u.hostname = u.hostname.replace("api.open-meteo.com", "ensemble-api.open-meteo.com");
  }
  return u.toString();
}

export function buildEnsembleUrl(params: {
  baseUrl: string;
  resort: Resort;
  elevationM: number;
  forecastDays?: number;
}): string {
  const { baseUrl, resort, elevationM, forecastDays = 10 } = params;
  const url = new URL(`${ensembleBaseUrl(baseUrl).replace(/\/$/, "")}/v1/ensemble`);
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

/** Drops the apikey param so error messages (which end up in cron_runs) never carry the key. */
function redactApiKey(url: string): string {
  const u = new URL(url);
  u.searchParams.delete("apikey");
  return u.toString();
}

const RETRY_DELAY_MS = 3_000;

/**
 * One retry on 429 or 5xx. The first live runs lost a handful of resorts
 * per hour to transient failures (8 of 65 at 03:00 UTC on 2026-10-18), and
 * the cron runs from Vercel's shared IPs, where Open-Meteo's free tier is
 * rate-limited per IP. A single short retry recovers the transient cases
 * without hammering the API.
 */
async function fetchJson<T>(url: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.ok) return (await res.json()) as T;
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt === 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      continue;
    }
    const body = await res.text().catch(() => "");
    throw new Error(`Open-Meteo request failed (${res.status}): ${redactApiKey(url)}\n${body.slice(0, 500)}`);
  }
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
 * Standard-atmosphere heights (m) of the requested pressure levels (ICAO
 * standard atmosphere). Real heights move by a hundred metres or two with
 * the weather; close enough to tell whether a level is above a resort.
 */
export const PRESSURE_LEVEL_STANDARD_HEIGHT_M = {
  temperature_850hPa: 1457,
  temperature_700hPa: 3012,
  temperature_500hPa: 5574,
} as const;

/**
 * Extracts the Kuchera-relevant "column Tmax" (max of surface 2m temp and
 * the sub-500hPa pressure-level temps ABOVE the point) for a single hourly
 * timestep, in Celsius. Falls back to surface temp alone when no
 * pressure-level data is present — a documented v1 simplification (see
 * lib/scoring/slr/kuchera.ts header).
 *
 * Levels below the point's elevation are skipped. Open-Meteo does not
 * return null for them, as this once assumed: it returns a value
 * extrapolated down through the mountain, which on a western resort is
 * far warmer than anything in the real column. At Alta mid (2,900 m) on a
 * snowy hour the 850 hPa value was +7.7 °C with the surface at -2.4 °C,
 * and taking the max flagged nearly every western storm as rain (found
 * 2026-10-18 after Nick said the score didn't tell rain from snow).
 */
export function columnTmaxC(hourly: OpenMeteoHourlyResponse["hourly"], i: number, elevationM: number): number | null {
  const levels = (Object.keys(PRESSURE_LEVEL_STANDARD_HEIGHT_M) as Array<keyof typeof PRESSURE_LEVEL_STANDARD_HEIGHT_M>).filter(
    (level) => PRESSURE_LEVEL_STANDARD_HEIGHT_M[level] > elevationM
  );
  const candidates = [hourly.temperature_2m?.[i], ...levels.map((level) => hourly[level]?.[i])].filter(
    (v): v is number => typeof v === "number"
  );
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}
