import { describe, expect, it } from "vitest";
import { waterYearChunksNewestFirst } from "@/lib/backtest/water-year-chunks";

describe("waterYearChunksNewestFirst", () => {
  it("starts with the current water year so far, then whole water years overlapping by a day", () => {
    const chunks = waterYearChunksNewestFirst(2, new Date("2026-10-18T12:00:00Z"));
    expect(chunks).toEqual([
      ["2026-09-30", "2026-10-11"],
      ["2025-09-30", "2026-09-30"],
      ["2024-09-30", "2025-09-30"],
    ]);
  });

  it("keeps finished water years' dates the same from one day to the next, so progress keys match", () => {
    const a = waterYearChunksNewestFirst(3, new Date("2026-10-18T12:00:00Z"));
    const b = waterYearChunksNewestFirst(3, new Date("2026-10-19T12:00:00Z"));
    expect(b.slice(1)).toEqual(a.slice(1));
  });

  it("caps the previous water year at 7 days ago and skips an empty current one early in October", () => {
    const chunks = waterYearChunksNewestFirst(1, new Date("2026-10-03T12:00:00Z"));
    expect(chunks).toEqual([["2025-09-30", "2026-09-26"]]);
  });
});
