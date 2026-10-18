import { describe, expect, it } from "vitest";
import { computeScoreFromInputs } from "@/lib/scoring/run";
import { DEFAULT_SCORING_CONFIG } from "@/lib/scoring/config";
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
  it("scores a rain-to-snow day on its snow hours only, instead of all rain or all snow", () => {
    // 5 warm hours (rain) then 5 cold hours (snow), 10mm each hour. The old
    // whole-day temperature (precip-weighted mean, -0.5 C) would have called
    // all 100mm snow; now only the 50mm in the cold hours counts.
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ model_name: "hrrr", valid_time: `2026-01-01T${String(i).padStart(2, "0")}:00:00Z`, swe_mm: 10, temp_c: i < 5 ? 2 : -3 })
    );
    const result = computeScoreFromInputs({
      resortId: "r1",
      targetDate: "2026-01-15",
      leadTimeHours: 24,
      modelRuns: { hrrr: rows },
      ensembleMemberTotals: [],
      slrCalibrationMultiplier: 1.0,
      seasonalMaxSnowfallIn: 24,
    })!;
    expect(result.isRainCase).toBe(false);
    expect(result.snowFraction).toBeCloseTo(0.5);
    expect(result.phaseChange).toBe("rain_to_snow");
    expect(result.phaseChangeAt).toBe("2026-01-01T05:00:00Z");
    expect(result.estimatedSnowfallIn).toBeCloseTo((50 * result.snowToLiquidRatio) / 25.4);
  });

  it("still calls an all-warm wet day rain", () => {
    const rows = Array.from({ length: 4 }, (_, i) =>
      row({ model_name: "hrrr", valid_time: `2026-01-01T0${i}:00:00Z`, swe_mm: 5, temp_c: 3 })
    );
    const result = computeScoreFromInputs({
      resortId: "r1",
      targetDate: "2026-01-15",
      leadTimeHours: 24,
      modelRuns: { hrrr: rows },
      ensembleMemberTotals: [],
      slrCalibrationMultiplier: 1.0,
      seasonalMaxSnowfallIn: 24,
    })!;
    expect(result.isRainCase).toBe(true);
    expect(result.snowFraction).toBe(0);
    expect(result.estimatedSnowfallIn).toBe(0);
    expect(result.powderScore).toBe(0);
  });

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

  it("defaults modelVersionId to null when the input is omitted (pre-versioning / DEFAULT_SCORING_CONFIG fallback)", () => {
    const result = computeScoreFromInputs({
      resortId: "r1",
      targetDate: "2026-01-15",
      leadTimeHours: 24,
      modelRuns: { hrrr: coldDayRows("hrrr") },
      ensembleMemberTotals: [],
      slrCalibrationMultiplier: 1.0,
      seasonalMaxSnowfallIn: 24,
    })!;
    expect(result.modelVersionId).toBeNull();
  });

  it("echoes modelVersionId straight onto the result — pure bookkeeping, not read by the computation", () => {
    const result = computeScoreFromInputs({
      resortId: "r1",
      targetDate: "2026-01-15",
      leadTimeHours: 24,
      modelRuns: { hrrr: coldDayRows("hrrr") },
      ensembleMemberTotals: [],
      slrCalibrationMultiplier: 1.0,
      seasonalMaxSnowfallIn: 24,
      modelVersionId: "version-abc",
    })!;
    expect(result.modelVersionId).toBe("version-abc");
  });

  it("uses an explicit scoringConfig override instead of the compiled-in defaults", () => {
    const withDefaultStrategy = computeScoreFromInputs({
      resortId: "r1",
      targetDate: "2026-01-15",
      leadTimeHours: 24,
      modelRuns: { hrrr: coldDayRows("hrrr") },
      ensembleMemberTotals: [],
      slrCalibrationMultiplier: 1.0,
      seasonalMaxSnowfallIn: 24,
    })!;
    const withFixedRatio = computeScoreFromInputs({
      resortId: "r1",
      targetDate: "2026-01-15",
      leadTimeHours: 24,
      modelRuns: { hrrr: coldDayRows("hrrr") },
      ensembleMemberTotals: [],
      slrCalibrationMultiplier: 1.0,
      seasonalMaxSnowfallIn: 24,
      scoringConfig: { ...DEFAULT_SCORING_CONFIG, slrStrategyName: "fixed-ratio" },
    })!;
    expect(withDefaultStrategy.slrStrategy).toBe("kuchera");
    expect(withFixedRatio.slrStrategy).toBe("fixed-ratio");
    // Different SLR strategies produce different ratios for the same cold
    // storm, so this isn't a no-op override — the config actually flows
    // through to the computation, not just the label.
    expect(withFixedRatio.estimatedSnowfallIn).not.toBeCloseTo(withDefaultStrategy.estimatedSnowfallIn, 2);
  });

  it("kuchera-wind produces less snowfall than plain kuchera for the same windy, cold storm (wind threads through the full pipeline, not just the strategy's own unit tests)", () => {
    const windyRows = coldDayRows("hrrr").map((r) => ({ ...r, wind_speed_kmh: 70 }));
    const withKuchera = computeScoreFromInputs({
      resortId: "r1",
      targetDate: "2026-01-15",
      leadTimeHours: 24,
      modelRuns: { hrrr: windyRows },
      ensembleMemberTotals: [],
      slrCalibrationMultiplier: 1.0,
      seasonalMaxSnowfallIn: 24,
    })!;
    const withKucheraWind = computeScoreFromInputs({
      resortId: "r1",
      targetDate: "2026-01-15",
      leadTimeHours: 24,
      modelRuns: { hrrr: windyRows },
      ensembleMemberTotals: [],
      slrCalibrationMultiplier: 1.0,
      seasonalMaxSnowfallIn: 24,
      scoringConfig: { ...DEFAULT_SCORING_CONFIG, slrStrategyName: "kuchera-wind" },
    })!;
    expect(withKucheraWind.estimatedSnowfallIn).toBeLessThan(withKuchera.estimatedSnowfallIn);
    expect(withKucheraWind.slrStrategy).toBe("kuchera-wind");
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
