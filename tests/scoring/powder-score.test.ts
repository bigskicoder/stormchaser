import { describe, expect, it } from "vitest";
import { computeLeadTimeFit, computeNormalizedSnowfall, computePowderScore } from "@/lib/scoring/powder-score";

describe("computeLeadTimeFit", () => {
  it("is 1.0 inside the actionable window [24, 96]", () => {
    expect(computeLeadTimeFit(24)).toBe(1);
    expect(computeLeadTimeFit(60)).toBe(1);
    expect(computeLeadTimeFit(96)).toBe(1);
  });

  it("decays linearly below the window's minimum", () => {
    const at10h = computeLeadTimeFit(10); // 14h short of window -> 1 - 14*0.01
    expect(at10h).toBeCloseTo(0.86, 5);
  });

  it("decays linearly beyond the window's maximum", () => {
    const at196h = computeLeadTimeFit(196); // 100h past window -> 1 - 100*0.01
    expect(at196h).toBeCloseTo(0, 5);
  });

  it("floors at 0 for very long lead times", () => {
    expect(computeLeadTimeFit(1000)).toBe(0);
  });
});

describe("computeNormalizedSnowfall", () => {
  it("clamps to [0, 1] against the seasonal max", () => {
    expect(computeNormalizedSnowfall(12, 24)).toBe(0.5);
    expect(computeNormalizedSnowfall(30, 24)).toBe(1);
    expect(computeNormalizedSnowfall(-5, 24)).toBe(0);
  });

  it("returns 0 when seasonal max is non-positive (guards divide by zero)", () => {
    expect(computeNormalizedSnowfall(10, 0)).toBe(0);
  });
});

describe("computePowderScore", () => {
  it("matches the section 5.4 formula: 0.5*snow + 0.35*confidence + 0.15*leadTimeFit", () => {
    const score = computePowderScore({ normalizedSnowfall: 0.8, confidenceLabel: "high", leadTimeFit: 1 });
    expect(score).toBeCloseTo(0.5 * 0.8 + 0.35 * 1.0 + 0.15 * 1, 5);
  });

  it("uses the correct confidence weight per label", () => {
    const high = computePowderScore({ normalizedSnowfall: 0, confidenceLabel: "high", leadTimeFit: 0 });
    const medium = computePowderScore({ normalizedSnowfall: 0, confidenceLabel: "medium", leadTimeFit: 0 });
    const low = computePowderScore({ normalizedSnowfall: 0, confidenceLabel: "low", leadTimeFit: 0 });
    expect(high).toBeCloseTo(0.35 * 1.0, 5);
    expect(medium).toBeCloseTo(0.35 * 0.6, 5);
    expect(low).toBeCloseTo(0.35 * 0.3, 5);
  });

  it("never exceeds 1 or drops below 0", () => {
    const max = computePowderScore({ normalizedSnowfall: 1, confidenceLabel: "high", leadTimeFit: 1 });
    expect(max).toBeLessThanOrEqual(1);
    const min = computePowderScore({ normalizedSnowfall: 0, confidenceLabel: "low", leadTimeFit: 0 });
    expect(min).toBeGreaterThanOrEqual(0);
  });
});
