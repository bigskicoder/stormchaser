/**
 * Shapes the homepage leaderboard (UI option A, picked by Nick 2026-10-18)
 * from the same rows the old card grid used. Pure functions only, so the
 * ranking and windowing are unit-testable without Supabase.
 *
 * Every number shown comes straight from snow_scores / snotel_actuals. A
 * day with no score is null and renders as "no data", never as 0".
 */

import { RESORT_REGIONS, type ClimateRegion } from "@/lib/config/resort-regions";
import type { ConfidenceLabel, PassAffiliation, SnotelActual, SnowScore } from "@/lib/db/types";
import { addCalendarDays } from "@/lib/utils/timezone";

/** Days in the leaderboard's forecast strip: today plus the next four. */
export const LEADERBOARD_DAYS = 5;

/** Snowfall at which a day's bar turns from "some snow" to "powder" (OpenSnow's 6" convention). */
export const POWDER_DAY_IN = 6;

/** Wind-hold probability at which the row shows the wind icon. Matches WindHoldBadge's "likely" tier. */
export const WIND_HOLD_LIKELY = 0.5;

/** NWS's "measurable precipitation" threshold, 0.01 in, in mm. */
export const MEASURABLE_PRECIP_MM = 0.25;

/**
 * Whether a scored day should read as rain. The scorer's is_rain_case is a
 * temperature verdict (too warm for snow) and is set on dry days too, so
 * the first live leaderboard (2026-10-18) labeled whole dry weeks "rain".
 * Rain needs both: too warm, and measurable precipitation.
 */
export function rainExpected(s: Pick<SnowScore, "is_rain_case" | "reconciled_swe_mm">): boolean {
  return s.is_rain_case && (s.reconciled_swe_mm ?? 0) >= MEASURABLE_PRECIP_MM;
}

export type LeaderboardWindow = 1 | 3 | 5;

export type RegionKey = ClimateRegion | "other";

export const REGION_LABELS: Record<RegionKey, string> = {
  "pacific-maritime": "West Coast ranges",
  "interior-west": "Utah, Idaho & Taos",
  "continental-rockies": "Colorado, Wyoming & Montana",
  "northeast-coastal": "Northeast & Mid-Atlantic",
  "midwest-great-lakes": "Midwest",
  other: "Other",
};

export interface LeaderboardDay {
  date: string;
  /** Short weekday ("Sat"), from the resort's local calendar date. */
  weekday: string;
  /** Forecast snowfall in inches; 0 on a rain day; null when there's no score for the day. */
  snowIn: number | null;
  isRain: boolean;
  /** 0-100, null when there's no score. */
  score: number | null;
  confidence: ConfidenceLabel | null;
  windHoldProbability: number | null;
}

export interface LeaderboardRow {
  id: string;
  slug: string;
  name: string;
  state: string | null;
  pass: PassAffiliation;
  region: RegionKey;
  lat: number;
  lng: number;
  days: LeaderboardDay[];
  /** Observed snowfall over the past 7 days, inches; null when the resort has no station or no readings. */
  pastWeekIn: number | null;
}

export interface WindowSummary {
  /** Best day's score in the window, 0-100; null when no day in the window has a score. */
  score: number | null;
  bestDay: LeaderboardDay | null;
  /** Sum of forecast snowfall over the window's scored days; null when none are scored. */
  totalIn: number | null;
  windHoldLikely: boolean;
}

export function weekdayLabel(dateIso: string): string {
  return new Date(`${dateIso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

export function buildLeaderboardRow(params: {
  resort: {
    id: string;
    slug: string;
    name: string;
    state: string | null;
    pass_affiliation: PassAffiliation;
    lat: number;
    lng: number;
  };
  todayIso: string;
  /** Latest primary score per target_date (getUpcomingScoresForResort's output). */
  scores: SnowScore[];
  pastWeek: Pick<SnotelActual, "date" | "observed_depth_change_in">[];
}): LeaderboardRow {
  const { resort, todayIso, scores, pastWeek } = params;
  const byDate = new Map(scores.map((s) => [s.target_date, s]));

  const days: LeaderboardDay[] = [];
  for (let i = 0; i < LEADERBOARD_DAYS; i++) {
    const date = addCalendarDays(todayIso, i);
    const s = byDate.get(date);
    days.push({
      date,
      weekday: weekdayLabel(date),
      snowIn: s ? (s.is_rain_case ? 0 : s.estimated_snowfall_in) : null,
      isRain: s ? rainExpected(s) : false,
      score: s ? Math.round(s.powder_score * 100) : null,
      confidence: s?.confidence_label ?? null,
      windHoldProbability: s?.wind_hold_probability ?? null,
    });
  }

  // Depth change can be negative (settling/melt); only new snow counts
  // toward "fell this week". No readings at all stays null, not 0.
  const readings = pastWeek.map((r) => r.observed_depth_change_in).filter((v): v is number => v != null);
  const pastWeekIn = readings.length > 0 ? readings.reduce((sum, v) => sum + Math.max(0, v), 0) : null;

  return {
    id: resort.id,
    slug: resort.slug,
    name: resort.name,
    state: resort.state,
    pass: resort.pass_affiliation,
    region: RESORT_REGIONS[resort.slug] ?? "other",
    lat: resort.lat,
    lng: resort.lng,
    days,
    pastWeekIn,
  };
}

export function summarizeWindow(row: LeaderboardRow, windowDays: LeaderboardWindow): WindowSummary {
  const days = row.days.slice(0, windowDays);
  const scored = days.filter((d) => d.score != null);
  if (scored.length === 0) return { score: null, bestDay: null, totalIn: null, windHoldLikely: false };
  const bestDay = scored.reduce((best, d) => (d.score! > best.score! ? d : best));
  return {
    score: bestDay.score,
    bestDay,
    totalIn: scored.reduce((sum, d) => sum + (d.snowIn ?? 0), 0),
    windHoldLikely: days.some((d) => (d.windHoldProbability ?? 0) >= WIND_HOLD_LIKELY),
  };
}

/** Highest score first, then most snow, then name. Unscored resorts sink to the bottom. */
export function rankRows(
  rows: LeaderboardRow[],
  windowDays: LeaderboardWindow
): { row: LeaderboardRow; summary: WindowSummary }[] {
  return rows
    .map((row) => ({ row, summary: summarizeWindow(row, windowDays) }))
    .sort((a, b) => {
      const sa = a.summary.score ?? -1;
      const sb = b.summary.score ?? -1;
      if (sb !== sa) return sb - sa;
      const ta = a.summary.totalIn ?? -1;
      const tb = b.summary.totalIn ?? -1;
      if (tb !== ta) return tb - ta;
      return a.row.name.localeCompare(b.row.name);
    });
}
