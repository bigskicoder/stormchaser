import { describe, expect, it } from "vitest";
import { computeCalibrationRecommendation, recencyWeight, welchT, type AccuracySample } from "@/lib/calibration/recommend";
import { CALIBRATION_MAX_STEP_FRACTION, CALIBRATION_MULTIPLIER_BOUNDS } from "@/lib/config/constants";

function samples(n: number, predictedIn: number, errorIn: number): AccuracySample[] {
  return Array.from({ length: n }, () => ({ predictedIn, errorIn }));
}

describe("computeCalibrationRecommendation", () => {
  it("is ineligible below the minimum sample size", () => {
    const result = computeCalibrationRecommendation(1.0, samples(5, 10, 2));
    expect(result.eligible).toBe(false);
    expect(result.recommendedMultiplier).toBe(1.0);
  });

  it("is eligible at or above the minimum sample size", () => {
    const result = computeCalibrationRecommendation(1.0, samples(15, 10, 2));
    expect(result.eligible).toBe(true);
    expect(result.sampleCount).toBe(15);
  });

  it("recommends lowering the multiplier when we consistently over-predict", () => {
    // predicted 10in, error +2in (predicted - observed), i.e. we over-predicted by 2in on average.
    const result = computeCalibrationRecommendation(1.0, samples(20, 10, 2));
    expect(result.eligible).toBe(true);
    expect(result.recommendedMultiplier).toBeLessThan(1.0);
  });

  it("recommends raising the multiplier when we consistently under-predict", () => {
    const result = computeCalibrationRecommendation(1.0, samples(20, 10, -2));
    expect(result.eligible).toBe(true);
    expect(result.recommendedMultiplier).toBeGreaterThan(1.0);
  });

  it("recommends no change when error averages to zero", () => {
    const mixed = [...samples(10, 10, 3), ...samples(10, 10, -3)];
    const result = computeCalibrationRecommendation(1.0, mixed);
    expect(result.recommendedMultiplier).toBeCloseTo(1.0, 5);
  });

  it("closes a big gap in one step (full step, Nick 2026-10-24)", () => {
    // Kirkwood-like: forecasts 1.86x the station, so the multiplier should land near 1/1.86.
    const result = computeCalibrationRecommendation(1.0, samples(20, 10, 10 - 10 / 1.86));
    expect(result.recommendedMultiplier).toBeCloseTo(1 / 1.86, 5);
    expect(Math.abs(result.recommendedMultiplier - 1)).toBeLessThanOrEqual(CALIBRATION_MAX_STEP_FRACTION);
  });

  it("stops at the bounds for an error too big to correct", () => {
    // Predicted 10in, observed 0: the raw correction is to zero.
    const result = computeCalibrationRecommendation(1.0, samples(20, 10, 10));
    expect(result.recommendedMultiplier).toBe(CALIBRATION_MULTIPLIER_BOUNDS.min);
  });

  it("never recommends outside CALIBRATION_MULTIPLIER_BOUNDS even starting near the edge", () => {
    const nearUpperBound = CALIBRATION_MULTIPLIER_BOUNDS.max - 0.01;
    const result = computeCalibrationRecommendation(nearUpperBound, samples(20, 10, -10));
    expect(result.recommendedMultiplier).toBeLessThanOrEqual(CALIBRATION_MULTIPLIER_BOUNDS.max);

    const nearLowerBound = CALIBRATION_MULTIPLIER_BOUNDS.min + 0.01;
    const result2 = computeCalibrationRecommendation(nearLowerBound, samples(20, 10, 10));
    expect(result2.recommendedMultiplier).toBeGreaterThanOrEqual(CALIBRATION_MULTIPLIER_BOUNDS.min);
  });

  it("is ineligible when mean predicted snowfall is zero", () => {
    const result = computeCalibrationRecommendation(1.0, samples(20, 0, 0));
    expect(result.eligible).toBe(false);
  });
});

describe("recencyWeight", () => {
  it("halves every half-life and never exceeds 1", () => {
    expect(recencyWeight(0, 10)).toBe(1);
    expect(recencyWeight(10, 10)).toBeCloseTo(0.5);
    expect(recencyWeight(20, 10)).toBeCloseTo(0.25);
    expect(recencyWeight(-1, 10)).toBe(1);
  });
});

describe("weighted calibration", () => {
  it("lets heavily weighted recent samples outvote old ones", () => {
    const old = Array.from({ length: 20 }, () => ({ predictedIn: 10, errorIn: 4, weight: 0.01 }));
    const recent = Array.from({ length: 20 }, () => ({ predictedIn: 10, errorIn: -4, weight: 1 }));
    const result = computeCalibrationRecommendation(1.0, [...old, ...recent]);
    // Recent under-prediction dominates, so the multiplier goes up.
    expect(result.meanSignedErrorIn).toBeLessThan(0);
    expect(result.recommendedMultiplier).toBeGreaterThan(1.0);
  });
});

describe("welchT", () => {
  it("is large for clearly different groups and 0 when there's too little data", () => {
    const a = Array.from({ length: 50 }, (_, i) => 2 + (i % 5) * 0.1);
    const b = Array.from({ length: 50 }, (_, i) => (i % 5) * 0.1);
    expect(welchT(a, b)).toBeGreaterThan(10);
    expect(welchT([1], b)).toBe(0);
  });
});
