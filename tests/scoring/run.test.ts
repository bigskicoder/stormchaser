import { describe, expect, it } from "vitest";
import { nextNDates, shadowCalibrationMultiplier } from "@/lib/scoring/run";
import type { ModelVersion, Resort } from "@/lib/db/types";

describe("nextNDates", () => {
  it("starts from the resort's LOCAL today, not UTC today", () => {
    // 6pm Mountain time on Jan 14 is already 1am UTC Jan 15 — the bug this
    // fixes would have started the list at Jan 15 instead of Jan 14.
    const now = new Date("2026-01-15T01:00:00Z"); // 6pm MST Jan 14
    const dates = nextNDates(5, "America/Denver", now);
    expect(dates[0]).toBe("2026-01-14");
    expect(dates).toEqual(["2026-01-14", "2026-01-15", "2026-01-16", "2026-01-17", "2026-01-18"]);
  });

  it("agrees with UTC when the instant is well within the same local and UTC day", () => {
    const now = new Date("2026-01-14T18:00:00Z"); // 11am MST Jan 14 — same calendar date either way
    const dates = nextNDates(3, "America/Denver", now);
    expect(dates).toEqual(["2026-01-14", "2026-01-15", "2026-01-16"]);
  });

  it("produces different lists for resorts in different timezones at the same instant", () => {
    // 6am UTC Jan 15 = 1am EST Jan 15 (already tomorrow locally) = 10pm PST Jan 14 (still today locally).
    const now = new Date("2026-01-15T06:00:00Z");
    const eastern = nextNDates(1, "America/New_York", now);
    const pacific = nextNDates(1, "America/Los_Angeles", now);
    expect(eastern[0]).toBe("2026-01-15");
    expect(pacific[0]).toBe("2026-01-14");
  });
});

function resort(overrides: Partial<Resort> = {}): Resort {
  return {
    id: "resort-1",
    slug: "test-resort",
    name: "Test Resort",
    pass_affiliation: "ikon",
    state: "UT",
    lat: 40,
    lng: -111,
    elevation_base_m: 2000,
    elevation_mid_m: 2500,
    elevation_summit_m: 3000,
    elevation_checked_at: null,
    elevation_check_flag: false,
    elevation_check_notes: null,
    timezone: "America/Denver",
    slr_calibration_multiplier: 1.0,
    snotel_station_triplet: null,
    snotel_station_distance_km: null,
    snotel_resolved_at: null,
    nws_grid_id: null,
    nws_grid_x: null,
    nws_grid_y: null,
    nws_resolved_at: null,
    ghcnd_station_id: null,
    webcam_url: null,
    active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function modelVersion(overrides: Partial<ModelVersion> = {}): ModelVersion {
  return {
    id: "version-1",
    name: "Test version",
    description: null,
    status: "draft",
    model_weights_by_bucket: {},
    model_disagreement_threshold: 0.4,
    ensemble_confidence_thresholds: { HIGH_MIN: 0.7, MEDIUM_MIN: 0.4 },
    ensemble_spread_normalization_ceiling_mm: 25,
    slr_strategy_name: "kuchera",
    powder_score_weights: { SNOWFALL: 0.5, CONFIDENCE: 0.35, LEAD_TIME_FIT: 0.15 },
    confidence_weight_by_label: { high: 1.0, medium: 0.6, low: 0.3 },
    actionable_window_hours: { min: 24, max: 96 },
    lead_time_fit_decay_per_hour: 0.01,
    resort_slr_multipliers: {},
    resort_scoring_overrides: {},
    parent_version_id: null,
    created_by: "test",
    activated_by: null,
    activated_at: null,
    is_shadow: false,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("shadowCalibrationMultiplier", () => {
  it("uses the shadow version's own snapshot value when the resort is present in it", () => {
    const shadow = modelVersion({ resort_slr_multipliers: { "resort-1": 1.15 } });
    expect(shadowCalibrationMultiplier(shadow, resort({ slr_calibration_multiplier: 1.0 }))).toBe(1.15);
  });

  it("falls back to the resort's live multiplier when it's absent from the shadow's snapshot — same as activateModelVersion's own semantics", () => {
    const shadow = modelVersion({ resort_slr_multipliers: { "some-other-resort": 1.3 } });
    expect(shadowCalibrationMultiplier(shadow, resort({ id: "resort-1", slr_calibration_multiplier: 1.08 }))).toBe(1.08);
  });

  it("falls back to the live multiplier when the shadow's snapshot is empty", () => {
    const shadow = modelVersion({ resort_slr_multipliers: {} });
    expect(shadowCalibrationMultiplier(shadow, resort({ slr_calibration_multiplier: 0.95 }))).toBe(0.95);
  });
});
