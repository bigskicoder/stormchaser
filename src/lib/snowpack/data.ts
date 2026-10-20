/**
 * Loads the snowpack model's inputs from the database: daily ERA5 weather
 * (reanalysis_daily, filled by the historical model run), the reference
 * station's readings (snotel_actuals), and forecast weather for the days
 * ERA5 hasn't reached yet (forecast_pulls through snowpack_forecast_hours).
 */

import { getServiceDb } from "@/lib/db/client";
import type { Resort } from "@/lib/db/types";
import { addCalendarDays, localDateRangeToUtc, utcInstantToLocalDateIso } from "@/lib/utils/timezone";
import { standardPressureHpa, waterYearOf, type SnowpackDay } from "./model";
import type { SnowpackObservation, SnowpackWinter } from "./fit";

/** Standard environmental lapse rate, °C per metre. */
export const LAPSE_RATE_C_PER_M = 0.0065;
/** Forecast days get the resort's recent mean humidity (our forecast pulls don't store humidity); this when there's none. */
export const FALLBACK_RH_PCT = 70;
/**
 * Station readings outside Nov 1 - Jun 30 are left out of fitting and
 * scoring. Summer days are bare ground at both model and station; counting
 * them would pad the NSE without testing anything.
 */
export function inScoringSeason(date: string): boolean {
  const m = Number(date.slice(5, 7));
  return m >= 11 || m <= 6;
}

const PAGE = 1000;

async function selectAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

interface ReanalysisRow {
  date: string;
  elevation_m: number;
  precip_mm: number | null;
  temp_min_c: number | null;
  temp_max_c: number | null;
  temp_mean_c: number | null;
  rh_mean_pct: number | null;
  wind_mean_ms: number | null;
  pressure_mean_hpa: number | null;
  shortwave_mj_m2: number | null;
}

/**
 * Daily ERA5 weather for a resort as model input, shifted by `tempOffsetC`
 * (lapse-rate adjustment to another elevation). Days missing temperature or
 * precipitation are dropped, so callers see gaps as missing dates.
 */
export async function loadReanalysisDays(resortId: string, opts: { from?: string; tempOffsetC?: number } = {}): Promise<{ days: SnowpackDay[]; elevationM: number | null }> {
  const db = getServiceDb();
  const rows = await selectAll<ReanalysisRow>((a, b) => {
    let q = db
      .from("reanalysis_daily")
      .select("date, elevation_m, precip_mm, temp_min_c, temp_max_c, temp_mean_c, rh_mean_pct, wind_mean_ms, pressure_mean_hpa, shortwave_mj_m2")
      .eq("resort_id", resortId)
      .order("date");
    if (opts.from) q = q.gte("date", opts.from);
    return q.range(a, b);
  });
  const off = opts.tempOffsetC ?? 0;
  const days: SnowpackDay[] = [];
  for (const r of rows) {
    if (r.precip_mm == null || r.temp_mean_c == null || r.temp_min_c == null || r.temp_max_c == null) continue;
    days.push({
      date: r.date,
      precipMm: Number(r.precip_mm),
      tMeanC: Number(r.temp_mean_c) + off,
      tMinC: Number(r.temp_min_c) + off,
      tMaxC: Number(r.temp_max_c) + off,
      rhPct: r.rh_mean_pct != null ? Number(r.rh_mean_pct) : FALLBACK_RH_PCT,
      windMs: r.wind_mean_ms != null ? Number(r.wind_mean_ms) : 0,
      pressureHpa: r.pressure_mean_hpa != null ? Number(r.pressure_mean_hpa) : standardPressureHpa(Number(r.elevation_m)),
      shortwaveMjM2: r.shortwave_mj_m2 != null ? Number(r.shortwave_mj_m2) : 0,
    });
  }
  return { days, elevationM: rows.length ? Number(rows[rows.length - 1]!.elevation_m) : null };
}

/** The reference station's daily SWE and depth, within the scoring season, with obviously broken readings removed. */
export async function loadObservations(resortId: string): Promise<SnowpackObservation[]> {
  const db = getServiceDb();
  const rows = await selectAll<{ date: string; observed_swe_mm: number | null; snow_depth_in: number | null }>((a, b) =>
    db.from("snotel_actuals").select("date, observed_swe_mm, snow_depth_in").eq("resort_id", resortId).order("date").range(a, b)
  );
  const out: SnowpackObservation[] = [];
  for (const r of rows) {
    if (!inScoringSeason(r.date)) continue;
    const swe = r.observed_swe_mm != null ? Number(r.observed_swe_mm) : null;
    const depthIn = r.snow_depth_in != null ? Number(r.snow_depth_in) : null;
    const sweOk = swe != null && swe >= 0 && swe <= 5000 ? swe : null;
    const depthOk = depthIn != null && depthIn >= 0 && depthIn <= 400 ? depthIn * 2.54 : null;
    if (sweOk != null || depthOk != null) out.push({ date: r.date, sweMm: sweOk, depthCm: depthOk });
  }
  return out;
}

/**
 * Groups weather days into water years and keeps only complete ones (every
 * day from Oct 1 through Jun 30 present), so each winter runs from bare
 * ground with no holes. Pure.
 */
