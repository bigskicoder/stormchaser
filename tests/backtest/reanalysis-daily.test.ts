import { describe, expect, it } from "vitest";
import { reanalysisDailyRows } from "@/lib/backtest/reanalysis-daily";

describe("reanalysisDailyRows", () => {
  it("aggregates each local day: sums, means, extremes and shortwave in MJ/m²", () => {
    const rows = reanalysisDailyRows({
      resortId: "r1",
      timeZone: "UTC",
      elevationM: 2900.4,
      hourly: {
        time: ["2015-01-15T00:00", "2015-01-15T01:00", "2015-01-16T00:00"],
        temperature_2m: [-8, -2, -10],
        precipitation: [1, 2, 0],
        snowfall: [0.7, 1.4, 0],
        relative_humidity_2m: [80, 90, 70],
        dew_point_2m: [-10, -4, -14],
        wind_speed_10m: [4, 8, 2],
        shortwave_radiation: [0, 500, 0],
        surface_pressure: [700, 702, 701],
        cloud_cover: [100, 50, 0],
      },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      resort_id: "r1",
      date: "2015-01-15",
      elevation_m: 2900,
      hours: 2,
      precip_mm: 3,
      snowfall_cm: 2.1,
      temp_min_c: -8,
      temp_max_c: -2,
      temp_mean_c: -5,
      dew_point_mean_c: -7,
      rh_mean_pct: 85,
      wind_mean_ms: 6,
      wind_max_ms: 8,
      shortwave_mj_m2: 1.8,
      pressure_mean_hpa: 701,
      cloud_cover_mean_pct: 75,
    });
  });

  it("leaves a variable null when the archive sent none of it, instead of zero", () => {
    const [row] = reanalysisDailyRows({
      resortId: "r1",
      timeZone: "America/Denver",
      elevationM: 2900,
      hourly: { time: ["2015-01-15T12:00"], temperature_2m: [-5], precipitation: [null] },
    });
    expect(row!.date).toBe("2015-01-15");
    expect(row!.precip_mm).toBeNull();
    expect(row!.shortwave_mj_m2).toBeNull();
    expect(row!.wind_mean_ms).toBeNull();
    expect(row!.temp_mean_c).toBe(-5);
  });
});
