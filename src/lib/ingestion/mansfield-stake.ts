/**
 * NOAA NCEI GHCND ingestion for the Mount Mansfield snow stake — a
 * Stowe-specific ground-truth source, requested directly ("can u integrate
 * data from the Mansfield snow stake"). Deliberately NOT a generalized
 * second network (unlike SNOTEL's nearest-station search): Mount Mansfield
 * IS Stowe's own mountain, the stake is read daily by NWS Burlington with
 * a record back to 1954, and this is a one-off manual pairing
 * (resorts.ghcnd_station_id) rather than something a distance-match
 * algorithm resolves. The mechanism here is generic (any resort with a
 * ghcnd_station_id gets pulled), but today Stowe is the only seeded one.
 *
 * UNVERIFIED FLAG: built to the documented NCEI CDO v2 API contract
 * (https://www.ncei.noaa.gov/cdo-web/webservices/v2 — token required in
 * the request HEADER, not the URL; rate-limited to 5 req/sec / 10,000
 * req/day; `/data` endpoint takes datasetid=GHCND, datatypeid, stationid,
 * startdate/enddate, units, limit (max 1000) + offset pagination) — not
 * live-verified against a real response. Every *.noaa.gov host this
 * session attempted (including this one, via WebFetch) returned a DNS
 * resolution failure from this sandbox — the same EGRESS_BLOCKED pattern
 * documented throughout this directory for SNOTEL/NWS/Open-Meteo. Needs a
 * real NCEI_CDO_TOKEN (free, self-service signup) to even attempt a live
 * call — see .env.example.
 *
 * SNWD (snow depth) units: two independent secondary sources (not NOAA's
 * own GHCND readme, which this sandbox couldn't reach) agree SNWD is
 * reported in plain millimeters, unlike PRCP/TMAX which use tenths of a
 * unit — this module assumes mm. If a live value looks ~10x too large or
 * small, check that assumption first.
 *
 * resort.ghcnd_station_id itself is flagged separately — see migration
 * 0011 and resorts-seed.ts's Stowe entry for why the seeded id is a
 * single-source, unconfirmed lead, not a verified fact.
 *
 * Same no-lookahead guarantee as snotel.ts: ground truth only, never
 * joined into forward-looking scoring.
 */

import { getServiceDb } from "@/lib/db/client";
import { upsertInBatches } from "@/lib/db/batch-upsert";
import type { Resort } from "@/lib/db/types";
import { computeDepthChangeSeries } from "./snotel";

const CDO_BASE_URL = "https://www.ncei.noaa.gov/cdo-web/api/v2";
const CDO_PAGE_LIMIT = 1000;
const SNOW_DEPTH_DATATYPE = "SNWD";

function cdoToken(): string {
  const token = process.env.NCEI_CDO_TOKEN;
  if (!token) throw new Error("NCEI_CDO_TOKEN not configured");
  return token;
}

/** Millimeters (GHCND's documented SNWD unit — see module header) to inches, matching the inches convention snotel_actuals already stores depth in. Exported for unit testing. */
export function mmToIn(mm: number): number {
  return mm / 25.4;
}

/**
 * Splits [startDate, endDate] into calendar-year chunks. Precautionary,
 * not a confirmed requirement: this session couldn't reach NCEI to confirm
 * whether the CDO v2 API enforces a per-request date-range cap (commonly
 * cited for this API family, but not independently verified here). Chunking
 * costs a few extra requests if no cap exists; not chunking risks silently
 * truncating a multi-decade backfill if one does. Exported for unit testing.
 */
export function chunkDateRangeByYear(startDate: string, endDate: string): Array<{ start: string; end: string }> {
  const chunks: Array<{ start: string; end: string }> = [];
  let chunkStart = startDate;
  while (chunkStart <= endDate) {
    const chunkStartYear = Number(chunkStart.slice(0, 4));
    const yearEnd = `${chunkStartYear}-12-31`;
    const chunkEnd = yearEnd < endDate ? yearEnd : endDate;
    chunks.push({ start: chunkStart, end: chunkEnd });
    const nextYear = chunkStartYear + 1;
    chunkStart = `${nextYear}-01-01`;
  }
  return chunks;
}

interface GhcndDataPoint {
  /** ISO datetime string, e.g. "2024-01-15T00:00:00" — only the date portion is used. */
  date: string;
  datatype: string;
  station: string;
  value: number;
}

interface GhcndDataResponse {
  results?: GhcndDataPoint[];
  metadata?: { resultset?: { count?: number } };
}

