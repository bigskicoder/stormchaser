import { describe, expect, it } from "vitest";
import { bucketHourlyReanalysisByLocalDay, computeSlrBacktestDay } from "@/lib/backtest/slr-reanalysis";
import type { HistoricalWeatherResponse } from "@/lib/ingestion/open-meteo-historical";

describe("bucketHourlyReanalysisByLocalDay", () => {
  it("sums precipitation and takes the max temperature per local calendar day", () => {
    const hourly: HistoricalWeatherResponse["hourly"] = {
      time: ["2015-01-15T00:00", "2015-01-15T06:00", "2015-01-15T12:00", "2015-01-16T00:00"],
      temperature_2m: [-8, -4, -2, -10],
      precipitation: [2, 3, 1, 5],
    };
    const buckets = bucketHourlyReanalysisByLocalDay(hourly, "UTC");
    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toEqual({ date: "2015-01-15", dailyPrecipMm: 6, tmaxC: -2 });
    expect(buckets[1]).toEqual({ date: "2015-01-16", dailyPrecipMm: 5, tmaxC: -10 });
  });

  it("buckets by the resort's LOCAL day, not UTC — same bug class fixed elsewhere this session", () => {
    // 6pm Mountain time Jan 14 = 1am UTC Jan 15. A naive UTC bucketing
    // would put this hour on Jan 15; it must land on Jan 14 locally.
    const hourly: HistoricalWeatherResponse["hourly"] = {
      time: ["2015-01-15T01:00"],
      temperature_2m: [-5],
      precipitation: [1],
    };
    const buckets = bucketHourlyReanalysisByLocalDay(hourly, "America/Denver");
    expect(buckets[0]!.date).toBe("2015-01-14");
  });

  it("ignores hours with no numeric temperature/precipitation rather than treating them as zero", () => {
    const hourly: HistoricalWeatherResponse["hourly"] = {
      time: ["2015-01-15T00:00", "2015-01-15T01:00"],
      temperature_2m: [-5, null],
      precipitation: [null, 2],
    };
    const buckets = bucketHourlyReanalysisByLocalDay(hourly, "UTC");
    expect(buckets[0]!.dailyPrecipMm).toBe(2);
    expect(buckets[0]!.tmaxC).toBe(-5);
  });

  it("returns an empty array for an empty hourly series", () => {
    expect(bucketHourlyReanalysisByLocalDay({ time: [] }, "UTC")).toEqual([]);
  });
});

describe("computeSlrBacktestDay", () => {
  const coldBucket = { date: "2015-01-15", dailyPrecipMm: 25.4, tmaxC: -8 }; // 1 inch liquid

  it("returns null when there's no observed ground truth for the day", () => {
    const result = computeSlrBacktestDay({ bucket: coldBucket, calibrationMultiplier: 1.0, observedSnowfallIn: null });
    expect(result).toBeNull();
  });

  it("returns null when the bucket has no temperature reading", () => {
    const result = computeSlrBacktestDay({
      bucket: { date: "2015-01-15", dailyPrecipMm: 10, tmaxC: null },
      calibrationMultiplier: 1.0,
      observedSnowfallIn: 5,
    });
    expect(result).toBeNull();
  });

  it("computes predicted snowfall from the Kuchera ratio and a signed error against observed", () => {
    const result = computeSlrBacktestDay({ bucket: coldBucket, calibrationMultiplier: 1.0, observedSnowfallIn: 10 });
    expect(result).not.toBeNull();
    expect(result!.isRainCase).toBe(false);
    expect(result!.predictedSnowfallIn).toBeGreaterThan(0);
    expect(result!.errorIn).toBeCloseTo(result!.predictedSnowfallIn - 10, 10);
  });

  it("treats a warm day as a rain case with zero predicted snowfall", () => {
    const warmBucket = { date: "2015-01-15", dailyPrecipMm: 25.4, tmaxC: 5 };
    const result = computeSlrBacktestDay({ bucket: warmBucket, calibrationMultiplier: 1.0, observedSnowfallIn: 0 });
    expect(result!.isRainCase).toBe(true);
    expect(result!.predictedSnowfallIn).toBe(0);
  });

  it("scales predicted snowfall with the calibration multiplier", () => {
    const base = computeSlrBacktestDay({ bucket: coldBucket, calibrationMultiplier: 1.0, observedSnowfallIn: 10 })!;
    const boosted = computeSlrBacktestDay({ bucket: coldBucket, calibrationMultiplier: 1.2, observedSnowfallIn: 10 })!;
    expect(boosted.predictedSnowfallIn).toBeGreaterThan(base.predictedSnowfallIn);
  });
});
