import { describe, expect, it } from "vitest";
import { estimateWindHoldProbability } from "@/lib/scoring/wind-hold";

describe("estimateWindHoldProbability", () => {
  it("returns null when neither gust nor sustained wind is available", () => {
    expect(estimateWindHoldProbability({ maxWindGustKmh: null, avgWindSpeedKmh: null })).toBeNull();
  });

  it("is near zero for a calm day", () => {
    const p = estimateWindHoldProbability({ maxWindGustKmh: 15, avgWindSpeedKmh: 10 });
    expect(p).not.toBeNull();
    expect(p!).toBeLessThan(0.05);
  });

  it("is near one for an extreme wind event", () => {
    const p = estimateWindHoldProbability({ maxWindGustKmh: 110, avgWindSpeedKmh: 70 });
    expect(p!).toBeGreaterThan(0.95);
  });

  it("is close to 0.5 right at the logistic midpoint gust", () => {
    const p = estimateWindHoldProbability({ maxWindGustKmh: 65, avgWindSpeedKmh: null });
    expect(p!).toBeCloseTo(0.5, 2);
  });

  it("increases monotonically with gust speed", () => {
    const low = estimateWindHoldProbability({ maxWindGustKmh: 40, avgWindSpeedKmh: null })!;
    const mid = estimateWindHoldProbability({ maxWindGustKmh: 65, avgWindSpeedKmh: null })!;
    const high = estimateWindHoldProbability({ maxWindGustKmh: 90, avgWindSpeedKmh: null })!;
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });

  it("falls back to sustained wind speed (scaled up) when no gust is reported", () => {
    const fromGust = estimateWindHoldProbability({ maxWindGustKmh: 70, avgWindSpeedKmh: null })!;
    const fromSustained = estimateWindHoldProbability({ maxWindGustKmh: null, avgWindSpeedKmh: 50 })!;
    // 50 * 1.4 = 70, so these should match exactly.
    expect(fromSustained).toBeCloseTo(fromGust, 10);
  });

  it("prefers gust over sustained speed when both are present", () => {
    const p = estimateWindHoldProbability({ maxWindGustKmh: 20, avgWindSpeedKmh: 70 });
    // If sustained speed were used (70*1.4=98), this would be near 1. Gust of 20 should stay near 0.
    expect(p!).toBeLessThan(0.05);
  });

  it("never exceeds the [0, 1] bounds", () => {
    const p = estimateWindHoldProbability({ maxWindGustKmh: 500, avgWindSpeedKmh: null })!;
    expect(p).toBeLessThanOrEqual(1);
    expect(p).toBeGreaterThanOrEqual(0);
  });
});
