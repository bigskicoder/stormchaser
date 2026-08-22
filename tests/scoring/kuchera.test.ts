import { describe, expect, it } from "vitest";
import { kucheraStrategy } from "@/lib/scoring/slr/kuchera";
import { fixedRatioStrategy } from "@/lib/scoring/slr/fixed-ratio";

describe("kucheraStrategy", () => {
  it("returns rain case with zero ratio at/above freezing", () => {
    const result = kucheraStrategy.computeRatio({ tmaxC: 1, calibrationMultiplier: 1 });
    expect(result.isRainCase).toBe(true);
    expect(result.ratio).toBe(0);

    const atFreezing = kucheraStrategy.computeRatio({ tmaxC: 0, calibrationMultiplier: 1 });
    expect(atFreezing.isRainCase).toBe(true);
  });

  it("returns exactly the 12:1 anchor ratio at the -2.01C threshold", () => {
    // 271.16K = -2.01C (271.16 - 273.15)
    const result = kucheraStrategy.computeRatio({ tmaxC: 271.16 - 273.15, calibrationMultiplier: 1 });
    expect(result.isRainCase).toBe(false);
    expect(result.ratio).toBeCloseTo(12, 5);
  });

  it("produces a higher ratio for colder temps (steeper below-threshold slope)", () => {
    const coldResult = kucheraStrategy.computeRatio({ tmaxC: -15, calibrationMultiplier: 1 });
    const thresholdResult = kucheraStrategy.computeRatio({ tmaxC: -2.01, calibrationMultiplier: 1 });
    expect(coldResult.ratio).toBeGreaterThan(thresholdResult.ratio);
  });

  it("produces a lower ratio for warmer (but still sub-freezing) temps", () => {
    const warmResult = kucheraStrategy.computeRatio({ tmaxC: -0.5, calibrationMultiplier: 1 });
    const thresholdResult = kucheraStrategy.computeRatio({ tmaxC: -2.01, calibrationMultiplier: 1 });
    expect(warmResult.ratio).toBeLessThan(thresholdResult.ratio);
    expect(warmResult.ratio).toBeGreaterThanOrEqual(0);
  });

  it("applies the per-resort calibration multiplier linearly", () => {
    const base = kucheraStrategy.computeRatio({ tmaxC: -10, calibrationMultiplier: 1 });
    const calibrated = kucheraStrategy.computeRatio({ tmaxC: -10, calibrationMultiplier: 1.2 });
    expect(calibrated.ratio).toBeCloseTo(base.ratio * 1.2, 5);
  });

  it("never returns a negative ratio", () => {
    const extremeWarm = kucheraStrategy.computeRatio({ tmaxC: -0.01, calibrationMultiplier: 1 });
    expect(extremeWarm.ratio).toBeGreaterThanOrEqual(0);
  });
});

describe("fixedRatioStrategy", () => {
  it("returns the fixed 12:1 baseline for any sub-freezing temp", () => {
    expect(fixedRatioStrategy.computeRatio({ tmaxC: -5, calibrationMultiplier: 1 }).ratio).toBe(12);
    expect(fixedRatioStrategy.computeRatio({ tmaxC: -25, calibrationMultiplier: 1 }).ratio).toBe(12);
  });

  it("flags rain case at/above freezing with zero ratio", () => {
    const result = fixedRatioStrategy.computeRatio({ tmaxC: 2, calibrationMultiplier: 1 });
    expect(result.isRainCase).toBe(true);
    expect(result.ratio).toBe(0);
  });
});
