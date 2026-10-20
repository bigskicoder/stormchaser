import { describe, expect, it } from "vitest";
import {
  DEFAULT_SNOWPACK_PARAMS,
  dailySublimationMm,
  newSnowDensity,
  positiveDegreeDays,
  runSnowpack,
  seasonalMeltFactor,
  snowFraction,
  waterYearOf,
} from "@/lib/snowpack/model";
import { syntheticWinter } from "./synthetic";

describe("snowpack model pieces", () => {
  it("splits rain and snow linearly between -1 and 3 °C", () => {
    expect(snowFraction(-5)).toBe(1);
    expect(snowFraction(1)).toBe(0.5);
    expect(snowFraction(4)).toBe(0);
  });

  it("makes light new snow when cold and dense when warm (Hedstrom & Pomeroy)", () => {
    expect(newSnowDensity(-15)).toBeCloseTo(0.068, 2);
    expect(newSnowDensity(0)).toBeCloseTo(0.119, 3);
  });

  it("finds melt on a day that averages below freezing but thaws in the afternoon", () => {
    expect(positiveDegreeDays(-8, -1)).toBe(0);
    expect(positiveDegreeDays(-6, 6)).toBeGreaterThan(1);
    expect(positiveDegreeDays(2, 8)).toBe(5);
  });

  it("peaks the melt factor in June and bottoms it in December", () => {
    expect(seasonalMeltFactor("2026-06-21", 1, 5)).toBeCloseTo(5, 1);
    expect(seasonalMeltFactor("2026-12-21", 1, 5)).toBeCloseTo(1, 1);
  });

  it("sublimates more in dry wind than in humid calm", () => {
    const base = { date: "2026-02-01", precipMm: 0, tMeanC: -5, tMinC: -10, tMaxC: 0, pressureHpa: 720 };
    expect(dailySublimationMm({ ...base, rhPct: 30, windMs: 8 }, 0.0015)).toBeGreaterThan(dailySublimationMm({ ...base, rhPct: 90, windMs: 1 }, 0.0015));
    expect(dailySublimationMm({ ...base, rhPct: 100, windMs: 0 }, 0.0015)).toBe(0);
  });

  it("starts the water year on Oct 1", () => {
    expect(waterYearOf("2026-09-30")).toBe(2026);
    expect(waterYearOf("2026-10-01")).toBe(2027);
  });
});

describe("runSnowpack over a synthetic mountain winter", () => {
  const results = runSnowpack(syntheticWinter(2020), DEFAULT_SNOWPACK_PARAMS);
  const peak = results.reduce((a, b) => (b.sweMm > a.sweMm ? b : a));

  it("builds through winter, peaks in spring and melts out by summer", () => {
    expect(peak.date >= "2020-03-01" && peak.date <= "2020-05-31").toBe(true);
    expect(results.find((r) => r.date === "2020-08-15")!.sweMm).toBe(0);
  });

  it("settles to realistic densities: fresh pack around 0.2, ripe spring pack 0.35-0.55", () => {
    expect(results.find((r) => r.date === "2019-12-15")!.density!).toBeGreaterThan(0.15);
    expect(results.find((r) => r.date === "2019-12-15")!.density!).toBeLessThan(0.3);
    const may = results.find((r) => r.date === "2020-05-20")!;
    expect(may.density!).toBeGreaterThan(0.35);
    expect(may.density!).toBeLessThanOrEqual(0.55);
  });

  it("conserves water: snowfall + rain on the pack = melt runoff + sublimation + what's left", () => {
    const days = syntheticWinter(2020);
    const inputs = results.reduce((s, r) => s + r.newSnowSweMm, 0);
    const outputs = results.reduce((s, r) => s + r.runoffMm + r.sublimationMm, 0);
    // Rain that lands on snow passes through as runoff, so add it to the inputs.
    const rainOnPack = days.reduce((s, d, i) => {
      const packBefore = i === 0 ? 0 : results[i - 1]!.sweMm;
      return s + (packBefore + results[i]!.newSnowSweMm > 0 ? (1 - snowFraction(d.tMeanC)) * d.precipMm : 0);
    }, 0);
    expect(Math.abs(inputs + rainOnPack - outputs - results[results.length - 1]!.sweMm)).toBeLessThan(inputs * 0.05);
  });

  it("melts sooner and grows less in a warmer winter", () => {
    const warm = runSnowpack(syntheticWinter(2020, { tempShiftC: 2 }), DEFAULT_SNOWPACK_PARAMS);
    const warmPeak = Math.max(...warm.map((r) => r.sweMm));
    expect(warmPeak).toBeLessThan(peak.sweMm);
  });
});
