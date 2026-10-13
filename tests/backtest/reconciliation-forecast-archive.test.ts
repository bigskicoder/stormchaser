import { describe, expect, it } from "vitest";
import {
  forecastPullsFromHistoricalResponse,
  groupForecastPullsByLocalDay,
  RECONCILIATION_BACKTEST_MODELS,
} from "@/lib/backtest/reconciliation-forecast-archive";
import type { OpenMeteoHourlyResponse } from "@/lib/ingestion/open-meteo";
import type { ForecastPull } from "@/lib/db/types";

describe("RECONCILIATION_BACKTEST_MODELS", () => {
  it("excludes hrrr, which has no historical-forecast-api coverage", () => {
    expect(RECONCILIATION_BACKTEST_MODELS).not.toContain("hrrr");
  });

  it("includes the models with a configured historical-forecast id", () => {
    expect(RECONCILIATION_BACKTEST_MODELS).toEqual(expect.arrayContaining(["gfs", "icon", "ecmwf", "gem"]));
  });
});

describe("forecastPullsFromHistoricalResponse", () => {
  it("converts hourly archive rows into ForecastPull-shaped rows for the given model", () => {
    const response: OpenMeteoHourlyResponse["hourly"] = {
      time: ["2023-01-15T00:00", "2023-01-15T01:00"],
      temperature_2m: [-6, -7],
      precipitation: [2, 3],
      cloud_cover: [90, 85],
      wind_speed_10m: [15, 18],
      wind_gusts_10m: [25, 30],
    };
    const rows = forecastPullsFromHistoricalResponse({ resortId: "r1", model: "gfs", response });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.model_name).toBe("gfs");
    expect(rows[0]!.resort_id).toBe("r1");
    expect(rows[0]!.elevation_band).toBe("mid");
    expect(rows[0]!.temp_c).toBe(-6);
    expect(rows[0]!.swe_mm).toBe(2);
    expect(rows[0]!.wind_speed_kmh).toBe(15);
    expect(rows[0]!.wind_gust_kmh).toBe(25);
    expect(rows[1]!.temp_c).toBe(-7);
  });

  it("uses columnTmaxC so pressure-level data, when present, still wins over surface temp", () => {
    const response: OpenMeteoHourlyResponse["hourly"] = {
      time: ["2023-01-15T00:00"],
      temperature_2m: [-6],
      temperature_850hPa: [-2], // warmer aloft — columnTmaxC should pick the max
      precipitation: [1],
    };
    const rows = forecastPullsFromHistoricalResponse({ resortId: "r1", model: "ecmwf", response });
    expect(rows[0]!.temp_c).toBe(-2);
  });

  it("returns an empty array when the response has no time series", () => {
    expect(forecastPullsFromHistoricalResponse({ resortId: "r1", model: "gfs", response: { time: [] } })).toEqual([]);
  });
});

function row(overrides: Partial<ForecastPull>): ForecastPull {
  return {
    id: "x",
    resort_id: "r",
    model_name: "gfs",
    elevation_band: "mid",
    run_init_time: "2023-01-15T00:00:00Z",
    valid_time: "2023-01-15T00:00:00Z",
    pulled_at: "2023-01-15T00:00:00Z",
    raw_payload: {},
    swe_mm: 1,
    precip_mm: 1,
    temp_c: -5,
    wind_speed_kmh: 10,
    wind_gust_kmh: 20,
    wind_dir_deg: 270,
    freezing_level_m: 1500,
    cloud_cover_pct: 80,
    created_at: "2023-01-15T00:00:00Z",
    ...overrides,
  };
}

describe("groupForecastPullsByLocalDay", () => {
  it("groups rows by local calendar day", () => {
    const rows = [
      row({ valid_time: "2023-01-15T00:00:00Z" }),
      row({ valid_time: "2023-01-15T12:00:00Z" }),
      row({ valid_time: "2023-01-16T00:00:00Z" }),
    ];
    const grouped = groupForecastPullsByLocalDay(rows, "UTC");
    expect(grouped.get("2023-01-15")).toHaveLength(2);
    expect(grouped.get("2023-01-16")).toHaveLength(1);
  });

  it("uses the resort's local timezone, not UTC, for the day boundary", () => {
    // 1am UTC Jan 16 = 6pm Mountain Jan 15.
    const rows = [row({ valid_time: "2023-01-16T01:00:00Z" })];
    const grouped = groupForecastPullsByLocalDay(rows, "America/Denver");
    expect(grouped.has("2023-01-15")).toBe(true);
    expect(grouped.has("2023-01-16")).toBe(false);
  });

  it("returns an empty map for no rows", () => {
    expect(groupForecastPullsByLocalDay([], "UTC").size).toBe(0);
  });
});
