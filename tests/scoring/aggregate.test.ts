import { describe, expect, it } from "vitest";
import {
  dailyAvgCloudCoverPct,
  dailyAvgTempC,
  dailyAvgWindSpeedKmh,
  dailyMaxWindGustKmh,
  maxAcrossModels,
  meanAcrossModels,
} from "@/lib/scoring/aggregate";
import type { ForecastPull } from "@/lib/db/types";

function row(overrides: Partial<ForecastPull>): ForecastPull {
  return {
    id: "x",
    resort_id: "r",
    model_name: "gfs",
    elevation_band: "mid",
    run_init_time: "2026-01-01T00:00:00Z",
    valid_time: "2026-01-01T00:00:00Z",
    pulled_at: "2026-01-01T00:00:00Z",
    raw_payload: {},
    swe_mm: null,
    precip_mm: null,
    temp_c: null,
    wind_speed_kmh: null,
    wind_gust_kmh: null,
    wind_dir_deg: null,
    freezing_level_m: null,
    cloud_cover_pct: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("daily weather/wind aggregation", () => {
  it("averages temp/wind/cloud cover across hourly rows, ignoring nulls", () => {
    const rows = [row({ temp_c: -2, wind_speed_kmh: 10, cloud_cover_pct: 80 }), row({ temp_c: -4, wind_speed_kmh: 20, cloud_cover_pct: null })];
    expect(dailyAvgTempC(rows)).toBe(-3);
    expect(dailyAvgWindSpeedKmh(rows)).toBe(15);
    expect(dailyAvgCloudCoverPct(rows)).toBe(80);
  });

  it("returns null when every row is null for a field", () => {
    const rows = [row({}), row({})];
    expect(dailyAvgTempC(rows)).toBeNull();
  });

  it("returns null for an empty row set", () => {
    expect(dailyAvgWindSpeedKmh([])).toBeNull();
  });

  it("takes the max gust across hourly rows, not the mean", () => {
    const rows = [row({ wind_gust_kmh: 30 }), row({ wind_gust_kmh: 55 }), row({ wind_gust_kmh: 40 })];
    expect(dailyMaxWindGustKmh(rows)).toBe(55);
  });

  it("ignores rows with no gust reported", () => {
    expect(dailyMaxWindGustKmh([row({ wind_gust_kmh: null })])).toBeNull();
  });
});

describe("meanAcrossModels / maxAcrossModels", () => {
  it("averages present values, skipping nulls", () => {
    expect(meanAcrossModels([10, null, 20])).toBe(15);
  });

  it("returns null when every model is null", () => {
    expect(meanAcrossModels([null, null])).toBeNull();
  });

  it("maxAcrossModels takes the max of present values", () => {
    expect(maxAcrossModels([10, 40, null, 25])).toBe(40);
  });
});
