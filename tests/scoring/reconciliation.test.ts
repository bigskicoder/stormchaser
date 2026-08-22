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
});
