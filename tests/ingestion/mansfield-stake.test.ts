import { describe, expect, it } from "vitest";
import { chunkDateRangeByYear, mmToIn } from "@/lib/ingestion/mansfield-stake";

describe("chunkDateRangeByYear", () => {
  it("returns a single chunk when the range fits within one calendar year", () => {
    expect(chunkDateRangeByYear("2024-01-01", "2024-12-31")).toEqual([{ start: "2024-01-01", end: "2024-12-31" }]);
  });

  it("splits a multi-year range at each calendar-year boundary", () => {
    expect(chunkDateRangeByYear("2022-06-15", "2024-03-10")).toEqual([
      { start: "2022-06-15", end: "2022-12-31" },
      { start: "2023-01-01", end: "2023-12-31" },
      { start: "2024-01-01", end: "2024-03-10" },
    ]);
  });

  it("covers the full Mansfield stake historical range (1954-present) without gaps or overlaps", () => {
    const chunks = chunkDateRangeByYear("1954-11-01", "2026-10-15");
    expect(chunks[0]).toEqual({ start: "1954-11-01", end: "1954-12-31" });
    expect(chunks[chunks.length - 1]).toEqual({ start: "2026-01-01", end: "2026-10-15" });
    expect(chunks.length).toBe(2026 - 1954 + 1);
    for (let i = 1; i < chunks.length; i++) {
      // Each chunk starts exactly the day after the previous one ends —
      // no gap (would silently drop days) and no overlap (would
      // double-count a day's depth change).
      const prevEndYear = Number(chunks[i - 1]!.end.slice(0, 4));
      const thisStartYear = Number(chunks[i]!.start.slice(0, 4));
      expect(thisStartYear).toBe(prevEndYear + 1);
    }
  });

  it("returns a single same-day chunk when start and end dates match", () => {
    expect(chunkDateRangeByYear("2024-03-01", "2024-03-01")).toEqual([{ start: "2024-03-01", end: "2024-03-01" }]);
  });
});

describe("mmToIn", () => {
  it("converts millimeters to inches using the standard 25.4mm/in factor", () => {
    expect(mmToIn(25.4)).toBeCloseTo(1, 10);
    expect(mmToIn(254)).toBeCloseTo(10, 10);
  });

  it("converts zero to zero", () => {
    expect(mmToIn(0)).toBe(0);
  });
});
