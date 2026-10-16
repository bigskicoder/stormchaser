import { describe, expect, it } from "vitest";
import { aggregateSeasonalSnowfall, summarizeByEnsoCategory, winterSeasonLabel } from "@/lib/analysis/mansfield-enso";

describe("winterSeasonLabel", () => {
  it("labels a December date by the following year (season ending year)", () => {
    expect(winterSeasonLabel("1982-12-15")).toBe("1983");
  });

  it("labels a January-June date by its own year", () => {
    expect(winterSeasonLabel("1974-01-10")).toBe("1974");
    expect(winterSeasonLabel("1983-03-01")).toBe("1983");
  });

  it("treats July 1 as the start of the NEXT season (the Jul-Jun boundary)", () => {
    expect(winterSeasonLabel("2024-06-30")).toBe("2024");
    expect(winterSeasonLabel("2024-07-01")).toBe("2025");
  });

  it("agrees for both the Nov-Dec 1973 and Jan 1974 peaks of the same real La Nina event", () => {
    expect(winterSeasonLabel("1973-12-01")).toBe(winterSeasonLabel("1974-01-15"));
  });
});

describe("aggregateSeasonalSnowfall", () => {
  it("sums changeIn within one season", () => {
    const rows = [
      { date: "2015-12-01", changeIn: 3 },
      { date: "2015-12-15", changeIn: 5 },
      { date: "2016-02-01", changeIn: 2 },
    ];
    expect(aggregateSeasonalSnowfall(rows)).toEqual([{ season: "2016", totalNewSnowIn: 10, daysWithData: 3 }]);
  });

  it("splits rows into separate seasons at the Jul-Jun boundary", () => {
    const rows = [
      { date: "2015-03-01", changeIn: 4 }, // season 2015
      { date: "2015-12-01", changeIn: 6 }, // season 2016
    ];
    const result = aggregateSeasonalSnowfall(rows);
    expect(result).toEqual([
      { season: "2015", totalNewSnowIn: 4, daysWithData: 1 },
      { season: "2016", totalNewSnowIn: 6, daysWithData: 1 },
    ]);
  });

  it("skips null changeIn entries rather than treating them as zero, excluding them from daysWithData", () => {
    const rows = [
      { date: "2016-01-01", changeIn: null },
      { date: "2016-01-02", changeIn: 7 },
    ];
    expect(aggregateSeasonalSnowfall(rows)).toEqual([{ season: "2016", totalNewSnowIn: 7, daysWithData: 1 }]);
  });

  it("returns an empty array for no data", () => {
    expect(aggregateSeasonalSnowfall([])).toEqual([]);
  });

  it("returns seasons sorted ascending", () => {
    const rows = [
      { date: "2020-01-01", changeIn: 1 },
      { date: "2016-01-01", changeIn: 1 },
      { date: "2018-01-01", changeIn: 1 },
    ];
    expect(aggregateSeasonalSnowfall(rows).map((s) => s.season)).toEqual(["2016", "2018", "2020"]);
  });
});

describe("summarizeByEnsoCategory", () => {
  it("matches seasonal totals to classified winters by season label and computes mean/min/max", () => {
    const totals = [
      { season: "1983", totalNewSnowIn: 100, daysWithData: 120 },
      { season: "1998", totalNewSnowIn: 150, daysWithData: 130 },
      { season: "2016", totalNewSnowIn: 200, daysWithData: 140 },
    ];
    const summaries = summarizeByEnsoCategory(totals);
    const veryStrongElNino = summaries.find((s) => s.phase === "el-nino" && s.strength === "very-strong")!;
    expect(veryStrongElNino.matchedSeasons.map((m) => m.season).sort()).toEqual(["1983", "1998", "2016"]);
    expect(veryStrongElNino.meanNewSnowIn).toBeCloseTo((100 + 150 + 200) / 3, 10);
    expect(veryStrongElNino.minNewSnowIn).toBe(100);
    expect(veryStrongElNino.maxNewSnowIn).toBe(200);
  });

  it("reports a classified season with no matching data as unmatched, not as zero snowfall", () => {
    const summaries = summarizeByEnsoCategory([]); // no Mansfield data at all
    const veryStrongElNino = summaries.find((s) => s.phase === "el-nino" && s.strength === "very-strong")!;
    expect(veryStrongElNino.matchedSeasons).toEqual([]);
    expect(veryStrongElNino.unmatchedSeasons.sort()).toEqual(["1983", "1998", "2016"]);
    expect(veryStrongElNino.meanNewSnowIn).toBeNull();
    expect(veryStrongElNino.minNewSnowIn).toBeNull();
    expect(veryStrongElNino.maxNewSnowIn).toBeNull();
  });

  it("does not let an unclassified season leak into any category", () => {
    const totals = [
      { season: "1983", totalNewSnowIn: 100, daysWithData: 1 },
      { season: "2001", totalNewSnowIn: 999, daysWithData: 1 }, // not in ENSO_WINTERS
    ];
    const summaries = summarizeByEnsoCategory(totals);
    const allMatchedSeasons = summaries.flatMap((s) => s.matchedSeasons.map((m) => m.season));
    expect(allMatchedSeasons).not.toContain("2001");
  });

  it("keeps el-nino and la-nina strengths in separate categories", () => {
    const summaries = summarizeByEnsoCategory([]);
    const categories = summaries.map((s) => `${s.phase}:${s.strength}`);
    expect(new Set(categories).size).toBe(categories.length); // no duplicate category keys
    expect(categories).toContain("el-nino:very-strong");
    expect(categories).toContain("la-nina:very-strong");
  });
});
