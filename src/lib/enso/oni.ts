/**
 * NOAA Oceanic Nino Index (ONI) and the ENSO phase of each winter
 * (ROADMAP Phase B.6). Replaces the hand-picked strong-winter list in
 * lib/config/enso-winters.ts for calibration: that table only covers a
 * few winters, while ONI covers every season since 1950.
 *
 * Phase rule (a documented simplification of CPC's own, which needs five
 * consecutive overlapping seasons past the threshold): a winter is El Nino
 * if its DJF ONI is >= +0.5 C, La Nina if <= -0.5 C, otherwise neutral.
 * DJF is the peak-snow season for every resort here and the season CPC's
 * own strength labels are usually quoted for. For the current winter,
 * before NOAA has published its DJF value, the most recent published
 * season stands in, which is what CPC's own advisories describe.
 */

import { getServiceDb } from "@/lib/db/client";
import { upsertInBatches } from "@/lib/db/batch-upsert";

export const ONI_URL = process.env.NOAA_ONI_URL ?? "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt";
export const ENSO_PHASE_THRESHOLD_C = 0.5;

export const ONI_SEASONS = ["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"] as const;
export type OniSeason = (typeof ONI_SEASONS)[number];
export type EnsoPhase = "el_nino" | "la_nina" | "neutral";
/** Phases that can carry their own SLR multiplier; neutral always uses the base one. */
export const ENSO_ADJUSTABLE_PHASES = ["el_nino", "la_nina"] as const;
export type EnsoAdjustablePhase = (typeof ENSO_ADJUSTABLE_PHASES)[number];

export interface OniRow {
  year: number;
  season: OniSeason;
  anomaly_c: number;
}

/**
 * Parses oni.ascii.txt: a header line, then whitespace-separated
 * "SEAS YR TOTAL ANOM" rows, e.g. "DJF 1950 24.72 -1.53". YR is the year
 * the season's middle month falls in, so DJF 2026 is Dec 2025-Feb 2026.
 * Lines that don't match are skipped rather than guessed at.
 */
export function parseOniText(text: string): OniRow[] {
  const rows: OniRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const [season, yr, , anom] = parts;
    if (!(ONI_SEASONS as readonly string[]).includes(season!)) continue;
    const year = Number(yr);
    const anomaly = Number(anom);
    if (!Number.isInteger(year) || !Number.isFinite(anomaly)) continue;
    rows.push({ year, season: season as OniSeason, anomaly_c: anomaly });
  }
  return rows;
}

/** Downloads the latest ONI table from NOAA and upserts it. */
export async function refreshEnsoOni(): Promise<{ rows: number }> {
  const res = await fetch(ONI_URL);
  if (!res.ok) throw new Error(`NOAA ONI download failed (${res.status})`);
  const rows = parseOniText(await res.text());
  if (rows.length === 0) throw new Error("NOAA ONI file had no rows in the expected format");
  const written = await upsertInBatches(
    getServiceDb(),
    "enso_oni",
    rows.map((r) => ({ ...r, fetched_at: new Date().toISOString() })),
    "year,season"
  );
  return { rows: written };
}

export async function loadEnsoOni(): Promise<OniRow[]> {
  const db = getServiceDb();
  const { data, error } = await db.from("enso_oni").select("year, season, anomaly_c").order("year").range(0, 4999);
  if (error) throw error;
  return (data ?? []).map((r) => ({ year: r.year as number, season: r.season as OniSeason, anomaly_c: Number(r.anomaly_c) }));
}

export function phaseFromAnomaly(anomalyC: number): EnsoPhase {
  if (anomalyC >= ENSO_PHASE_THRESHOLD_C) return "el_nino";
  if (anomalyC <= -ENSO_PHASE_THRESHOLD_C) return "la_nina";
  return "neutral";
}

/** Winters run July-June: a date in Jan 2026 and one in Nov 2025 are both the winter whose DJF is 2026. */
export function djfYearForDate(dateIso: string): number {
  const year = Number(dateIso.slice(0, 4));
  const month = Number(dateIso.slice(5, 7));
  return month >= 7 ? year + 1 : year;
}

/**
 * Looks up ENSO phases from an already-loaded ONI table. Returns null for a
 * date with no ONI coverage at all (before 1950, or an empty table), so
 * callers treat it as "unknown" rather than silently calling it neutral.
 */
export class EnsoPhaseLookup {
  private readonly djf = new Map<number, number>();
  private readonly ordered: Array<{ key: number; anomaly: number }>;

  constructor(rows: OniRow[]) {
    for (const r of rows) if (r.season === "DJF") this.djf.set(r.year, r.anomaly_c);
    this.ordered = rows
      .map((r) => ({ key: r.year * 12 + ONI_SEASONS.indexOf(r.season), anomaly: r.anomaly_c }))
      .sort((a, b) => a.key - b.key);
  }

  phaseForDate(dateIso: string): EnsoPhase | null {
    const djfYear = djfYearForDate(dateIso);
    const djf = this.djf.get(djfYear);
    if (djf != null) return phaseFromAnomaly(djf);
    // Current winter, DJF not published yet: latest season at or before this date.
    // A season is keyed by its middle month (DJF = Jan), so the one centred on the previous month is the newest that can exist.
    const year = Number(dateIso.slice(0, 4));
    const month = Number(dateIso.slice(5, 7));
    const limit = year * 12 + (month - 2);
    let latest: { key: number; anomaly: number } | null = null;
    for (const r of this.ordered) {
      if (r.key > limit) break;
      latest = r;
    }
    // Only stand in for the winter being asked about, not across a long gap in the data.
    if (!latest || limit - latest.key > 12) return null;
    return phaseFromAnomaly(latest.anomaly);
  }
}

let cachedLookup: Promise<EnsoPhaseLookup> | null = null;

/**
 * The ONI table loaded once per process. If it can't be read, every date
 * comes back phase-unknown and callers use the base multiplier, i.e.
 * exactly the pre-ENSO behavior, rather than failing a scoring run.
 */
export function getEnsoPhaseLookup(): Promise<EnsoPhaseLookup> {
  cachedLookup ??= loadEnsoOni()
    .then((rows) => new EnsoPhaseLookup(rows))
    .catch(() => {
      cachedLookup = null;
      return new EnsoPhaseLookup([]);
    });
  return cachedLookup;
}

/** Drops the cached table, e.g. right after refreshEnsoOni() in the same process. */
export function resetEnsoPhaseLookupCache(): void {
  cachedLookup = null;
}
