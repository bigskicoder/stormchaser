/**
 * Builds the resort detail page's unified "past week + today + next 5 days"
 * snowfall bar-chart data from two different sources — observed SNOTEL
 * depth deltas for the past (lib/ingestion/snotel.ts) and our own
 * reconciled forecast for today/upcoming (snow_scores) — into one array the
 * chart component can render without knowing where any given bar's number
 * came from. Pure function, no DB access, so it's unit-testable without
 * fixture plumbing through Supabase.
 */

import type { SnotelActual, SnowScore } from "@/lib/db/types";
import { addCalendarDays } from "@/lib/utils/timezone";

export type SnowfallBarKind = "actual" | "today" | "predicted";

export interface SnowfallBar {
  date: string;
  kind: SnowfallBarKind;
  valueIn: number | null;
}

const PAST_DAYS_SHOWN = 7;
const FUTURE_DAYS_SHOWN = 5;

export function buildSnowfallTimeline(params: {
  todayIso: string;
  pastWeek: SnotelActual[];
  upcoming: SnowScore[];
}): SnowfallBar[] {
  const { todayIso, pastWeek, upcoming } = params;

  const actualByDate = new Map(pastWeek.map((row) => [row.date, row.observed_depth_change_in]));
  const scoreByDate = new Map(upcoming.map((row) => [row.target_date, row]));

  const bars: SnowfallBar[] = [];

  for (let i = PAST_DAYS_SHOWN; i >= 1; i--) {
    const date = addCalendarDays(todayIso, -i);
    bars.push({ date, kind: "actual", valueIn: actualByDate.get(date) ?? null });
  }

  const todayScore = scoreByDate.get(todayIso);
  const todayActual = actualByDate.get(todayIso);
  bars.push({
    date: todayIso,
    kind: "today",
    valueIn: todayActual ?? (todayScore ? (todayScore.is_rain_case ? 0 : todayScore.estimated_snowfall_in) : null),
  });

  for (let i = 1; i <= FUTURE_DAYS_SHOWN; i++) {
    const date = addCalendarDays(todayIso, i);
    const score = scoreByDate.get(date);
    bars.push({ date, kind: "predicted", valueIn: score ? (score.is_rain_case ? 0 : score.estimated_snowfall_in) : null });
  }

  return bars;
}
