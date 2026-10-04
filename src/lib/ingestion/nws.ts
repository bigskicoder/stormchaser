/**
 * NWS (National Weather Service, api.weather.gov) gridded-forecast
 * ingestion — the public-baseline comparison pipeline (user requested
 * "a pipeline to compare to OpenSnow"; see ROADMAP.md for why that's built
 * against api.weather.gov instead of OpenSnow itself: api.weather.gov is
 * public-domain federal data with no ToS restriction on automated access,
 * where OpenSnow is a paid proprietary product that explicitly prohibits
 * scraping — same line the BUILD_PRIMER already drew in section 2.3).
 *
 * This gives an independent, non-proprietary "would a public forecast have
 * called this storm" baseline to measure our own scoring engine against,
 * via the accuracy_log/backtest pipeline (section 5.5) rather than by
 * comparing against a competitor's product directly.
 *
 * ASSUMPTION FLAG: same network constraint as the other ingestion modules
 * (src/lib/ingestion/open-meteo.ts, snotel.ts) — this sandbox has no
 * outbound access to api.weather.gov, so this is built from documented NWS
 * API conventions, not a live-validated response. Higher confidence than
 * the Open-Meteo/SNOTEL assumptions since api.weather.gov's shape has been
 * stable and widely documented for years, but still verify against
 * https://www.weather.gov/documentation/services-web-api before trusting
 * the comparison numbers.
 *
 * NWS requires a descriptive User-Agent header identifying the application
 * and a contact method (not an API key) — see NWS_USER_AGENT in .env.example.
 */

import { getServiceDb } from "@/lib/db/client";
import type { Resort } from "@/lib/db/types";

const NWS_BASE_URL = "https://api.weather.gov";

