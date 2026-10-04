import { describe, expect, it } from "vitest";
import { buildSnowfallTimeline } from "@/lib/public/snowfall-timeline";
import type { SnotelActual, SnowScore } from "@/lib/db/types";

function actual(date: string, changeIn: number | null): SnotelActual {
  return {
    id: date,
    resort_id: "r",
    station_triplet: "x",
    date,
    observed_swe_mm: null,
    snow_depth_in: null,
    observed_depth_change_in: changeIn,
    pulled_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
  };
}

function score(targetDate: string, estimatedIn: number, isRainCase = false): SnowScore {
  return {
    id: targetDate,
    resort_id: "r",
    target_date: targetDate,
    computed_at: "2026-01-01T00:00:00Z",
    reconciled_swe_mm: 10,
    disagreement_flag: false,
    model_agreement_score: 0.9,
    ensemble_spread_score: 0.9,
    confidence_label: "high",
    slr_strategy: "kuchera",
    snow_to_liquid_ratio: 12,
    is_rain_case: isRainCase,
    estimated_snowfall_in: estimatedIn,
    normalized_snowfall: 0.5,
    lead_time_hours: 24,
    lead_time_fit: 1,
    powder_score: 0.5,
    avg_temp_c: null,
    avg_wind_speed_kmh: null,
    max_wind_gust_kmh: null,
    avg_cloud_cover_pct: null,
    wind_hold_probability: null,
    created_at: "2026-01-01T00:00:00Z",
  };
}

describe("buildSnowfallTimeline", () => {
  const todayIso = "2026-01-15";

  it("produces 13 bars: 7 past + today + 5 future, in chronological order", () => {
    const bars = buildSnowfallTimeline({ todayIso, pastWeek: [], upcoming: [] });
    expect(bars).toHaveLength(13);
    expect(bars[0]!.date).toBe("2026-01-08");
    expect(bars[6]!.date).toBe("2026-01-14");
    expect(bars[7]!.date).toBe("2026-01-15");
    expect(bars[7]!.kind).toBe("today");
    expect(bars[8]!.date).toBe("2026-01-16");
    expect(bars[12]!.date).toBe("2026-01-20");
  });

  it("marks past days as 'actual' and fills in observed values where present", () => {
    const bars = buildSnowfallTimeline({
      todayIso,
      pastWeek: [actual("2026-01-10", 3.5), actual("2026-01-12", 0)],
      upcoming: [],
    });
    const jan10 = bars.find((b) => b.date === "2026-01-10")!;
    const jan11 = bars.find((b) => b.date === "2026-01-11")!;
    expect(jan10.kind).toBe("actual");
    expect(jan10.valueIn).toBe(3.5);
    expect(jan11.valueIn).toBeNull();
  });

  it("marks future days as 'predicted' and uses the score's estimated snowfall", () => {
    const bars = buildSnowfallTimeline({
      todayIso,
      pastWeek: [],
      upcoming: [score("2026-01-17", 8.2)],
    });
    const jan17 = bars.find((b) => b.date === "2026-01-17")!;
    expect(jan17.kind).toBe("predicted");
    expect(jan17.valueIn).toBe(8.2);
  });

  it("treats a rain-case predicted day as 0 inches, not the raw estimate", () => {
    const bars = buildSnowfallTimeline({
      todayIso,
      pastWeek: [],
      upcoming: [score("2026-01-16", 5, true)],
    });
    expect(bars.find((b) => b.date === "2026-01-16")!.valueIn).toBe(0);
  });

  it("today's bar prefers an observed actual over a predicted score when both exist", () => {
    const bars = buildSnowfallTimeline({
      todayIso,
      pastWeek: [actual(todayIso, 2)],
      upcoming: [score(todayIso, 9)],
    });
    expect(bars.find((b) => b.date === todayIso)!.valueIn).toBe(2);
  });

  it("today's bar falls back to the predicted score when no actual is available yet", () => {
    const bars = buildSnowfallTimeline({
      todayIso,
      pastWeek: [],
      upcoming: [score(todayIso, 9)],
    });
    expect(bars.find((b) => b.date === todayIso)!.valueIn).toBe(9);
  });

  it("today's bar is null when neither an actual nor a score exists", () => {
    const bars = buildSnowfallTimeline({ todayIso, pastWeek: [], upcoming: [] });
    expect(bars.find((b) => b.date === todayIso)!.valueIn).toBeNull();
  });
});
