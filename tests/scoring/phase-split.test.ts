import { describe, expect, it } from "vitest";
import { hourlyPhaseSplit } from "@/lib/scoring/phase-split";
import { getSlrStrategy } from "@/lib/scoring/slr";
import type { ForecastPull } from "@/lib/db/types";

function hour(h: number, tempC: number | null, sweMm: number): ForecastPull {
  const t = `2026-12-05T${String(h).padStart(2, "0")}:00:00.000Z`;
  return {
    id: `h${h}`,
    resort_id: "r1",
    model_name: "ecmwf",
    elevation_band: "mid",
    run_init_time: "2026-12-04T00:00:00.000Z",
    valid_time: t,
    pulled_at: t,
    raw_payload: {},
    swe_mm: sweMm,
    precip_mm: sweMm,
    temp_c: tempC,
    wind_speed_kmh: null,
    wind_gust_kmh: null,
    wind_dir_deg: null,
    freezing_level_m: null,
    cloud_cover_pct: null,
    created_at: t,
  } as ForecastPull;
}

const strategy = getSlrStrategy("fixed-ratio");
const split = (rows: ForecastPull[]) => hourlyPhaseSplit({ rows, strategy, calibrationMultiplier: 1, avgWindSpeedKmh: null });

describe("hourlyPhaseSplit", () => {
  it("splits a day that starts as rain and turns to snow, and marks the changeover hour", () => {
    const r = split([hour(10, 2, 2), hour(11, 1, 2), hour(12, -1, 3), hour(13, -3, 3)])!;
    expect(r.snowFraction).toBeCloseTo(0.6);
    expect(r.snowRatio).toBe(12);
    expect(r.phaseChange).toBe("rain_to_snow");
    expect(r.phaseChangeAt).toBe("2026-12-05T12:00:00.000Z");
  });

  it("reports snow turning to rain", () => {
    const r = split([hour(8, -4, 1), hour(9, -2, 1), hour(10, 1, 1), hour(11, 3, 1)])!;
    expect(r.snowFraction).toBe(0.5);
    expect(r.phaseChange).toBe("snow_to_rain");
    expect(r.phaseChangeAt).toBe("2026-12-05T10:00:00.000Z");
  });

  it("calls a day that wobbles and ends where it started a mix with no changeover", () => {
    const r = split([hour(8, -2, 1), hour(9, 1, 1), hour(10, -2, 1)])!;
    expect(r.snowFraction).toBeCloseTo(2 / 3);
    expect(r.phaseChange).toBeNull();
  });

  it("ignores trace hours when finding the changeover", () => {
    const r = split([hour(8, 3, 0.05), hour(9, -2, 2), hour(10, -3, 2)])!;
    expect(r.phaseChange).toBeNull();
    expect(r.snowFraction).toBeGreaterThan(0.98);
  });

  it("returns null when the model has no precipitation that day", () => {
    expect(split([hour(8, -5, 0), hour(9, null, 1)])).toBeNull();
  });
});
