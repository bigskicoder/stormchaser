/**
 * One-time (or re-runnable) seed script: upserts RESORTS_SEED into the
 * `resorts` table, then runs the elevation onboarding check (section 2.1a)
 * and SNOTEL station resolution (section 2.2) for every row, then ensures a
 * baseline model_versions row exists and is active (ROADMAP Phase C model
 * versioning) so live scoring and backtests have a real model_version_id to
 * tag their output with from the very first run, rather than relying on the
 * DEFAULT_SCORING_CONFIG fallback indefinitely.
 *
 * Usage: npm run seed:resorts
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env.
 */

import { getServiceDb } from "../src/lib/db/client";
import { RESORTS_SEED } from "../src/lib/config/resorts-seed";
import { runElevationCheckForAllResorts } from "../src/lib/ingestion/elevation";
import { resolveSnotelStationsForAllResorts } from "../src/lib/ingestion/snotel";
import { resolveNwsGridpointsForAllResorts } from "../src/lib/ingestion/nws";
import { backfillMansfieldStakeForResort } from "../src/lib/ingestion/mansfield-stake";
import { createBaselineVersionIfNoneExists } from "../src/lib/model-versions/create";
import type { Resort } from "../src/lib/db/types";

/** The Mansfield stake's own daily record starts here (see resorts-seed.ts's Stowe entry) — pulling the full history, not just a rolling window, is what makes a real ENSO-correlation analysis possible (scripts/analyze-mansfield-enso.ts). */
const MANSFIELD_HISTORY_START_DATE = "1954-11-01";

async function main() {
  const db = getServiceDb();

  console.log(`Upserting ${RESORTS_SEED.length} resorts...`);
  const { error } = await db.from("resorts").upsert(
    RESORTS_SEED.map((r) => ({
      slug: r.slug,
      name: r.name,
      pass_affiliation: r.pass_affiliation,
      state: r.state,
      lat: r.lat,
      lng: r.lng,
      elevation_base_m: r.elevation_base_m,
      elevation_mid_m: r.elevation_mid_m,
      elevation_summit_m: r.elevation_summit_m,
      timezone: r.timezone,
      ghcnd_station_id: r.ghcnd_station_id ?? null,
      active: true,
    })),
    { onConflict: "slug" }
  );
  if (error) throw error;
  console.log("Resorts upserted.");

  console.log("Running elevation onboarding check against Open-Meteo DEM...");
  try {
    const results = await runElevationCheckForAllResorts();
    const flagged = results.filter((r) => r.flagged);
    console.log(`Elevation check complete: ${results.length} checked, ${flagged.length} flagged for review.`);
    for (const f of flagged) console.log(`  FLAGGED: ${f.resortSlug} — ${f.notes}`);
  } catch (err) {
    console.warn("Elevation check failed (network unavailable?) — resorts remain unflagged:", (err as Error).message);
  }

  console.log("Resolving nearest SNOTEL station per resort...");
  try {
    await resolveSnotelStationsForAllResorts();
    console.log("SNOTEL station resolution complete.");
  } catch (err) {
    console.warn("SNOTEL resolution failed (network unavailable?):", (err as Error).message);
  }

  console.log("Resolving NWS gridpoints per resort (public-baseline comparison pipeline)...");
  try {
    await resolveNwsGridpointsForAllResorts();
    console.log("NWS gridpoint resolution complete.");
  } catch (err) {
    console.warn("NWS gridpoint resolution failed (network unavailable?):", (err as Error).message);
  }

  console.log("Backfilling Mount Mansfield snow stake history for Stowe (if ghcnd_station_id resolved)...");
  try {
    const { data, error } = await db.from("resorts").select("*").not("ghcnd_station_id", "is", null);
    if (error) throw error;
    const mansfieldResorts = (data ?? []) as Resort[];
    const endDate = new Date().toISOString().slice(0, 10);
    for (const resort of mansfieldResorts) {
      const result = await backfillMansfieldStakeForResort(resort, MANSFIELD_HISTORY_START_DATE, endDate);
      if (result.error) console.warn(`  ${resort.slug}: FAILED — ${result.error}`);
      else if (result.skipped) console.warn(`  ${resort.slug}: no data returned — verify ghcnd_station_id (see resorts-seed.ts's flagged caveat)`);
      else console.log(`  ${resort.slug}: ${result.written} days backfilled since ${MANSFIELD_HISTORY_START_DATE}`);
    }
  } catch (err) {
    console.warn("Mansfield stake backfill failed (network unavailable, or NCEI_CDO_TOKEN not set?):", (err as Error).message);
  }

  console.log("Seeding baseline model version (if none exists)...");
  const baseline = await createBaselineVersionIfNoneExists();
  console.log(`Active model version: "${baseline.name}" (${baseline.id}).`);

  console.log("Seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
