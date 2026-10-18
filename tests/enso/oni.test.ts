import { describe, expect, it } from "vitest";
import { EnsoPhaseLookup, djfYearForDate, parseOniText, phaseFromAnomaly } from "@/lib/enso/oni";

// Shape of NOAA's file; the numbers are test fixtures, not real ONI values.
const SAMPLE = `SEAS  YR   TOTAL   ANOM
  DJF 2024  28.10   1.20
  JFM 2024  27.90   0.90
  DJF 2025  25.90  -0.70
  JFM 2025  26.20  -0.40
  SON 2025  26.00  -0.60
  OND 2025  25.90  -0.55
garbage line
`;

describe("parseOniText", () => {
  it("reads season rows and skips the header and junk", () => {
    const rows = parseOniText(SAMPLE);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual({ year: 2024, season: "DJF", anomaly_c: 1.2 });
  });
});

describe("phaseFromAnomaly", () => {
  it("uses the +/-0.5 C threshold inclusively", () => {
    expect(phaseFromAnomaly(0.5)).toBe("el_nino");
    expect(phaseFromAnomaly(-0.5)).toBe("la_nina");
    expect(phaseFromAnomaly(0.49)).toBe("neutral");
  });
});

describe("djfYearForDate", () => {
  it("maps July-June winters onto the DJF year", () => {
    expect(djfYearForDate("2025-11-15")).toBe(2026);
    expect(djfYearForDate("2026-02-01")).toBe(2026);
    expect(djfYearForDate("2026-06-30")).toBe(2026);
    expect(djfYearForDate("2026-07-01")).toBe(2027);
  });
});

describe("EnsoPhaseLookup", () => {
  const lookup = new EnsoPhaseLookup(parseOniText(SAMPLE));

  it("labels a whole winter by its DJF value", () => {
    expect(lookup.phaseForDate("2023-12-20")).toBe("el_nino");
    expect(lookup.phaseForDate("2025-03-01")).toBe("la_nina");
  });

  it("falls back to the latest published season for the current winter", () => {
    // DJF 2026 isn't in the table; OND 2025 (-0.55) is the newest season by December 2025.
    expect(lookup.phaseForDate("2025-12-15")).toBe("la_nina");
  });

  it("does not use data from after the date it's asked about", () => {
    // In October 2025 the newest season that could exist is ASO; SON/OND are in the future.
    expect(lookup.phaseForDate("2025-10-05")).toBe("neutral");
  });

  it("returns null outside the table's coverage", () => {
    expect(lookup.phaseForDate("1949-01-01")).toBeNull();
    expect(new EnsoPhaseLookup([]).phaseForDate("2025-01-01")).toBeNull();
  });
});
