import { describe, expect, it } from "vitest";
import type { SnowScore } from "@/lib/db/types";
import { buildLeaderboardRow, rankRows, summarizeWindow } from "@/lib/public/leaderboard";

const resort = (slug: string, name = slug) => ({
  id: slug,
  slug,
  name,
  state: "UT",
  pass_affiliation: "ikon" as const,
  lat: 40.6,
  lng: -111.6,
});

function score(date: string, powder: number, snow: number, extra: Partial<SnowScore> = {}): SnowScore {
  return {
    target_date: date,
    powder_score: powder,
    estimated_snowfall_in: snow,
    is_rain_case: false,
    snow_fraction: null,
    phase_change: null,
    phase_change_at: null,
    confidence_label: "high",
    wind_hold_probability: 0.1,
    ...extra,
  } as SnowScore;
}

describe("buildLeaderboardRow", () => {
  it("lays out five days from today, leaving unscored days null instead of zero", () => {
    const row = buildLeaderboardRow({
      resort: resort("alta"),
      todayIso: "2026-12-05",
      scores: [score("2026-12-05", 0.4, 2), score("2026-12-07", 0.9, 14)],
      pastWeek: [],
    });
    expect(row.days.map((d) => d.date)).toEqual(["2026-12-05", "2026-12-06", "2026-12-07", "2026-12-08", "2026-12-09"]);
    expect(row.days[1]!.snowIn).toBeNull();
    expect(row.days[2]).toMatchObject({ snowIn: 14, score: 90, weekday: "Mon" });
    expect(row.region).toBe("interior-west");
  });

  it("shows rain as 0 inches flagged as rain", () => {
    const row = buildLeaderboardRow({
      resort: resort("alta"),
      todayIso: "2026-12-05",
      scores: [score("2026-12-05", 0.2, 3, { is_rain_case: true, reconciled_swe_mm: 8 })],
      pastWeek: [],
    });
    expect(row.days[0]).toMatchObject({ snowIn: 0, isRain: true });
  });

  it("does not call a warm dry day rain", () => {
    const row = buildLeaderboardRow({
      resort: resort("palisades-tahoe"),
      todayIso: "2026-10-18",
      scores: [score("2026-10-18", 0.5, 0, { is_rain_case: true, reconciled_swe_mm: 0 })],
      pastWeek: [],
    });
    expect(row.days[0]).toMatchObject({ snowIn: 0, isRain: false });
  });

  it("sums only new snow for the past week, and stays null with no readings", () => {
    const base = { resort: resort("alta"), todayIso: "2026-12-05", scores: [] };
    expect(
      buildLeaderboardRow({
        ...base,
        pastWeek: [
          { date: "2026-12-01", observed_depth_change_in: 5 },
          { date: "2026-12-02", observed_depth_change_in: -2 },
          { date: "2026-12-03", observed_depth_change_in: null },
        ],
      }).pastWeekIn
    ).toBe(5);
    expect(buildLeaderboardRow({ ...base, pastWeek: [] }).pastWeekIn).toBeNull();
  });
});

describe("summarizeWindow and rankRows", () => {
  const today = "2026-12-05";
  const a = buildLeaderboardRow({ resort: resort("a", "A"), todayIso: today, scores: [score(today, 0.3, 1), score("2026-12-07", 0.95, 18, { wind_hold_probability: 0.6 })], pastWeek: [] });
  const b = buildLeaderboardRow({ resort: resort("b", "B"), todayIso: today, scores: [score(today, 0.6, 5)], pastWeek: [] });
  const c = buildLeaderboardRow({ resort: resort("c", "C"), todayIso: today, scores: [], pastWeek: [] });

  it("uses the best day inside the window only", () => {
    expect(summarizeWindow(a, 1)).toMatchObject({ score: 30, totalIn: 1, windHoldLikely: false });
    expect(summarizeWindow(a, 5)).toMatchObject({ score: 95, totalIn: 19, windHoldLikely: true });
    expect(summarizeWindow(c, 5)).toMatchObject({ score: null, totalIn: null, bestDay: null });
  });

  it("ranks by score for the chosen window, unscored last", () => {
    expect(rankRows([c, b, a], 5).map((r) => r.row.slug)).toEqual(["a", "b", "c"]);
    expect(rankRows([c, b, a], 1).map((r) => r.row.slug)).toEqual(["b", "a", "c"]);
  });
});

describe("mixedPrecip and changeoverText", () => {
  it("calls a mostly-snow day with real rain mixed, and ignores a sliver of rain", async () => {
    const { mixedPrecip } = await import("@/lib/public/leaderboard");
    expect(mixedPrecip({ is_rain_case: false, reconciled_swe_mm: 10, snow_fraction: 0.6 })).toBe(true);
    expect(mixedPrecip({ is_rain_case: false, reconciled_swe_mm: 10, snow_fraction: 0.95 })).toBe(false);
    expect(mixedPrecip({ is_rain_case: true, reconciled_swe_mm: 10, snow_fraction: 0 })).toBe(false);
    expect(mixedPrecip({ is_rain_case: false, reconciled_swe_mm: 10, snow_fraction: null })).toBe(false);
  });

  it("says the changeover in the resort's own time", async () => {
    const { changeoverText } = await import("@/lib/public/leaderboard");
    expect(changeoverText({ phase_change: "rain_to_snow", phase_change_at: "2026-12-05T22:00:00.000Z" }, "America/Denver")).toBe(
      "rain turning to snow around 3 PM"
    );
    expect(changeoverText({ phase_change: null, phase_change_at: null }, "America/Denver")).toBeNull();
  });
});
