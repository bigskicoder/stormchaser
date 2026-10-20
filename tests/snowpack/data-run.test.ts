import { describe, expect, it } from "vitest";
import { buildWinters, forecastHoursToDays, inScoringSeason } from "@/lib/snowpack/data";
import { paramsForResort, seasonDays } from "@/lib/snowpack/run";
import { DEFAULT_SNOWPACK_PARAMS, type SnowpackDay } from "@/lib/snowpack/model";
import type { Resort } from "@/lib/db/types";

function day(date: string, extra: Partial<SnowpackDay> = {}): SnowpackDay {
  return { date, precipMm: 0, tMeanC: -5, tMinC: -10, tMaxC: 0, rhPct: 70, windMs: 3, pressureHpa: 720, ...extra };
}
function range(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

describe("buildWinters", () => {
  it("keeps only water years with every day from Oct 1 to Jun 30", () => {
    const full = range("2019-10-01", "2020-09-30").map((d) => day(d));
    const holey = range("2020-10-01", "2021-09-30")
      .filter((d) => d !== "2021-02-14")
      .map((d) => day(d));
    const ws = buildWinters([...full, ...holey], [{ date: "2020-01-15", sweMm: 200, depthCm: 80 }]);
    expect(ws.map((w) => w.waterYear)).toEqual([2020]);
    expect(ws[0]!.days).toHaveLength(366);
    expect(ws[0]!.obs).toHaveLength(1);
  });
});

describe("inScoringSeason", () => {
  it("scores November through June only", () => {
    expect(inScoringSeason("2020-11-01")).toBe(true);
    expect(inScoringSeason("2020-06-30")).toBe(true);
    expect(inScoringSeason("2020-07-15")).toBe(false);
    expect(inScoringSeason("2020-10-15")).toBe(false);
  });
});

describe("forecastHoursToDays", () => {
  it("builds each model's local day, then averages the models", () => {
    const hours = Array.from({ length: 24 }, (_, h) => h).flatMap((h) => {
      const t = new Date(Date.UTC(2026, 11, 5, 7 + h)).toISOString(); // Denver local day Dec 5
      return [
        { model_name: "gfs", valid_time: t, swe_mm: 1, temp_2m_c: -4, wind_speed_kmh: 36 },
        { model_name: "ecmwf", valid_time: t, swe_mm: 0.5, temp_2m_c: -6, wind_speed_kmh: 18 },
      ];
    });
    const [d] = forecastHoursToDays(hours, { timeZone: "America/Denver", rhPct: 80, pressureHpa: 700 });
    expect(d!.date).toBe("2026-12-05");
    expect(d!.precipMm).toBeCloseTo(18);
    expect(d!.tMeanC).toBeCloseTo(-5);
    expect(d!.windMs).toBeCloseTo(7.5);
  });

  it("drops a model-day with too few hours rather than reading a partial day as a whole one", () => {
    const hours = [{ model_name: "hrrr", valid_time: "2026-12-05T12:00:00Z", swe_mm: 5, temp_2m_c: -3, wind_speed_kmh: 10 }];
    expect(forecastHoursToDays(hours, { timeZone: "UTC", rhPct: 80, pressureHpa: 700 })).toEqual([]);
  });
});

describe("seasonDays", () => {
  it("uses ERA5 where it has the day, forecast after, and stops at a gap", () => {
    const era5 = range("2026-10-01", "2026-10-13").map((d) => day(d));
    const forecast = [...range("2026-10-12", "2026-10-20"), ...range("2026-10-22", "2026-10-25")].map((d) => day(d, { precipMm: 9 }));
    const out = seasonDays(2027, era5, forecast, "2026-10-30");
    expect(out[0]!.date).toBe("2026-10-01");
    expect(out.find((d) => d.date === "2026-10-12")!.precipMm).toBe(0);
    expect(out.find((d) => d.date === "2026-10-14")!.precipMm).toBe(9);
    expect(out[out.length - 1]!.date).toBe("2026-10-20");
  });
});

describe("paramsForResort", () => {
  const resort = { snotel_station_triplet: null, ghcnd_station_id: null } as Resort;
  it("runs uncalibrated defaults with no station, fitted params when they pass, and nothing when they fail", () => {
    expect(paramsForResort(resort, undefined)).toEqual({ params: DEFAULT_SNOWPACK_PARAMS, calibrated: false });
    const withStation = { ...resort, snotel_station_triplet: "1:UT:SNTL" } as Resort;
    expect(paramsForResort(withStation, undefined)).toBeNull();
    const fitted = { ...DEFAULT_SNOWPACK_PARAMS, scf: 1.25 };
    expect(paramsForResort(withStation, { resort_id: "x", params: fitted, passes: true })).toEqual({ params: fitted, calibrated: true });
    expect(paramsForResort(withStation, { resort_id: "x", params: fitted, passes: false })).toBeNull();
  });
});
