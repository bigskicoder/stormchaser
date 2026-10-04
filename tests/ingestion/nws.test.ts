import { describe, expect, it } from "vitest";
import { expandSnowfallSeriesToDailyTotalsIn, parseIso8601Duration } from "@/lib/ingestion/nws";

describe("parseIso8601Duration", () => {
  it("parses hour-only durations", () => {
    expect(parseIso8601Duration("PT6H")).toBe(6 * 60 * 60 * 1000);
    expect(parseIso8601Duration("PT1H")).toBe(60 * 60 * 1000);
  });

  it("parses day durations", () => {
    expect(parseIso8601Duration("P1D")).toBe(24 * 60 * 60 * 1000);
  });

  it("parses combined day+hour+minute durations", () => {
    expect(parseIso8601Duration("P1DT2H30M")).toBe((24 + 2) * 60 * 60 * 1000 + 30 * 60 * 1000);
  });

  it("throws on an unrecognized format", () => {
    expect(() => parseIso8601Duration("not-a-duration")).toThrow();
  });
});

describe("expandSnowfallSeriesToDailyTotalsIn", () => {
  it("converts a single same-day window from mm to inches (UTC)", () => {
    const result = expandSnowfallSeriesToDailyTotalsIn([{ validTime: "2026-01-15T06:00:00+00:00/PT6H", value: 25.4 }], "UTC");
    expect(result["2026-01-15"]).toBeCloseTo(1, 5);
  });

  it("apportions a window straddling UTC midnight across both UTC days when timeZone is UTC", () => {
    // 22:00 Jan 15 -> 04:00 Jan 16 (PT6H): 2h in the 15th, 4h in the 16th.
    const result = expandSnowfallSeriesToDailyTotalsIn([{ validTime: "2026-01-15T22:00:00+00:00/PT6H", value: 25.4 }], "UTC");
    const totalMm = 25.4;
    expect(result["2026-01-15"]).toBeCloseTo((totalMm * (2 / 6)) / 25.4, 5);
    expect(result["2026-01-16"]).toBeCloseTo((totalMm * (4 / 6)) / 25.4, 5);
  });

  it("uses the resort's LOCAL day boundary, not UTC — the whole point of this fix", () => {
    // 22:00-04:00 UTC falls entirely within one Denver LOCAL day (MST,
    // UTC-7): 22:00 UTC Jan 15 = 15:00 local Jan 15, and 04:00 UTC Jan 16 =
    // 21:00 local Jan 15 — no UTC-midnight split, so unlike the UTC case
    // above, this must land as a single undivided day in Denver's frame.
    const result = expandSnowfallSeriesToDailyTotalsIn(
      [{ validTime: "2026-01-15T22:00:00+00:00/PT6H", value: 25.4 }],
      "America/Denver"
    );
    expect(Object.keys(result)).toEqual(["2026-01-15"]);
    expect(result["2026-01-15"]).toBeCloseTo(1, 5);
  });

  it("splits at the LOCAL day boundary when a window actually straddles it in that timezone", () => {
    // 23:00 Jan 15 local Denver -> 05:00 Jan 16 local Denver, i.e.
    // 06:00 UTC Jan 16 -> 12:00 UTC Jan 16 in MST (UTC-7): 1h before local
    // midnight, 5h after.
    const result = expandSnowfallSeriesToDailyTotalsIn(
      [{ validTime: "2026-01-16T06:00:00+00:00/PT6H", value: 24 }],
      "America/Denver"
    );
    expect(result["2026-01-15"]).toBeCloseTo((24 * (1 / 6)) / 25.4, 5);
    expect(result["2026-01-16"]).toBeCloseTo((24 * (5 / 6)) / 25.4, 5);
  });

  it("sums multiple windows landing on the same day", () => {
    const result = expandSnowfallSeriesToDailyTotalsIn(
      [
        { validTime: "2026-01-15T00:00:00+00:00/PT6H", value: 12.7 },
        { validTime: "2026-01-15T06:00:00+00:00/PT6H", value: 12.7 },
      ],
      "UTC"
    );
    expect(result["2026-01-15"]).toBeCloseTo(1, 5);
  });

  it("skips null values without throwing", () => {
    const result = expandSnowfallSeriesToDailyTotalsIn(
      [
        { validTime: "2026-01-15T00:00:00+00:00/PT6H", value: null },
        { validTime: "2026-01-15T06:00:00+00:00/PT6H", value: 25.4 },
      ],
      "UTC"
    );
    expect(Object.keys(result)).toEqual(["2026-01-15"]);
    expect(result["2026-01-15"]).toBeCloseTo(1, 5);
  });

  it("returns an empty object for an empty series", () => {
    expect(expandSnowfallSeriesToDailyTotalsIn([], "UTC")).toEqual({});
  });
});
