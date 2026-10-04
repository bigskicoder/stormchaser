import { describe, expect, it } from "vitest";
import {
  bandPointsFor,
  buildEnsembleUrl,
  buildForecastUrl,
  columnTmaxC,
  HOURLY_VARIABLES,
  type OpenMeteoHourlyResponse,
} from "@/lib/ingestion/open-meteo";
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
  active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("bandPointsFor", () => {
  it("returns base/mid/summit bands with the resort's elevations", () => {
    const bands = bandPointsFor(resort);
    expect(bands).toEqual([
      { band: "base", elevationM: 2600 },
      { band: "mid", elevationM: 2900 },
      { band: "summit", elevationM: 3215 },
    ]);
  });
});

describe("buildForecastUrl", () => {
  it("builds the dedicated model path and required params for a non-HRRR model", () => {
    const url = new URL(buildForecastUrl({ baseUrl: "https://api.open-meteo.com", model: "ecmwf", resort, elevationM: 3215 }));
    expect(url.pathname).toBe("/v1/ecmwf");
    expect(url.searchParams.get("latitude")).toBe("40.5883");
    expect(url.searchParams.get("longitude")).toBe("-111.6386");
    expect(url.searchParams.get("elevation")).toBe("3215");
    expect(url.searchParams.get("hourly")).toBe(HOURLY_VARIABLES.join(","));
    expect(url.searchParams.get("forecast_days")).toBe("10");
    expect(url.searchParams.has("past_days")).toBe(false);
    expect(url.searchParams.has("models")).toBe(false);
  });

  it("routes HRRR through the gfs path with an explicit models=hrrr selector", () => {
    const url = new URL(buildForecastUrl({ baseUrl: "https://api.open-meteo.com", model: "hrrr", resort, elevationM: 2600 }));
    expect(url.pathname).toBe("/v1/gfs");
    expect(url.searchParams.get("models")).toBe("hrrr");
  });

  it("rounds elevation to the nearest meter", () => {
    const url = new URL(buildForecastUrl({ baseUrl: "https://api.open-meteo.com", model: "gfs", resort, elevationM: 2899.6 }));
    expect(url.searchParams.get("elevation")).toBe("2900");
  });

  it("includes past_days only when explicitly requested", () => {
    const url = new URL(
      buildForecastUrl({ baseUrl: "https://api.open-meteo.com", model: "gfs", resort, elevationM: 2600, pastDays: 2 })
    );
    expect(url.searchParams.get("past_days")).toBe("2");
  });

  it("strips a trailing slash from baseUrl", () => {
    const url = new URL(buildForecastUrl({ baseUrl: "https://api.open-meteo.com/", model: "gfs", resort, elevationM: 2600 }));
    expect(url.pathname).toBe("/v1/gfs");
  });
});

describe("buildEnsembleUrl", () => {
  it("targets the ensemble endpoint with a models selector and a minimal variable set", () => {
    const url = new URL(buildEnsembleUrl({ baseUrl: "https://api.open-meteo.com", resort, elevationM: 2900 }));
    expect(url.pathname).toBe("/v1/ensemble");
    expect(url.searchParams.get("models")).toBe("gfs_seamless");
    expect(url.searchParams.get("hourly")).toBe("temperature_2m,precipitation");
    expect(url.searchParams.get("elevation")).toBe("2900");
  });
});

describe("columnTmaxC", () => {
  function hourlyFixture(overrides: Partial<OpenMeteoHourlyResponse["hourly"]>): OpenMeteoHourlyResponse["hourly"] {
    return { time: ["2026-01-15T06:00"], ...overrides };
  }

  it("returns the max across surface temp and available pressure-level temps", () => {
    const hourly = hourlyFixture({
      temperature_2m: [-5],
      temperature_850hPa: [-3],
      temperature_700hPa: [-8],
      temperature_500hPa: [-20],
    });
    expect(columnTmaxC(hourly, 0)).toBe(-3);
  });

  it("falls back to surface temp alone when no pressure-level data is present", () => {
    const hourly = hourlyFixture({ temperature_2m: [-6] });
    expect(columnTmaxC(hourly, 0)).toBe(-6);
  });

  it("skips null entries and still returns the max of what's present", () => {
    const hourly = hourlyFixture({
      temperature_2m: [-5],
      temperature_850hPa: [null],
      temperature_700hPa: [-2],
    });
    expect(columnTmaxC(hourly, 0)).toBe(-2);
  });

  it("returns null when every candidate is null/undefined", () => {
    const hourly = hourlyFixture({ temperature_2m: [null] });
    expect(columnTmaxC(hourly, 0)).toBeNull();
  });
});
