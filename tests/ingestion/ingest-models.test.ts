import { describe, expect, it } from "vitest";
import { ensembleDailyRows, hourlyModelsForUtcHour } from "@/lib/ingestion/ingest-models";

describe("hourlyModelsForUtcHour", () => {
  it("pulls GFS once per 6-hour GFS cycle and HRRR every hour", () => {
    const withGfs = Array.from({ length: 24 }, (_, h) => h).filter((h) => hourlyModelsForUtcHour(h).includes("gfs"));
    expect(withGfs).toEqual([5, 11, 17, 23]);
    for (let h = 0; h < 24; h++) expect(hourlyModelsForUtcHour(h)).toContain("hrrr");
  });
});

describe("ensembleDailyRows", () => {
  const resort = { id: "r1", timezone: "America/Denver" };

  it("sums each member over the resort's local day and stamps the local-midnight start", () => {
    // 05:00-07:00 UTC on Jan 15 straddles Denver's local midnight (07:00 UTC).
    const rows = ensembleDailyRows({
      resort,
      band: "mid",
      runInitTime: "2026-01-15T00:00:00.000Z",
      response: {
        hourly: {
          time: ["2026-01-15T05:00", "2026-01-15T06:00", "2026-01-15T07:00", "2026-01-15T08:00"],
          precipitation: [1, 2, 3, null],
          precipitation_member01: [0.5, 0.5, 4, 1],
          temperature_2m: [-5, -5, -6, -6],
        },
      },
    });
    const byKey = Object.fromEntries(rows.map((r) => [`${r.member_id}@${r.valid_time}`, r.swe_mm]));
    expect(byKey).toEqual({
      "0@2026-01-14T07:00:00.000Z": 3,
      "0@2026-01-15T07:00:00.000Z": 3,
      "1@2026-01-14T07:00:00.000Z": 1,
      "1@2026-01-15T07:00:00.000Z": 5,
    });
  });

  it("writes nothing for a member with no values", () => {
    const rows = ensembleDailyRows({
      resort,
      band: "mid",
      runInitTime: "2026-01-15T00:00:00.000Z",
      response: { hourly: { time: ["2026-01-15T05:00"], precipitation_member02: [null] } },
    });
    expect(rows).toEqual([]);
  });
});
