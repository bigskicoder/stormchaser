/**
 * Fits the natural snowpack model to every resort with a reference station
 * and saves the parameters and held-out scores to snowpack_params (see
 * lib/snowpack/fit.ts for the method and the bar). Run by the "Snowpack
 * fit" GitHub workflow; the sandbox that writes this code can't reach the
 * database or NRCS directly.
 *
 *   npx tsx scripts/snowpack-fit.ts [--resort=alta]
 *
 * Station elevation comes from the NRCS station list (`elevation`, feet).
 * That field name isn't verified against a live response from here; when
 * it's missing the fit runs without the lapse-rate shift and says so.
 */

import { getServiceDb } from "../src/lib/db/client";
import type { Resort } from "../src/lib/db/types";
import { fitResortSnowpack, saveSnowpackFit } from "../src/lib/snowpack/run";

const AWDB_STATIONS_URL = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/stations?networkCds=SNTL&activeOnly=false";

async function stationElevations(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const res = await fetch(AWDB_STATIONS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const stations = (await res.json()) as Array<{ stationTriplet: string; elevation?: number }>;
    for (const s of stations) if (typeof s.elevation === "number") out.set(s.stationTriplet, s.elevation * 0.3048);
    console.log(`NRCS station list: ${stations.length} stations, ${out.size} with an elevation.`);
  } catch (err) {
    console.log(`Couldn't read station elevations (${(err as Error).message}); fitting without the lapse-rate shift.`);
  }
  return out;
}

async function main() {
  const only = process.argv.find((a) => a.startsWith("--resort="))?.split("=")[1] ?? null;
  const db = getServiceDb();
  let q = db.from("resorts").select("*").eq("active", true).order("slug");
  if (only) q = q.eq("slug", only);
  const { data, error } = await q;
  if (error) throw error;
  const resorts = ((data ?? []) as Resort[]).filter((r) => r.snotel_station_triplet || r.ghcnd_station_id);
  const elevations = await stationElevations();
  console.log(`Fitting ${resorts.length} resorts with a reference station.\n`);

  let passed = 0;
  for (const resort of resorts) {
    const started = Date.now();
    const stationElevationM = resort.snotel_station_triplet ? elevations.get(resort.snotel_station_triplet) ?? null : null;
    try {
      const result = await fitResortSnowpack(resort, stationElevationM);
      if (!result.fit) {
        console.log(`${resort.slug}: not enough complete winters with station readings (${result.winters}); skipped.`);
        continue;
      }
      await saveSnowpackFit(resort, { fit: result.fit, winters: result.winters, weatherElevationM: result.weatherElevationM }, stationElevationM);
      const h = result.fit.heldOut;
      if (result.fit.passes) passed += 1;
      console.log(
        `${resort.slug}: ${result.fit.passes ? "PASS" : "fail"} | ${result.winters} winters | held-out SWE NSE ${h.sweNse?.toFixed(3) ?? "n/a"}, ` +
          `peak err ${h.medianPeakErrorPct?.toFixed(1) ?? "n/a"}%, melt-out err ${h.medianMeltOutErrorDays?.toFixed(0) ?? "n/a"} d (bias peak ${h.medianPeakBiasPct?.toFixed(0) ?? "n/a"}%, melt-out ${h.medianMeltOutBiasDays?.toFixed(0) ?? "n/a"} d), ` +
          `depth NSE ${h.depthNse?.toFixed(3) ?? "n/a"} | ${result.fit.failedChecks.join("; ") || "all checks met"} | ` +
          `params ${JSON.stringify(result.fit.params, (_, v) => (typeof v === "number" ? Number(v.toPrecision(3)) : v))} | ` +
          `station elev ${stationElevationM?.toFixed(0) ?? "?"} m | ${((Date.now() - started) / 1000).toFixed(0)} s`
      );
    } catch (err) {
      console.log(`${resort.slug}: error ${(err as Error).message}`);
    }
  }
  console.log(`\n${passed} of ${resorts.length} resorts clear the bar.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