export function buildWinters(days: SnowpackDay[], obs: SnowpackObservation[]): SnowpackWinter[] {
  const byYear = new Map<number, SnowpackDay[]>();
  for (const d of days) byYear.set(waterYearOf(d.date), [...(byYear.get(waterYearOf(d.date)) ?? []), d]);
  const obsByYear = new Map<number, SnowpackObservation[]>();
  for (const o of obs) obsByYear.set(waterYearOf(o.date), [...(obsByYear.get(waterYearOf(o.date)) ?? []), o]);

  const winters: SnowpackWinter[] = [];
  for (const [wy, list] of byYear) {
    const sorted = list.sort((a, b) => a.date.localeCompare(b.date));
    const have = new Set(sorted.map((d) => d.date));
    let complete = true;
    for (let d = `${wy - 1}-10-01`; d <= `${wy}-06-30`; d = addCalendarDays(d, 1)) {
      if (!have.has(d)) {
        complete = false;
        break;
      }
    }
    if (!complete) continue;
    // Contiguous from Oct 1 to the last day present.
    const days: SnowpackDay[] = [];
    for (const day of sorted) {
      if (day.date < `${wy - 1}-10-01`) continue;
      if (days.length && addCalendarDays(days[days.length - 1]!.date, 1) !== day.date) break;
      days.push(day);
    }
    winters.push({ waterYear: wy, days, obs: obsByYear.get(wy) ?? [] });
  }
  return winters.sort((a, b) => a.waterYear - b.waterYear);
}

export interface ForecastHour {
  model_name: string;
  valid_time: string;
  swe_mm: number | null;
  temp_2m_c: number | null;
  wind_speed_kmh: number | null;
}

/** A model-day needs this many hours of temperature to count. */
const MIN_HOURS_PER_MODEL_DAY = 20;

/**
 * Turns forecast hours (one row per model per hour) into daily model input:
 * each model's own daily totals and extremes, then the mean across models.
 * Surface temperature (temperature_2m), not the column maximum scoring uses.
 * Pure.
 */
export function forecastHoursToDays(hours: ForecastHour[], opts: { timeZone: string; rhPct: number; pressureHpa: number; shortwaveMjM2?: number }): SnowpackDay[] {
  const perModelDay = new Map<string, { precip: number; temps: number[]; winds: number[] }>();
  for (const h of hours) {
    const date = utcInstantToLocalDateIso(new Date(h.valid_time).getTime(), opts.timeZone);
    const key = `${h.model_name}|${date}`;
    const e = perModelDay.get(key) ?? { precip: 0, temps: [], winds: [] };
    if (h.swe_mm != null) e.precip += Number(h.swe_mm);
    if (h.temp_2m_c != null) e.temps.push(Number(h.temp_2m_c));
    if (h.wind_speed_kmh != null) e.winds.push(Number(h.wind_speed_kmh) / 3.6);
    perModelDay.set(key, e);
  }
  const byDate = new Map<string, Array<{ precip: number; tMean: number; tMin: number; tMax: number; wind: number | null }>>();
  for (const [key, e] of perModelDay) {
    if (e.temps.length < MIN_HOURS_PER_MODEL_DAY) continue;
    const date = key.split("|")[1]!;
    const list = byDate.get(date) ?? [];
    list.push({
      precip: e.precip,
      tMean: e.temps.reduce((a, b) => a + b, 0) / e.temps.length,
      tMin: Math.min(...e.temps),
      tMax: Math.max(...e.temps),
      wind: e.winds.length ? e.winds.reduce((a, b) => a + b, 0) / e.winds.length : null,
    });
    byDate.set(date, list);
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => {
      const winds = list.map((x) => x.wind).filter((w): w is number => w != null);
      return {
        date,
        precipMm: mean(list.map((x) => x.precip)),
        tMeanC: mean(list.map((x) => x.tMean)),
        tMinC: mean(list.map((x) => x.tMin)),
        tMaxC: mean(list.map((x) => x.tMax)),
        rhPct: opts.rhPct,
        windMs: winds.length ? mean(winds) : 0,
        pressureHpa: opts.pressureHpa,
        shortwaveMjM2: opts.shortwaveMjM2 ?? 0,
      };
    });
}

/**
 * Forecast weather for a resort's mid band, local dates [fromDate, toDate].
 * Our forecast pulls store neither humidity nor sunshine, so forecast days
 * get the caller's recent ERA5 means for both.
 */
export async function loadForecastDays(resort: Resort, fromDate: string, toDate: string, rhPct: number, shortwaveMjM2 = 0): Promise<SnowpackDay[]> {
  const db = getServiceDb();
  const args = {
    p_resort_id: resort.id,
    p_band: "mid",
    p_from: localDateRangeToUtc(fromDate, resort.timezone).start,
    p_to: localDateRangeToUtc(toDate, resort.timezone).end,
  };
  // Paged: PostgREST caps a response at 1,000 rows and a resort's window is more.
  const hours = await selectAll<ForecastHour>((a, b) => db.rpc("snowpack_forecast_hours", args).range(a, b));
  return forecastHoursToDays(hours, {
    timeZone: resort.timezone,
    rhPct,
    pressureHpa: standardPressureHpa(resort.elevation_mid_m),
    shortwaveMjM2,
  });
}
