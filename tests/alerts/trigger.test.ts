import { describe, expect, it } from "vitest";
import { selectCurrentBestQualifyingScore } from "@/lib/alerts/trigger";
import type { SnowScore } from "@/lib/db/types";

function fixture(overrides: Partial<SnowScore>): SnowScore {
  return {
    id: "id",
    resort_id: "resort",
    target_date: "2026-01-15",
    computed_at: "2026-01-14T12:00:00Z",
    reconciled_swe_mm: 10,
    disagreement_flag: false,
    model_agreement_score: 0.9,
    ensemble_spread_score: 0.9,
    confidence_label: "high",
    slr_strategy: "kuchera",
    snow_to_liquid_ratio: 12,
    is_rain_case: false,
    estimated_snowfall_in: 10,
    normalized_snowfall: 0.8,
    lead_time_hours: 24,
    lead_time_fit: 1,
    powder_score: 0.8,
    avg_temp_c: null,
    avg_wind_speed_kmh: null,
    max_wind_gust_kmh: null,
    avg_cloud_cover_pct: null,
    wind_hold_probability: null,
    created_at: "2026-01-14T12:00:00Z",
    ...overrides,
  };
}

describe("selectCurrentBestQualifyingScore", () => {
  it("does not resurrect a stale high score for a date that has already passed", () => {
    // This reproduces the exact bug: a huge storm scored 0.95 for a date
    // that's now in the past. Today is 2026-03-01; the old row must be
    // excluded purely by its target_date, regardless of how high it scored.
    const scores = [fixture({ target_date: "2026-01-10", computed_at: "2026-01-08T00:00:00Z", powder_score: 0.95 })];
    expect(selectCurrentBestQualifyingScore(scores, "2026-03-01", 0.7)).toBeNull();
  });

  it("prefers the LATEST computed_at for a target_date over an older, higher-scoring one", () => {
    // Same target_date, two computations: an early optimistic 0.9 and a
    // later, more accurate 0.3 as the storm's forecast weakened. The old
    // 0.9 must not win just because it's numerically higher.
    const scores = [
      fixture({ target_date: "2026-01-20", computed_at: "2026-01-15T00:00:00Z", powder_score: 0.9 }),
      fixture({ target_date: "2026-01-20", computed_at: "2026-01-19T00:00:00Z", powder_score: 0.3 }),
    ];
    const result = selectCurrentBestQualifyingScore(scores, "2026-01-16", 0.7);
    // The latest assessment (0.3) is below threshold, so nothing qualifies
    // even though an older row for the same date was once above it.
    expect(result).toBeNull();
  });

  it("still fires when the latest assessment for a date genuinely qualifies", () => {
    const scores = [
      fixture({ target_date: "2026-01-20", computed_at: "2026-01-15T00:00:00Z", powder_score: 0.3 }),
      fixture({ target_date: "2026-01-20", computed_at: "2026-01-19T00:00:00Z", powder_score: 0.9 }),
    ];
    const result = selectCurrentBestQualifyingScore(scores, "2026-01-16", 0.7);
    expect(result?.powder_score).toBe(0.9);
    expect(result?.computed_at).toBe("2026-01-19T00:00:00Z");
  });

  it("picks the highest-scoring among multiple distinct upcoming dates' latest assessments", () => {
    const scores = [
      fixture({ target_date: "2026-01-16", computed_at: "2026-01-15T06:00:00Z", powder_score: 0.75 }),
      fixture({ target_date: "2026-01-17", computed_at: "2026-01-15T06:00:00Z", powder_score: 0.85 }),
      fixture({ target_date: "2026-01-18", computed_at: "2026-01-15T06:00:00Z", powder_score: 0.6 }),
    ];
    const result = selectCurrentBestQualifyingScore(scores, "2026-01-15", 0.7);
    expect(result?.target_date).toBe("2026-01-17");
  });

  it("returns null when no upcoming date qualifies", () => {
    const scores = [fixture({ target_date: "2026-01-16", powder_score: 0.5 })];
    expect(selectCurrentBestQualifyingScore(scores, "2026-01-15", 0.7)).toBeNull();
  });

  it("returns null for an empty input", () => {
    expect(selectCurrentBestQualifyingScore([], "2026-01-15", 0.7)).toBeNull();
  });

  it("includes today's date itself, not just strictly future dates", () => {
    const scores = [fixture({ target_date: "2026-01-15", powder_score: 0.9 })];
    expect(selectCurrentBestQualifyingScore(scores, "2026-01-15", 0.7)?.powder_score).toBe(0.9);
  });
});
