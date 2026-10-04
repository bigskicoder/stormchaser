import { describe, expect, it } from "vitest";
import { computeDepthChangeSeries, findNearestStation } from "@/lib/ingestion/snotel";

describe("findNearestStation", () => {
  const stations = [
    { stationTriplet: "A:CO:SNTL", latitude: 39.0, longitude: -106.0 },
    { stationTriplet: "B:CO:SNTL", latitude: 39.5, longitude: -106.5 },
    { stationTriplet: "C:UT:SNTL", latitude: 40.6, longitude: -111.6 },
  ];

  it("picks the closest station by haversine distance", () => {
    // Closest to Alta, UT (40.5883, -111.6386) should be station C.
    const result = findNearestStation(40.5883, -111.6386, stations);
    expect(result?.triplet).toBe("C:UT:SNTL");
    expect(result?.distanceKm).toBeLessThan(10);
  });

  it("returns null for an empty station list", () => {
    expect(findNearestStation(40.0, -106.0, [])).toBeNull();
  });

  it("correctly picks the nearer of two close-but-distinct stations", () => {
    // Slightly closer to station A than B.
    const result = findNearestStation(39.05, -106.05, stations);
    expect(result?.triplet).toBe("A:CO:SNTL");
  });
});

describe("computeDepthChangeSeries", () => {
  it("has no change for the first day in the series (no previous reading)", () => {
    const result = computeDepthChangeSeries([{ date: "2026-01-10", depthIn: 40 }]);
    expect(result).toEqual([{ date: "2026-01-10", depthIn: 40, changeIn: null }]);
  });

  it("computes a positive delta as new snowfall", () => {
    const result = computeDepthChangeSeries([
      { date: "2026-01-10", depthIn: 40 },
      { date: "2026-01-11", depthIn: 46 },
    ]);
    expect(result[1]).toEqual({ date: "2026-01-11", depthIn: 46, changeIn: 6 });
  });

  it("clamps a depth decrease (settling/melt) to zero, never negative", () => {
    const result = computeDepthChangeSeries([
      { date: "2026-01-10", depthIn: 46 },
      { date: "2026-01-11", depthIn: 44 },
    ]);
    expect(result[1]!.changeIn).toBe(0);
  });

  it("carries the last known depth across a gap instead of resetting to null", () => {
    const result = computeDepthChangeSeries([
      { date: "2026-01-10", depthIn: 40 },
      { date: "2026-01-11", depthIn: null },
      { date: "2026-01-12", depthIn: 45 },
    ]);
    expect(result[1]).toEqual({ date: "2026-01-11", depthIn: null, changeIn: null });
    expect(result[2]).toEqual({ date: "2026-01-12", depthIn: 45, changeIn: 5 });
  });

  it("sorts out-of-order input by date before computing deltas", () => {
    const result = computeDepthChangeSeries([
      { date: "2026-01-12", depthIn: 50 },
      { date: "2026-01-10", depthIn: 40 },
      { date: "2026-01-11", depthIn: 45 },
    ]);
    expect(result.map((r) => r.date)).toEqual(["2026-01-10", "2026-01-11", "2026-01-12"]);
    expect(result[2]!.changeIn).toBe(5);
  });
});
