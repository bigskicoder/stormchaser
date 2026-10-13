import { describe, expect, it } from "vitest";
import { reconcileModels } from "@/lib/scoring/reconciliation";

describe("reconcileModels", () => {
  it("uses the T0-48 weight table (HRRR-heavy) inside the first 48h", () => {
    const result = reconcileModels({ hrrr: 100, gfs: 0, icon: 0, ecmwf: 0 }, 12);
    // HRRR weight 0.5 dominates; blend should be well above a naive average of the four.
    expect(result.reconciledValue).toBeCloseTo(50, 5); // 100 * 0.5 (renormalized weight sums to 1 already)
    expect(result.modelsUsed).toContain("hrrr");
  });

  it("drops HRRR beyond T+120h per the T120_PLUS bucket", () => {
    const result = reconcileModels({ hrrr: 999, gfs: 10, ecmwf: 10, gem: 10 }, 200);
    expect(result.modelsUsed).not.toContain("hrrr");
    expect(result.reconciledValue).toBeCloseTo(10, 5);
  });

  it("renormalizes weights when a model is missing from the bucket's table", () => {
    // T48-120 bucket wants gfs .3 / ecmwf .35 / icon .2 / gem .15; drop gem.
    const result = reconcileModels({ gfs: 10, ecmwf: 10, icon: 10 }, 72);
    expect(result.reconciledValue).toBeCloseTo(10, 5);
  });

  it("flags disagreement when relative spread exceeds the configured threshold", () => {
    const result = reconcileModels({ hrrr: 10, gfs: 10, icon: 10, ecmwf: 100 }, 12);
    expect(result.disagreementFlag).toBe(true);
    expect(result.modelAgreementScore).toBeLessThan(0.5);
  });

  it("does not flag disagreement when models are in close agreement", () => {
    const result = reconcileModels({ hrrr: 10, gfs: 10.5, icon: 9.8, ecmwf: 10.2 }, 12);
    expect(result.disagreementFlag).toBe(false);
    expect(result.modelAgreementScore).toBeGreaterThan(0.8);
  });

  it("handles all-zero model values without dividing by zero", () => {
    const result = reconcileModels({ hrrr: 0, gfs: 0, icon: 0, ecmwf: 0 }, 12);
    expect(result.reconciledValue).toBe(0);
    expect(result.disagreementFlag).toBe(false);
    expect(Number.isFinite(result.modelAgreementScore)).toBe(true);
  });

  it("throws when no models overlap the bucket's weight table", () => {
    expect(() => reconcileModels({}, 12)).toThrow();
  });

  describe("config override (model versioning)", () => {
    it("uses an overridden weight table instead of the compiled-in default", () => {
      const equalWeights = { T0_48: { hrrr: 0.25, gfs: 0.25, icon: 0.25, ecmwf: 0.25 }, T48_120: {}, T120_PLUS: {} };
      const result = reconcileModels({ hrrr: 100, gfs: 0, icon: 0, ecmwf: 0 }, 12, { weightsByBucket: equalWeights });
      // Equal weights across 4 models, only hrrr non-zero -> 100 * 0.25.
      expect(result.reconciledValue).toBeCloseTo(25, 5);
    });

    it("uses an overridden disagreement threshold instead of the compiled-in default", () => {
      // Spread that would NOT trip the default 0.4 threshold...
      const mild = reconcileModels({ hrrr: 10, gfs: 10, icon: 10, ecmwf: 13 }, 12);
      expect(mild.disagreementFlag).toBe(false);
      // ...but does trip a much stricter overridden threshold.
      const strict = reconcileModels({ hrrr: 10, gfs: 10, icon: 10, ecmwf: 13 }, 12, { disagreementThreshold: 0.1 });
      expect(strict.disagreementFlag).toBe(true);
    });
  });
});
