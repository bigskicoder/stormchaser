/**
 * A DELIBERATELY PARTIAL table of historical ENSO (El Nino-Southern
 * Oscillation) winter classifications, compiled via WebSearch this session
 * for the Mount Mansfield snow-stake / ENSO correlation research (ROADMAP,
 * requested directly: "pay particular attention to ENSO behavior around
 * the stake as well").
 *
 * WHY THIS IS PARTIAL, NOT THE FULL 1950-PRESENT SERIES: NOAA CPC
 * publishes the authoritative Oceanic Nino Index (ONI) as a full seasonal
 * table back to 1950, but every *.noaa.gov host this session tried —
 * including a direct WebFetch attempt at the raw data file
 * (origin.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt and the
 * www.cpc.ncep.noaa.gov mirror) — returned a DNS resolution failure from
 * this sandbox, the same EGRESS_BLOCKED pattern documented throughout
 * lib/ingestion/ for every other NOAA/NRCS host. WebSearch itself only
 * returned FRAGMENTS of the table, with some early-year values actually
 * disagreeing between NOAA's own ONI versions (v4/v5/v6 use slightly
 * different ERSST base periods) — reconstructing a full 76-season table
 * from search snippets risked exactly the kind of confident-looking but
 * unverified data this project avoids (see kuchera.ts's coefficient
 * history for why that matters).
 *
 * What IS included below: only the handful of STRONG/VERY STRONG ENSO
 * winters this session found independently cross-referenced across
 * multiple sources (Purdue's MRCC climate page, Golden Gate Weather
 * Services' ONI pages, a Minnesota DNR summary) with reasonably consistent
 * peak ONI values — see each entry's own comment for its specific
 * sourcing. This intentionally excludes every weak/moderate event and
 * most individual years, which the search results could not confirm with
 * comparable confidence.
 *
 * STRENGTH THRESHOLDS (consistently cited across sources): weak
 * 0.5-0.9, moderate 1.0-1.4, strong 1.5-1.9, very strong >= 2.0 (El Nino,
 * positive ONI) — same magnitude thresholds mirrored negative for La Nina.
 *
 * To do this properly: replace/extend this table with NOAA CPC's actual
 * published ONI table (a short, stable, easily-pasted-in text table) once
 * you have live network access or can paste it in directly — the analysis
 * functions in lib/analysis/mansfield-enso.ts are built to work with
 * however many seasons this table actually covers, reporting sample sizes
 * honestly rather than assuming full coverage.
 */

export type EnsoPhase = "el-nino" | "la-nina";
export type EnsoStrength = "strong" | "very-strong";

export interface EnsoWinterClassification {
  /** Winter season label = the year the season ENDS in (Jul-Jun convention — see lib/analysis/mansfield-enso.ts's winterSeasonLabel). E.g. the 1982-83 winter is "1983". */
  season: string;
  phase: EnsoPhase;
  strength: EnsoStrength;
  /** Approximate peak 3-month ONI value found this session — NOT independently verified against NOAA's own table; see module header. */
  approxPeakOni: number;
}

export const ENSO_WINTERS: EnsoWinterClassification[] = [
  // El Nino — peak ONI values from this session's WebSearch results
  // (Golden Gate Weather Services' historic ONI pages): Nov-Dec 1982
  // (2.2), Nov-Dec 1997 (2.3), Nov-Dec 2015 (2.6) — the three strongest
  // El Nino events on record per that source.
  { season: "1983", phase: "el-nino", strength: "very-strong", approxPeakOni: 2.2 },
  { season: "1998", phase: "el-nino", strength: "very-strong", approxPeakOni: 2.3 },
  { season: "2016", phase: "el-nino", strength: "very-strong", approxPeakOni: 2.6 },
  // 2023-24 explicitly named as added to Golden Gate's "strong" El Nino
  // list in a later update found this session — exact peak ONI value not
  // independently confirmed, so left approximate at the strong/1.5
  // threshold rather than guessed more precisely.
  { season: "2024", phase: "el-nino", strength: "strong", approxPeakOni: 1.5 },

  // La Nina — peak ONI values from the same source: Nov-Dec 1973 (-2.0),
  // Jan 1974 (-1.9, same event), Nov-Dec 1988 (-1.8).
  { season: "1974", phase: "la-nina", strength: "very-strong", approxPeakOni: -2.0 },
  { season: "1989", phase: "la-nina", strength: "strong", approxPeakOni: -1.8 },
];
