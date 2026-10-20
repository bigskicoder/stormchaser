import { describe, expect, it } from "vitest";
import { runSnowpack, type SnowpackParams } from "@/lib/snowpack/model";
import { fitAndScoreResort, scoreSnowpack, type SnowpackWinter } from "@/lib/snowpack/fit";
import { syntheticWinter } from "./synthetic";

const truth: SnowpackParams = { scf: 1.3, mfMin: 1, mfMax: 5.5, cE: 0.0025, c1: 0.02, c2: 24, srf: 0.4 };

function winters(n: number, p: SnowpackParams, opts: { depthOnly?: boolean } = {}): SnowpackWinter[] {
  return Array.from({ length: n }, (_, i) => {
    const wy = 2000 + i;
    const days = syntheticWinter(wy, { tempShiftC: (i % 3) - 1, precipScale: 0.7 + (i % 5) * 0.15 });
    const r = runSnowpack(days, p);
    return { waterYear: wy, days, obs: r.map((x) => ({ date: x.date, sweMm: opts.depthOnly ? null : x.sweMm, depthCm: x.depthCm })) };
  });
}

describe("fitAndScoreResort", () => {
  it("recovers known parameters from a station the model generated, and clears the bar on held-out winters", () => {
    const fit = fitAndScoreResort(winters(6, truth), { folds: 3, maxEvals: 150 })!;
    expect(fit.params.scf).toBeCloseTo(1.3, 1);
    expect(fit.params.mfMax).toBeGreaterThan(4.5);
    expect(fit.heldOut.sweNse!).toBeGreaterThan(0.99);
    expect(fit.passes).toBe(true);
  });

  it("fails a station the model can't reproduce, and says which checks it missed", () => {
    // The 'station' gets double the snow on alternate winters: no single SCF fits both.
    const ws = winters(6, truth).map((w, i) => ({ ...w, obs: w.obs.map((o) => ({ ...o, sweMm: o.sweMm! * (i % 2 ? 2.2 : 0.5) })) }));
    const fit = fitAndScoreResort(ws, { folds: 3, maxEvals: 80 })!;
    expect(fit.passes).toBe(false);
    expect(fit.failedChecks.some((c) => c.startsWith("SWE NSE") || c.startsWith("peak"))).toBe(true);
  });

  it("judges a depth-only stake on depth", () => {
    const fit = fitAndScoreResort(winters(4, truth, { depthOnly: true }), { folds: 2, maxEvals: 80 })!;
    expect(fit.heldOut.sweDays).toBe(0);
    expect(fit.heldOut.depthNse!).toBeGreaterThan(0.8);
  });

  it("needs at least two winters with readings", () => {
    expect(fitAndScoreResort(winters(1, truth))).toBeNull();
  });
});

describe("scoreSnowpack", () => {
  it("scores a perfect model 1 and measures peak and melt-out error per winter", () => {
    const pairs = [
      { waterYear: 2020, date: "2020-01-01", modelSwe: 100, modelDepth: 50, obsSwe: 100, obsDepth: 50 },
      { waterYear: 2020, date: "2020-03-01", modelSwe: 300, modelDepth: 90, obsSwe: 300, obsDepth: 90 },
      { waterYear: 2020, date: "2020-05-01", modelSwe: 0, modelDepth: 0, obsSwe: 0, obsDepth: 0 },
    ];
    const m = scoreSnowpack(pairs);
    expect(m.sweNse).toBe(1);
    expect(m.medianPeakErrorPct).toBe(0);
    expect(m.medianMeltOutErrorDays).toBe(0);
    expect(m.medianPeakBiasPct).toBe(0);
    expect(m.medianMeltOutBiasDays).toBe(0);
  });
});
