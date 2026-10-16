import { describe, expect, it } from "vitest";
import {
  buildHistoricalForecastUrl,
  buildHistoricalWeatherUrl,
  HISTORICAL_FORECAST_MODEL_IDS,
  HISTORICAL_FORECAST_UNAVAILABLE_MODELS,
  HISTORICAL_WEATHER_HOURLY_VARIABLES,
} from "@/lib/ingestion/open-meteo-historical";
import type { Resort } from "@/lib/db/types";

const resort: Resort = {
  id: "11111111-1111-1111-1111-111111111111",
  slug: "test-resort",
  name: "Test Resort",
  pass_affiliation: "ikon",
  state: "UT",
  lat: 40.5883,
  lng: -111.6386,
  elevation_base_m: 2600,
  elevation_mid_m: 2900,
  elevation_summit_m: 3215,
  elevation_checked_at: null,
  elevation_check_flag: false,
  elevation_check_notes: null,
  timezone: "America/Denver",
  slr_calibration_multiplier: 1.0,
  snotel_station_triplet: null,
  snotel_station_distance_km: null,
  snotel_resolved_at: null,
  nws_grid_id: null,
  nws_grid_x: null,
  nws_grid_y: null,
  nws_resolved_at: null,
  ghcnd_station_id: null,
  webcam_url: null,
  active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("buildHistoricalWeatherUrl", () => {
  it("points at the archive host with lat/lng/elevation/date range", () => {
    const url = new URL(
      buildHistoricalWeatherUrl({ resort, elevationM: 2900, startDate: "2015-01-01", endDate: "2015-01-31" })
    );
    expect(url.hostname).toBe("archive-api.open-meteo.com");
    expect(url.pathname).toBe("/v1/archive");
    expect(url.searchParams.get("latitude")).toBe("40.5883");
    expect(url.searchParams.get("longitude")).toBe("-111.6386");
    expect(url.searchParams.get("elevation")).toBe("2900");
    expect(url.searchParams.get("start_date")).toBe("2015-01-01");
    expect(url.searchParams.get("end_date")).toBe("2015-01-31");
    expect(url.searchParams.get("hourly")).toBe(HISTORICAL_WEATHER_HOURLY_VARIABLES.join(","));
  });

  it("truncates a full timestamp down to just the date", () => {
    const url = new URL(
      buildHistoricalWeatherUrl({
        resort,
        elevationM: 2900,
        startDate: "2015-01-01T00:00:00Z",
        endDate: "2015-01-31T23:59:59Z",
      })
    );
    expect(url.searchParams.get("start_date")).toBe("2015-01-01");
    expect(url.searchParams.get("end_date")).toBe("2015-01-31");
  });
});

describe("buildHistoricalForecastUrl", () => {
  it("points at the historical-forecast host with the model's id in the models param", () => {
    const url = new URL(
      buildHistoricalForecastUrl({
        resort,
        model: "gfs",
        elevationM: 2900,
        startDate: "2023-01-01",
        endDate: "2023-01-31",
        hourlyVariables: ["temperature_2m", "precipitation"],
      })
    );
    expect(url.hostname).toBe("historical-forecast-api.open-meteo.com");
    expect(url.pathname).toBe("/v1/forecast");
    expect(url.searchParams.get("models")).toBe(HISTORICAL_FORECAST_MODEL_IDS.gfs);
    expect(url.searchParams.get("hourly")).toBe("temperature_2m,precipitation");
  });

  it("throws for a model with no configured historical-forecast model id", () => {
    expect(() =>
      buildHistoricalForecastUrl({
        resort,
        model: "hrrr",
        elevationM: 2900,
        startDate: "2023-01-01",
        endDate: "2023-01-31",
        hourlyVariables: ["temperature_2m"],
      })
    ).toThrow();
  });

  it("excludes hrrr from the models this backtest can request, matching its unavailable-models list", () => {
    expect(HISTORICAL_FORECAST_UNAVAILABLE_MODELS).toContain("hrrr");
    expect(HISTORICAL_FORECAST_MODEL_IDS.hrrr).toBeUndefined();
  });
});
