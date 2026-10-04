import { describe, expect, it } from "vitest";
import { computeCalibrationRecommendation, type AccuracySample } from "@/lib/calibration/recommend";
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

  it("never steps by more than CALIBRATION_MAX_STEP_FRACTION per call, even for a huge error", () => {
    // Error equal to the full predicted amount (100% relative error) should
    // still only move the multiplier by the configured max step.
    const result = computeCalibrationRecommendation(1.0, samples(20, 10, 10));
    expect(result.eligible).toBe(true);
    const actualStepFraction = Math.abs(result.recommendedMultiplier - 1.0) / 1.0;
    expect(actualStepFraction).toBeCloseTo(CALIBRATION_MAX_STEP_FRACTION, 5);
    expect(result.recommendedMultiplier).toBeLessThan(1.0);
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
