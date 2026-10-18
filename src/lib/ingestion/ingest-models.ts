import { PRIMARY_SCORING_ELEVATION_BAND } from "@/lib/config/constants";
import { getServiceDb } from "@/lib/db/client";
import type { ElevationBand, ModelName, Resort } from "@/lib/db/types";
import {
  bandPointsFor,
  columnTmaxC,
  fetchEnsembleBand,
  fetchModelBand,
  type OpenMeteoEnsembleResponse,
  type OpenMeteoHourlyResponse,
} from "@/lib/ingestion/open-meteo";
import { localDateRangeToUtc, utcInstantToLocalDateIso } from "@/lib/utils/timezone";

const OPEN_METEO_BASE_URL = process.env.OPEN_METEO_BASE_URL ?? "https://api.open-meteo.com";

/**
 * Stop starting new resorts after this long, so a slow run still returns
 * and gets logged to cron_runs before Vercel's 300 s limit kills it. The
 * 06:00 UTC runs on 2026-10-18 hit that limit with no log at all (7 of 65
 * resorts for HRRR/GFS, 2-4 for ICON/ECMWF/GEM).
 */
export const INGEST_TIME_BUDGET_MS = 240_000;

/**
 * Models for the hourly ingest cron. HRRR is a new run every hour; GFS
 * is a new run every 6 hours (00/06/12/18 UTC, on Open-Meteo about 4
 * hours later). Pulling GFS hourly stored the
 * same run six times over and used ~2,300 of Open-Meteo's ~10,000 free
 * daily calls for nothing, so GFS rides along only at 05/11/17/23 UTC.
 */
export function hourlyModelsForUtcHour(utcHour: number): ModelName[] {
  return utcHour % 6 === 5 ? ["hrrr", "gfs"] : ["hrrr"];
}

function timeLimitError(done: number, total: number): string {
  return `stopped at the ${INGEST_TIME_BUDGET_MS / 1000}s time budget after ${done} of ${total} resorts`;
}

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
  const bandElevationM = bandPointsFor(resort).find((b) => b.band === band)!.elevationM;
  const rows = times.map((t, i) => {
    const tmaxC = columnTmaxC(response.hourly, i, bandElevationM);
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
  // Hours past a model's own horizon come back all-null (HRRR is ~48 h of
  // the 10 days requested, so ~80% of its rows were empty). Storing them
  // only cost space; scoring treats a missing hour the same way.
  return rows.filter((r) => r.swe_mm != null || r.temp_c != null);
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
  const startedAt = Date.now();
  let rowsWritten = 0;
  const errors: string[] = [];

  for (const [done, resort] of resorts.entries()) {
    if (Date.now() - startedAt > INGEST_TIME_BUDGET_MS) {
      errors.unshift(timeLimitError(done, resorts.length));
      break;
    }
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
 * Collapses one ensemble response to one row per member per resort-local
 * day, stamped at that day's local-midnight start (in UTC). Scoring only
 * ever sums a member over a local day (aggregate.ts
 * fetchEnsembleMemberTotalsForDay, valid_time >= day start and < day
 * end), so the day total gives it exactly the same answer from 1/24th of
 * the rows. Hourly storage was 483,600 rows (~100 MB) per run on
 * 2026-10-18. The control run comes back as plain `precipitation`; it
 * counts as member 0. Hours with no value are skipped, and a day with no
 * values at all gets no row.
 */
export function ensembleDailyRows(params: {
  resort: Pick<Resort, "id" | "timezone">;
  band: ElevationBand;
  runInitTime: string;
  response: OpenMeteoEnsembleResponse;
}): Array<{
  resort_id: string;
  elevation_band: ElevationBand;
  member_id: number;
  run_init_time: string;
  valid_time: string;
  swe_mm: number;
}> {
  const { resort, band, runInitTime, response } = params;
  const times = response.hourly?.time ?? [];
  const localDates = times.map((t) => utcInstantToLocalDateIso(Date.parse(`${t}Z`), resort.timezone));
  const memberKeys = Object.keys(response.hourly ?? {}).filter((k) => /^precipitation(_member\d+)?$/.test(k));

  const rows = [];
  for (const key of memberKeys) {
    const memberId = Number(key.match(/_member(\d+)$/)?.[1] ?? "0");
    const series = response.hourly[key] as (number | null)[] | undefined;
    if (!series) continue;
    const totals = new Map<string, number>();
    series.forEach((v, i) => {
      const date = localDates[i];
      if (v == null || date == null) return;
      totals.set(date, (totals.get(date) ?? 0) + v);
    });
    for (const [date, total] of totals) {
      rows.push({
        resort_id: resort.id,
        elevation_band: band,
        member_id: memberId,
        run_init_time: runInitTime,
        valid_time: localDateRangeToUtc(date, resort.timezone).start,
        swe_mm: total,
      });
    }
  }
  return rows;
}

/**
 * Pulls ensemble members for every active resort at the primary scoring
 * band only, and inserts daily member totals (ensembleDailyRows) into
 * ensemble_pulls. Scoring reads only that band
 * (aggregate.ts fetchEnsembleMemberTotalsForDay), and 31 members x 240 h
 * per call makes the other two bands the bulk of the table for nothing.
 * Member-count/name assumptions documented in lib/ingestion/open-meteo.ts.
 */
export async function ingestEnsemble(): Promise<{ resorts: number; rowsWritten: number; errors: string[] }> {
  const db = getServiceDb();
  const resorts = await getActiveResorts();
  const runInitTime = new Date().toISOString();
  let rowsWritten = 0;
  const errors: string[] = [];

  const startedAt = Date.now();

  for (const [done, resort] of resorts.entries()) {
    if (Date.now() - startedAt > INGEST_TIME_BUDGET_MS) {
      errors.unshift(timeLimitError(done, resorts.length));
      break;
    }
    for (const { band, elevationM } of bandPointsFor(resort).filter((p) => p.band === PRIMARY_SCORING_ELEVATION_BAND)) {
      try {
        const response = await fetchEnsembleBand({ baseUrl: OPEN_METEO_BASE_URL, resort, elevationM });
        const rows = ensembleDailyRows({ resort, band, runInitTime, response });
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
