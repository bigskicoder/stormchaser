/**
 * One-time (or re-runnable) seed script: upserts RESORTS_SEED into the
 * `resorts` table, then runs the elevation onboarding check (section 2.1a)
 * and SNOTEL station resolution (section 2.2) for every row.
 *
 * Usage: npm run seed:resorts
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env.
 */

import { getServiceDb } from "../src/lib/db/client";
import { RESORTS_SEED } from "../src/lib/config/resorts-seed";
import { runElevationCheckForAllResorts } from "../src/lib/ingestion/elevation";
import { resolveSnotelStationsForAllResorts } from "../src/lib/ingestion/snotel";

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

  console.log("Seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