function userAgent(): string {
  const contact = process.env.NWS_USER_AGENT ?? "powder-alert (contact not configured)";
  return contact;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": userAgent(), accept: "application/ld+json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`NWS request failed (${res.status}): ${url}\n${body.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

interface PointsResponse {
  properties: { gridId: string; gridX: number; gridY: number };
}

export async function resolveNwsGridpoint(lat: number, lng: number): Promise<{ gridId: string; gridX: number; gridY: number }> {
  const url = `${NWS_BASE_URL}/points/${lat.toFixed(4)},${lng.toFixed(4)}`;
  const body = await fetchJson<PointsResponse>(url);
  return body.properties;
}

export async function resolveNwsGridpointsForAllResorts(): Promise<void> {
  const db = getServiceDb();
  const { data, error } = await db.from("resorts").select("*");
  if (error) throw error;
  const resorts = (data ?? []) as Resort[];

  for (const resort of resorts) {
    try {
      const { gridId, gridX, gridY } = await resolveNwsGridpoint(resort.lat, resort.lng);
      await db
        .from("resorts")
        .update({ nws_grid_id: gridId, nws_grid_x: gridX, nws_grid_y: gridY, nws_resolved_at: new Date().toISOString() })
        .eq("id", resort.id);
    } catch {
      // Leave unresolved — the benchmark ingestion cron just skips this
      // resort until re-resolved, same pattern as SNOTEL station resolution.
    }
  }
}

interface GridValue {
  validTime: string; // ISO8601 "start/duration", e.g. "2026-01-15T06:00:00+00:00/PT6H"
  value: number | null;
}

interface GridpointResponse {
  properties: {
    snowfallAmount?: { uom: string; values: GridValue[] };
  };
}

async function fetchGridForecast(gridId: string, gridX: number, gridY: number): Promise<GridpointResponse> {
  return fetchJson<GridpointResponse>(`${NWS_BASE_URL}/gridpoints/${gridId}/${gridX},${gridY}`);
}

/** Parses a simple ISO8601 duration (PnDTnHnMnS, as NWS emits — days/hours/minutes in practice) into milliseconds. */
export function parseIso8601Duration(duration: string): number {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(duration);
  if (!match) throw new Error(`Unrecognized ISO8601 duration: ${duration}`);
  const [, days, hours, minutes, seconds] = match;
  return (
    (Number(days ?? 0) * 24 * 60 * 60 +
      Number(hours ?? 0) * 60 * 60 +
      Number(minutes ?? 0) * 60 +
      Number(seconds ?? 0)) *
    1000
  );
}

/**
 * NWS grid values are a sparse time series where each entry covers a
 * [start, start+duration) window, and windows don't align to calendar
 * days. Apportions each window's value across the UTC calendar day(s) it
 * overlaps, proportional to time overlap, then converts the per-day mm
 * total to inches. Pure function — see tests/ingestion/nws.test.ts.
 */
export function expandSnowfallSeriesToDailyTotalsIn(values: GridValue[]): Record<string, number> {
  const totalsMm: Record<string, number> = {};

  for (const entry of values) {
    if (entry.value == null) continue;
    const [startStr, durationStr] = entry.validTime.split("/");
    if (!startStr || !durationStr) continue;
    const startMs = new Date(startStr).getTime();
    const durationMs = parseIso8601Duration(durationStr);
    const endMs = startMs + durationMs;
    if (durationMs <= 0) continue;

    let cursor = startMs;
    while (cursor < endMs) {
      const dayStart = new Date(cursor);
      dayStart.setUTCHours(0, 0, 0, 0);
      const nextDayStartMs = dayStart.getTime() + 24 * 60 * 60 * 1000;
      const segmentEndMs = Math.min(endMs, nextDayStartMs);
      const overlapMs = segmentEndMs - cursor;
      const fraction = overlapMs / durationMs;
      const dateIso = dayStart.toISOString().slice(0, 10);
      totalsMm[dateIso] = (totalsMm[dateIso] ?? 0) + entry.value * fraction;
      cursor = segmentEndMs;
    }
  }

  const totalsIn: Record<string, number> = {};
  for (const [date, mm] of Object.entries(totalsMm)) {
    totalsIn[date] = mm / 25.4;
  }
  return totalsIn;
}

/** Pulls the current NWS grid forecast for every resort with a resolved gridpoint and stores daily snowfall totals. */
export async function ingestNwsBenchmark(): Promise<{ written: number; skipped: number; errors: string[] }> {
  const db = getServiceDb();
  const { data, error } = await db.from("resorts").select("*").eq("active", true).not("nws_grid_id", "is", null);
  if (error) throw error;
  const resorts = (data ?? []) as Resort[];

  let written = 0;
  let skipped = 0;
  const errors: string[] = [];
  const now = new Date();

  for (const resort of resorts) {
    if (!resort.nws_grid_id || resort.nws_grid_x == null || resort.nws_grid_y == null) {
      skipped += 1;
      continue;
    }
    try {
      const forecast = await fetchGridForecast(resort.nws_grid_id, resort.nws_grid_x, resort.nws_grid_y);
      const series = forecast.properties.snowfallAmount?.values ?? [];
      const dailyTotalsIn = expandSnowfallSeriesToDailyTotalsIn(series);

      const rows = Object.entries(dailyTotalsIn).map(([targetDate, estimatedSnowfallIn]) => ({
        resort_id: resort.id,
        source: "nws" as const,
        target_date: targetDate,
        estimated_snowfall_in: estimatedSnowfallIn,
        lead_time_hours: Math.max(0, (new Date(`${targetDate}T00:00:00Z`).getTime() - now.getTime()) / (1000 * 60 * 60)),
        raw_payload: { values: series },
      }));

      if (rows.length === 0) {
        skipped += 1;
        continue;
      }
      const { error: insertError } = await db.from("benchmark_forecasts").insert(rows);
      if (insertError) throw insertError;
      written += rows.length;
    } catch (err) {
      errors.push(`${resort.slug}: ${(err as Error).message}`);
    }
  }

  return { written, skipped, errors };
}
