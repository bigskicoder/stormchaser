import { describe, expect, it } from "vitest";
import { findNearestStation } from "@/lib/ingestion/snotel";

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