async function fetchGhcndPage(params: {
  stationId: string;
  startDate: string;
  endDate: string;
  offset: number;
}): Promise<{ results: GhcndDataPoint[]; count: number }> {
  const url = new URL(`${CDO_BASE_URL}/data`);
  url.searchParams.set("datasetid", "GHCND");
  url.searchParams.set("stationid", `GHCND:${params.stationId}`);
  url.searchParams.set("datatypeid", SNOW_DEPTH_DATATYPE);
  url.searchParams.set("startdate", params.startDate);
  url.searchParams.set("enddate", params.endDate);
  url.searchParams.set("units", "metric");
  url.searchParams.set("limit", String(CDO_PAGE_LIMIT));
  url.searchParams.set("offset", String(params.offset));

  const res = await fetch(url.toString(), { headers: { token: cdoToken() } });
  if (!res.ok) throw new Error(`NCEI CDO request failed (${res.status})`);
  const body = (await res.json()) as GhcndDataResponse;
  return { results: body.results ?? [], count: body.metadata?.resultset?.count ?? 0 };
}

/** Fetches every page of SNWD for one station across a (possibly multi-year) date range, handling both the API's 1000-row/page cap and the precautionary per-year chunking above. */
async function fetchAllSnowDepth(stationId: string, startDate: string, endDate: string): Promise<GhcndDataPoint[]> {
  const all: GhcndDataPoint[] = [];
  for (const chunk of chunkDateRangeByYear(startDate, endDate)) {
    let offset = 0;
    for (;;) {
      const page = await fetchGhcndPage({ stationId, startDate: chunk.start, endDate: chunk.end, offset });
      all.push(...page.results);
      offset += CDO_PAGE_LIMIT;
      if (page.results.length === 0 || offset >= page.count) break;
    }
  }
  return all;
}

/**
 * Pulls Mount Mansfield (or any future resort's own paired station) snow
 * depth over an explicit date range and upserts into snotel_actuals with
 * source='ghcnd' — same table, same (resort_id, date) upsert key, same
 * computeDepthChangeSeries transformation SNOTEL already uses (lib/ingestion/
 * snotel.ts), just a different upstream source. Shared by the live rolling
 * cron (ingestMansfieldStakeActuals below), scripts/seed-resorts.ts's
 * full-history backfill, and scripts/analyze-mansfield-enso.ts's research
 * query — one ingestion path, several consumers, same pattern as SNOTEL's
 * backfillSnotelActualsForResort.
 */
export async function backfillMansfieldStakeForResort(
  resort: Resort,
  startDate: string,
  endDate: string
): Promise<{ written: number; skipped: boolean; error?: string }> {
  const db = getServiceDb();
  if (!resort.ghcnd_station_id) return { written: 0, skipped: true };

  try {
    const points = await fetchAllSnowDepth(resort.ghcnd_station_id, startDate, endDate);
    if (points.length === 0) return { written: 0, skipped: true };

    const depthPoints = points
      .filter((p) => p.datatype === SNOW_DEPTH_DATATYPE)
      .map((p) => ({ date: p.date.slice(0, 10), depthIn: mmToIn(p.value) }));
    const depthChanges = computeDepthChangeSeries(depthPoints);

    const rows = depthChanges.map((change) => ({
      resort_id: resort.id,
      station_triplet: resort.ghcnd_station_id,
      date: change.date,
      // GHCND's WTEQ-equivalent element isn't pulled here — this
      // integration is depth-only, same as SNOTEL's own
      // observed_depth_change_in-based "new snowfall" proxy.
      observed_swe_mm: null,
      snow_depth_in: change.depthIn,
      observed_depth_change_in: change.changeIn,
      source: "ghcnd",
    }));
    const written = await upsertInBatches(db, "snotel_actuals", rows, "resort_id,date");
    return { written, skipped: false };
  } catch (err) {
    return { written: 0, skipped: false, error: (err as Error).message };
  }
}

/** Same rolling-window rationale as snotel.ts's SNOTEL_BACKFILL_WINDOW_DAYS. */
const MANSFIELD_ROLLING_WINDOW_DAYS = 10;

/**
 * Pulls a rolling window of Mansfield-equivalent data for every resort
 * with a resolved ghcnd_station_id (just Stowe today). Called from the
 * same daily cron slot as ingestSnotelActuals (api/cron/ingest-snotel) —
 * one more ground-truth source feeding the same route, not a new Vercel
 * Cron schedule entry (see ROADMAP.md's Hobby-plan cron-count caveat).
 */
export async function ingestMansfieldStakeActuals(): Promise<{ written: number; skipped: number; errors: string[] }> {
  const db = getServiceDb();
  const { data, error } = await db.from("resorts").select("*").not("ghcnd_station_id", "is", null);
  if (error) throw error;
  const resorts = (data ?? []) as Resort[];

  let written = 0;
  let skipped = 0;
  const errors: string[] = [];
  const today = new Date();
  const endDate = today.toISOString().slice(0, 10);
  const beginDate = new Date(today.getTime() - MANSFIELD_ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  for (const resort of resorts) {
    const result = await backfillMansfieldStakeForResort(resort, beginDate, endDate);
    written += result.written;
    if (result.skipped) skipped += 1;
    if (result.error) errors.push(`${resort.slug}: ${result.error}`);
  }

  return { written, skipped, errors };
}
