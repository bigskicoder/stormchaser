import { describe, expect, it } from "vitest";
import { kucheraStrategy } from "@/lib/scoring/slr/kuchera";
import { kucheraWindStrategy } from "@/lib/scoring/slr/kuchera-wind";

describe("kucheraWindStrategy", () => {
  it("returns rain case with zero ratio at/above freezing, same as plain kuchera", () => {
    const result = kucheraWindStrategy.computeRatio({ tmaxC: 1, calibrationMultiplier: 1, avgWindSpeedKmh: 50 });
    expect(result.isRainCase).toBe(true);
    expect(result.ratio).toBe(0);
  });

  it("matches plain kuchera exactly when wind data is missing (null) — no adjustment, not a guess", () => {
    const wind = kucheraWindStrategy.computeRatio({ tmaxC: -10, calibrationMultiplier: 1, avgWindSpeedKmh: null });
    const plain = kucheraStrategy.computeRatio({ tmaxC: -10, calibrationMultiplier: 1 });
    expect(wind.ratio).toBeCloseTo(plain.ratio, 10);
  });

  it("matches plain kuchera exactly when avgWindSpeedKmh is simply omitted", () => {
    const wind = kucheraWindStrategy.computeRatio({ tmaxC: -10, calibrationMultiplier: 1 });
    const plain = kucheraStrategy.computeRatio({ tmaxC: -10, calibrationMultiplier: 1 });
    expect(wind.ratio).toBeCloseTo(plain.ratio, 10);
  });

  it("matches plain kuchera exactly at zero wind", () => {
    const wind = kucheraWindStrategy.computeRatio({ tmaxC: -10, calibrationMultiplier: 1, avgWindSpeedKmh: 0 });
    const plain = kucheraStrategy.computeRatio({ tmaxC: -10, calibrationMultiplier: 1 });
    expect(wind.ratio).toBeCloseTo(plain.ratio, 10);
  });

  it("reduces the ratio as wind speed increases (the hypothesis under test)", () => {
    const calm = kucheraWindStrategy.computeRatio({ tmaxC: -10, calibrationMultiplier: 1, avgWindSpeedKmh: 5 });
    const breezy = kucheraWindStrategy.computeRatio({ tmaxC: -10, calibrationMultiplier: 1, avgWindSpeedKmh: 40 });
    const windy = kucheraWindStrategy.computeRatio({ tmaxC: -10, calibrationMultiplier: 1, avgWindSpeedKmh: 80 });
    expect(breezy.ratio).toBeLessThan(calm.ratio);
    expect(windy.ratio).toBeLessThan(breezy.ratio);
  });

  it("never reduces the ratio by more than the documented floor, however extreme the wind", () => {
    const plain = kucheraStrategy.computeRatio({ tmaxC: -10, calibrationMultiplier: 1 });
    const extreme = kucheraWindStrategy.computeRatio({ tmaxC: -10, calibrationMultiplier: 1, avgWindSpeedKmh: 500 });
    expect(extreme.ratio).toBeCloseTo(plain.ratio * 0.6, 5);
  });

  it("applies the per-resort calibration multiplier after the wind adjustment", () => {
    const base = kucheraWindStrategy.computeRatio({ tmaxC: -10, calibrationMultiplier: 1, avgWindSpeedKmh: 40 });
    const calibrated = kucheraWindStrategy.computeRatio({ tmaxC: -10, calibrationMultiplier: 1.2, avgWindSpeedKmh: 40 });
    expect(calibrated.ratio).toBeCloseTo(base.ratio * 1.2, 5);
  });

  it("never returns a negative ratio", () => {
    const result = kucheraWindStrategy.computeRatio({ tmaxC: -0.01, calibrationMultiplier: 1, avgWindSpeedKmh: 200 });
    expect(result.ratio).toBeGreaterThanOrEqual(0);
  });

  it("reports its own strategy name, not kuchera's", () => {
    const result = kucheraWindStrategy.computeRatio({ tmaxC: -10, calibrationMultiplier: 1, avgWindSpeedKmh: 20 });
    expect(result.strategy).toBe("kuchera-wind");
  });
});
