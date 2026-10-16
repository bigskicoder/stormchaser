/**
 * Pure correlation logic for the Mount Mansfield stake / ENSO research
 * (ROADMAP, requested directly: "pay particular attention to ENSO
 * behavior around the stake as well"). Run via
 * scripts/analyze-mansfield-enso.ts against the real snotel_actuals rows
 * lib/ingestion/mansfield-stake.ts backfills — no network/DB access here,
 * same "pure function, thin script wrapper" split as the rest of this
 * codebase's analysis/backtest code.
 *
 * Uses a Jul 1 - Jun 30 "snow year" convention, labeled by the ending
 * year (e.g. the 1982-83 winter is season "1983") — matches
 * lib/config/enso-winters.ts's season labels and keeps a full
 * accumulation-through-melt cycle in one bucket, consistent with the
 * stake's own documented peak timing (mid-to-late March).
 */

import { ENSO_WINTERS, type EnsoPhase, type EnsoStrength } from "@/lib/config/enso-winters";

/** Which Jul-Jun "snow year" a calendar date falls in, labeled by the year the season ends. Exported for unit testing. */
export function winterSeasonLabel(dateIso: string): string {
  const year = Number(dateIso.slice(0, 4));
  const month = Number(dateIso.slice(5, 7));
  return month >= 7 ? String(year + 1) : String(year);
}

export interface SeasonalSnowfallTotal {
  season: string;
  totalNewSnowIn: number;
  /** How many days in this season actually had a computed depth change — low coverage (e.g. a season only partially backfilled) should be weighed accordingly, not treated as equally reliable as a fully-covered season. */
  daysWithData: number;
}

/**
 * Sums observed_depth_change_in (new-snow proxy, already clamped >= 0 by
 * computeDepthChangeSeries) per winter season. Null entries (no previous
 * reading to diff against — the first day of a series, or after a gap)
 * are skipped, not treated as zero, so daysWithData reflects genuine
 * coverage. Exported for unit testing.
 */
export function aggregateSeasonalSnowfall(
  rows: Array<{ date: string; changeIn: number | null }>
): SeasonalSnowfallTotal[] {
  const bySeasonMap = new Map<string, { total: number; daysWithData: number }>();
  for (const row of rows) {
    if (row.changeIn == null) continue;
    const season = winterSeasonLabel(row.date);
    const entry = bySeasonMap.get(season) ?? { total: 0, daysWithData: 0 };
    entry.total += row.changeIn;
    entry.daysWithData += 1;
    bySeasonMap.set(season, entry);
  }
  return Array.from(bySeasonMap.entries())
    .map(([season, { total, daysWithData }]) => ({ season, totalNewSnowIn: total, daysWithData }))
    .sort((a, b) => a.season.localeCompare(b.season));
}

export interface EnsoCategorySummary {
  phase: EnsoPhase;
  strength: EnsoStrength;
  /** Classified seasons (lib/config/enso-winters.ts) that DO have matching Mansfield data. */
  matchedSeasons: SeasonalSnowfallTotal[];
  /** Classified seasons with no matching Mansfield data yet — too early for the backfill to cover, or the backfill hasn't run. Reported explicitly rather than silently dropped, so a thin category reads as "no data" and not as "zero snowfall." */
  unmatchedSeasons: string[];
  meanNewSnowIn: number | null;
  minNewSnowIn: number | null;
  maxNewSnowIn: number | null;
}

/**
 * Groups ENSO_WINTERS by (phase, strength) and joins each winter against
 * its matching seasonal total, if any. Deliberately does NOT compute a
 * "neutral/baseline" comparison — this session's ENSO_WINTERS table only
 * covers a handful of flagged strong/very-strong extremes (see that
 * file's header), not a full classification of every season, so there's
 * no principled way to know which unlisted seasons were actually neutral
 * versus an unclassified weak/moderate event. Exported for unit testing.
 */
export function summarizeByEnsoCategory(seasonalTotals: SeasonalSnowfallTotal[]): EnsoCategorySummary[] {
  const totalsBySeason = new Map(seasonalTotals.map((t) => [t.season, t]));
  const byCategory = new Map<string, typeof ENSO_WINTERS>();
  for (const w of ENSO_WINTERS) {
    const key = `${w.phase}:${w.strength}`;
    const list = byCategory.get(key) ?? [];
    list.push(w);
    byCategory.set(key, list);
  }

  const summaries: EnsoCategorySummary[] = [];
  for (const winters of byCategory.values()) {
    const matchedSeasons: SeasonalSnowfallTotal[] = [];
    const unmatchedSeasons: string[] = [];
    for (const w of winters) {
      const match = totalsBySeason.get(w.season);
      if (match) matchedSeasons.push(match);
      else unmatchedSeasons.push(w.season);
    }
    const values = matchedSeasons.map((m) => m.totalNewSnowIn);
    summaries.push({
      phase: winters[0]!.phase,
      strength: winters[0]!.strength,
      matchedSeasons,
      unmatchedSeasons,
      meanNewSnowIn: values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null,
      minNewSnowIn: values.length > 0 ? Math.min(...values) : null,
      maxNewSnowIn: values.length > 0 ? Math.max(...values) : null,
    });
  }
  return summaries.sort((a, b) => `${a.phase}${a.strength}`.localeCompare(`${b.phase}${b.strength}`));
}
