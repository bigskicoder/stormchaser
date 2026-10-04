import { getServiceDb } from "@/lib/db/client";
import type { ElevationBand, ModelName, Resort } from "@/lib/db/types";
import {
  bandPointsFor,
  columnTmaxC,
  fetchEnsembleBand,
  fetchModelBand,
  type OpenMeteoHourlyResponse,
} from "@/lib/ingestion/open-meteo";

const OPEN_METEO_BASE_URL = process.env.OPEN_METEO_BASE_URL ?? "https://api.open-meteo.com";

async function getActiveResorts(): Promise<Resort[]> {
  const db = getServiceDb();
  const { data, error } = await db.from("resorts").select("*").eq("active", true);
  if (error) throw error;
  return (data ?? []) as Resort[];
}

function rowsFromHourlyResponse(params: {
  resort: Resort;
  model: ModelName;
  band: ElevationBand;
  runInitTime: string;
  response: OpenMeteoHourlyResponse;
}) {
  const { resort, model, band, runInitTime, response } = params;
  const times = response.hourly?.time ?? [];
  return times.map((t, i) => {
    const tmaxC = columnTmaxC(response.hourly, i);
    return {
      resort_id: resort.id,
      model_name: model,
      elevation_band: band,
      run_init_time: runInitTime,
      valid_time: new Date(`${t}Z`).toISOString(),
      raw_payload: {
        temperature_2m: response.hourly.temperature_2m?.[i] ?? null,
        precipitation: response.hourly.precipitation?.[i] ?? null,
        freezing_level_height: response.hourly.freezing_level_height?.[i] ?? null,
        cloud_cover: response.hourly.cloud_cover?.[i] ?? null,
        wind_speed_10m: response.hourly.wind_speed_10m?.[i] ?? null,
        wind_gusts_10m: response.hourly.wind_gusts_10m?.[i] ?? null,
        wind_direction_10m: response.hourly.wind_direction_10m?.[i] ?? null,
        wind_speed_80m: response.hourly.wind_speed_80m?.[i] ?? null,
        temperature_850hPa: response.hourly.temperature_850hPa?.[i] ?? null,
        temperature_700hPa: response.hourly.temperature_700hPa?.[i] ?? null,
        temperature_500hPa: response.hourly.temperature_500hPa?.[i] ?? null,
      },
      // temp_c stores the Kuchera-relevant column-max temperature, not raw
      // surface temp — see open-meteo.ts columnTmaxC() and section 5.3.
      temp_c: tmaxC,
      swe_mm: response.hourly.precipitation?.[i] ?? null,
      wind_speed_kmh: response.hourly.wind_speed_10m?.[i] ?? null,
      wind_gust_kmh: response.hourly.wind_gusts_10m?.[i] ?? null,
      wind_dir_deg: response.hourly.wind_direction_10m?.[i] ?? null,
      freezing_level_m: response.hourly.freezing_level_height?.[i] ?? null,
      cloud_cover_pct: response.hourly.cloud_cover?.[i] ?? null,
    };
  });
}

/**
 * Pulls a set of models for every active resort x 3 elevation bands, and
 * upserts into forecast_pulls. Cost note (section 2.1a): elevation-banding
 * triples per-model call volume (3 bands x N models x N resorts) — at the
 * ~50-resort scale seeded here that's within Open-Meteo's free non-commercial
 * tier, but re-check limits if the resort count grows materially.
 */
export async function ingestModels(models: ModelName[]): Promise<{ resorts: number; rowsWritten: number; errors: string[] }> {
  const db = getServiceDb();
  const resorts = await getActiveResorts();
  const runInitTime = new Date().toISOString();
  let rowsWritten = 0;
  const errors: string[] = [];

  for (const resort of resorts) {
    for (const model of models) {
      for (const { band, elevationM } of bandPointsFor(resort)) {
        try {
          const response = await fetchModelBand({
            baseUrl: OPEN_METEO_BASE_URL,
            model,
            resort,
            elevationM,
          });
          const rows = rowsFromHourlyResponse({ resort, model, band, runInitTime, response });
          if (rows.length === 0) continue;
          const { error } = await db.from("forecast_pulls").insert(rows);
          if (error) throw error;
          rowsWritten += rows.length;
        } catch (err) {
          errors.push(`${resort.slug}/${model}/${band}: ${(err as Error).message}`);
        }
      }
    }
  }

  return { resorts: resorts.length, rowsWritten, errors };
}

/**
 * Pulls ensemble members for every active resort x 3 elevation bands, and
 * upserts into ensemble_pulls. Member-count/name assumptions documented in
 * lib/ingestion/open-meteo.ts.
 */
export async function ingestEnsemble(): Promise<{ resorts: number; rowsWritten: number; errors: string[] }> {
  const db = getServiceDb();
  const resorts = await getActiveResorts();
  const runInitTime = new Date().toISOString();
  let rowsWritten = 0;
  const errors: string[] = [];

  for (const resort of resorts) {
    for (const { band, elevationM } of bandPointsFor(resort)) {
      try {
        const response = await fetchEnsembleBand({ baseUrl: OPEN_METEO_BASE_URL, resort, elevationM });
        const times = response.hourly?.time ?? [];
        const memberKeys = Object.keys(response.hourly).filter((k) => /^precipitation_member\d+$/.test(k));

        const rows: Array<{
          resort_id: string;
          elevation_band: ElevationBand;
          member_id: number;
          run_init_time: string;
          valid_time: string;
          swe_mm: number | null;
        }> = [];

        for (const key of memberKeys) {
          const memberId = Number(key.match(/(\d+)$/)?.[1] ?? "0");
          const series = response.hourly[key] as (number | null)[] | undefined;
          if (!series) continue;
          times.forEach((t, i) => {
            rows.push({
              resort_id: resort.id,
              elevation_band: band,
              member_id: memberId,
              run_init_time: runInitTime,
              valid_time: new Date(`${t}Z`).toISOString(),
              swe_mm: series[i] ?? null,
            });
          });
        }

        if (rows.length === 0) continue;
        const { error } = await db.from("ensemble_pulls").insert(rows);
        if (error) throw error;
        rowsWritten += rows.length;
      } catch (err) {
        errors.push(`${resort.slug}/ensemble/${band}: ${(err as Error).message}`);
      }
    }
  }

  return { resorts: resorts.length, rowsWritten, errors };
}
