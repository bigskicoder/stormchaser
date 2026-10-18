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

  it("uses an overridden actionable window and decay rate instead of the compiled-in defaults", () => {
    // Default window [24,96] would NOT give 1.0 at 10h...
    expect(computeLeadTimeFit(10)).not.toBe(1);
    // ...but an overridden window that includes 10h does.
    expect(computeLeadTimeFit(10, { actionableWindowHours: { min: 0, max: 20 } })).toBe(1);
    // A steeper overridden decay rate drops off faster than the default.
    const defaultDecay = computeLeadTimeFit(10);
    const steeperDecay = computeLeadTimeFit(10, { decayPerHour: 0.1 });
    expect(steeperDecay).toBeLessThan(defaultDecay);
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

  it("uses overridden weights and confidence-weight-by-label instead of the compiled-in defaults", () => {
    const input = { normalizedSnowfall: 1, confidenceLabel: "low" as const, leadTimeFit: 0 };
    const defaultScore = computePowderScore(input);
    // Overridden weights put everything on snowfall, and overridden
    // confidence weights make "low" worth as much as "high" normally is.
    const overriddenScore = computePowderScore(input, {
      weights: { SNOWFALL: 1, CONFIDENCE: 0, LEAD_TIME_FIT: 0 },
      confidenceWeightByLabel: { high: 1.0, medium: 1.0, low: 1.0 },
    });
    expect(overriddenScore).toBe(1);
    expect(overriddenScore).toBeGreaterThan(defaultScore);
  });
});

describe("computePowderScore snow credit", () => {
  const base = { normalizedSnowfall: 0, confidenceLabel: "high" as const, leadTimeFit: 1 };

  it("gives a confident dry day nothing", () => {
    expect(computePowderScore({ ...base, estimatedSnowfallIn: 0 })).toBe(0);
  });

  it("scales confidence and timing up to full credit at 6 inches", () => {
    const half = computePowderScore({ ...base, estimatedSnowfallIn: 3 });
    const full = computePowderScore({ ...base, estimatedSnowfallIn: 6 });
    expect(half).toBeCloseTo(0.25);
    expect(full).toBeCloseTo(0.5);
    expect(computePowderScore({ ...base, estimatedSnowfallIn: 12 })).toBeCloseTo(full);
  });

  it("keeps the original behavior when snowfall isn't passed", () => {
    expect(computePowderScore(base)).toBeCloseTo(0.5);
  });
});
