/**
 * Operator-run research script: correlates the Mount Mansfield snow
 * stake's real historical record (lib/ingestion/mansfield-stake.ts) against
 * known strong/very-strong ENSO winters (lib/config/enso-winters.ts) —
 * requested directly: "pay particular attention to ENSO behavior around
 * the stake as well." A read-only analysis over already-ingested data, not
 * a live pull — run `npm run seed:resorts` (or re-run the Mansfield
 * backfill directly) first so snotel_actuals actually has history to
 * analyze.
 *
 * Usage:
 *   npm run analyze:mansfield-enso
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env.
 * No live network calls of its own — reads from Postgres only.
 *
 * IMPORTANT — read before trusting the output: lib/config/enso-winters.ts
 * is a DELIBERATELY PARTIAL table (a handful of well-documented ENSO
 * extremes, not NOAA's full 1950-present series — see that file's header
 * for exactly why). This script reports real, honestly-computed statistics
 * over whatever data actually matches, but with sample sizes this small
 * (typically a handful of seasons per category), treat every number here
 * as illustrative, not a statistically powered finding. It is explicitly
 * NOT wired into live scoring — see ROADMAP.md.
 */

import { getServiceDb } from "../src/lib/db/client";
import { aggregateSeasonalSnowfall, summarizeByEnsoCategory } from "../src/lib/analysis/mansfield-enso";
import { ENSO_WINTERS } from "../src/lib/config/enso-winters";

async function main() {
  const db = getServiceDb();

  const { data: resort, error: resortError } = await db.from("resorts").select("id, name").eq("slug", "stowe").maybeSingle();
  if (resortError) throw resortError;
  if (!resort) {
    console.error('No resort with slug "stowe" found — run npm run seed:resorts first.');
    process.exit(1);
  }

  const { data: rows, error: rowsError } = await db
    .from("snotel_actuals")
    .select("date, observed_depth_change_in")
    .eq("resort_id", resort.id)
    .eq("source", "ghcnd")
    .order("date", { ascending: true });
  if (rowsError) throw rowsError;

  if (!rows || rows.length === 0) {
    console.log(
      "No Mansfield stake (source='ghcnd') data found for Stowe yet.\n" +
        "Run npm run seed:resorts (requires NCEI_CDO_TOKEN) to backfill the full 1954-present history first."
    );
    return;
  }

  console.log(`Loaded ${rows.length} daily Mansfield stake readings for Stowe.`);

  const seasonalTotals = aggregateSeasonalSnowfall(
    rows.map((r) => ({ date: r.date as string, changeIn: r.observed_depth_change_in as number | null }))
  );
  console.log(`Covers ${seasonalTotals.length} distinct winter seasons (Jul-Jun, labeled by ending year).\n`);

  const summaries = summarizeByEnsoCategory(seasonalTotals);

  console.log(`ENSO classification table: ${ENSO_WINTERS.length} flagged strong/very-strong winters (see lib/config/enso-winters.ts — partial, not NOAA's full series).\n`);

  for (const summary of summaries) {
    console.log(`${summary.phase.toUpperCase()} (${summary.strength}):`);
    if (summary.matchedSeasons.length === 0) {
      console.log("  No matching Mansfield data for any classified season in this category.");
    } else {
      for (const s of summary.matchedSeasons) {
        console.log(`  Season ${s.season}: ${s.totalNewSnowIn.toFixed(1)}" total new snow (${s.daysWithData} days with data)`);
      }
      console.log(
        `  Mean: ${summary.meanNewSnowIn!.toFixed(1)}"  Min: ${summary.minNewSnowIn!.toFixed(1)}"  Max: ${summary.maxNewSnowIn!.toFixed(1)}"  (n=${summary.matchedSeasons.length})`
      );
    }
    if (summary.unmatchedSeasons.length > 0) {
      console.log(`  Classified but no Mansfield data yet: ${summary.unmatchedSeasons.join(", ")}`);
    }
    console.log("");
  }

  console.log(
    "Caveat: no neutral/baseline comparison is computed — ENSO_WINTERS only\n" +
      "classifies a handful of known extremes, not every season, so there's no\n" +
      "reliable way to know which unlisted seasons were actually neutral.\n" +
      "Treat every figure above as illustrative given the small per-category\n" +
      "sample sizes, not a statistically powered conclusion."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
