import { describe, expect, it } from "vitest";
import { computeScoreFromInputs } from "@/lib/scoring/run";
import type { ForecastPull } from "@/lib/db/types";

function row(overrides: Partial<ForecastPull>): ForecastPull {
  return {
    id: "x",
    resort_id: "r",
    model_name: "gfs",
    elevation_band: "mid",
    run_init_time: "2026-01-01T00:00:00Z",
    valid_time: "2026-01-01T00:00:00Z",
    pulled_at: "2026-01-01T00:00:00Z",
    raw_payload: {},
    swe_mm: 0,
    precip_mm: null,
    temp_c: -5,
    wind_speed_kmh: 10,
    wind_gust_kmh: 20,
    wind_dir_deg: 270,
    freezing_level_m: 1500,
    cloud_cover_pct: 80,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Hourly rows for a cold, snowy day: 10mm SWE/hour for 10 hours = 100mm total. */
function coldDayRows(model: ForecastPull["model_name"]): ForecastPull[] {
  return Array.from({ length: 10 }, (_, i) =>
    row({ model_name: model, valid_time: `2026-01-01T${String(i).padStart(2, "0")}:00:00Z`, swe_mm: 10, temp_c: -6 })
  );
}

describe("computeScoreFromInputs", () => {
  it("returns null when no models are available", () => {
    const result = computeScoreFromInputs({
      resortId: "r1",
      targetDate: "2026-01-15",
      leadTimeHours: 24,
      modelRuns: {},
      ensembleMemberTotals: [],
      slrCalibrationMultiplier: 1.0,
      seasonalMaxSnowfallIn: 24,
    });
    expect(result).toBeNull();
  });

  it("produces a sane cold-storm score from a single model within the T0_48 bucket", () => {
    // hrrr is in the T0_48 weight table (section 5.1).
    const result = computeScoreFromInputs({
      resortId: "r1",
      targetDate: "2026-01-15",
      leadTimeHours: 24,
      modelRuns: { hrrr: coldDayRows("hrrr") },
      ensembleMemberTotals: [],
      slrCalibrationMultiplier: 1.0,
      seasonalMaxSnowfallIn: 24,
    });
    expect(result).not.toBeNull();
    expect(result!.isRainCase).toBe(false);
    expect(result!.estimatedSnowfallIn).toBeGreaterThan(0);
    expect(result!.reconciledSweMm).toBeCloseTo(100, 0);
    expect(result!.powderScore).toBeGreaterThan(0);
    expect(result!.powderScore).toBeLessThanOrEqual(1);
  });

  it("treats a warm day as a rain case with zero estimated snowfall", () => {
    const warmRows = coldDayRows("hrrr").map((r) => ({ ...r, temp_c: 5 }));
    const result = computeScoreFromInputs({
      resortId: "r1",
      targetDate: "2026-01-15",
      leadTimeHours: 24,
      modelRuns: { hrrr: warmRows },
      ensembleMemberTotals: [],
      slrCalibrationMultiplier: 1.0,
      seasonalMaxSnowfallIn: 24,
    });
    expect(result!.isRainCase).toBe(true);
    expect(result!.estimatedSnowfallIn).toBe(0);
  });

  it("flags disagreement when models diverge sharply", () => {
    const result = computeScoreFromInputs({
      resortId: "r1",
      targetDate: "2026-01-15",
      leadTimeHours: 24,
      modelRuns: {
        hrrr: coldDayRows("hrrr"), // 100mm total
        gfs: coldDayRows("gfs").map((r) => ({ ...r, swe_mm: 2 })), // 20mm total — wildly different
      },
      ensembleMemberTotals: [],
      slrCalibrationMultiplier: 1.0,
      seasonalMaxSnowfallIn: 24,
    });
    expect(result!.disagreementFlag).toBe(true);
  });

  it("applies the SLR calibration multiplier to the estimated snowfall", () => {
    const base = computeScoreFromInputs({
      resortId: "r1",
      targetDate: "2026-01-15",
      leadTimeHours: 24,
      modelRuns: { hrrr: coldDayRows("hrrr") },
      ensembleMemberTotals: [],
      slrCalibrationMultiplier: 1.0,
      seasonalMaxSnowfallIn: 24,
    })!;
    const boosted = computeScoreFromInputs({
      resortId: "r1",
      targetDate: "2026-01-15",
      leadTimeHours: 24,
      modelRuns: { hrrr: coldDayRows("hrrr") },
      ensembleMemberTotals: [],
      slrCalibrationMultiplier: 1.2,
      seasonalMaxSnowfallIn: 24,
    })!;
    expect(boosted.estimatedSnowfallIn).toBeGreaterThan(base.estimatedSnowfallIn);
  });

  it("computes the display-only weather/wind summary fields from the model rows", () => {
    const result = computeScoreFromInputs({
      resortId: "r1",
      targetDate: "2026-01-15",
      leadTimeHours: 24,
      modelRuns: { hrrr: coldDayRows("hrrr") },
      ensembleMemberTotals: [],
      slrCalibrationMultiplier: 1.0,
      seasonalMaxSnowfallIn: 24,
    })!;
    expect(result.avgTempC).toBeCloseTo(-6, 5);
    expect(result.avgWindSpeedKmh).toBeCloseTo(10, 5);
    expect(result.maxWindGustKmh).toBeCloseTo(20, 5);
    expect(result.avgCloudCoverPct).toBeCloseTo(80, 5);
    expect(result.windHoldProbability).not.toBeNull();
  });

  it("treats an empty ensemble as having no meaningful spread signal, without throwing", () => {
    // Documented behavior (see ScoreInputs' own doc comment): an empty
    // ensemble doesn't crash, but the resulting confidence figure isn't a
    // real signal — callers that pass [] (the forecast-archive backtest,
    // which has no archived ensemble data) must not persist it as if it were.
    expect(() =>
      computeScoreFromInputs({
        resortId: "r1",
        targetDate: "2026-01-15",
        leadTimeHours: 24,
        modelRuns: { hrrr: coldDayRows("hrrr") },
        ensembleMemberTotals: [],
        slrCalibrationMultiplier: 1.0,
        seasonalMaxSnowfallIn: 24,
      })
    ).not.toThrow();
  });
});
