/**
 * Operator-run backfill: runs the reanalysis-driven SLR backtest
 * (lib/backtest/slr-reanalysis.ts) across every resort with a resolved
 * SNOTEL station, writing accuracy_log(source='slr_reanalysis_backtest')
 * rows that Phase B's calibration can then pool from — see
 * lib/calibration/generate.ts and ROADMAP.md for why this exists: it lets
 * calibration bootstrap from years of history instead of waiting out a
 * live season. A batch backfill, not a recurring cron job — same pattern
 * as scripts/seed-resorts.ts (operator runs this when they want more
 * history, not on a schedule).
 *
 * Usage:
 *   npm run backtest:slr-reanalysis -- --years=10
 *   npm run backtest:slr-reanalysis -- --years=20 --resort=alta
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env,
 * plus live network access to archive-api.open-meteo.com and the NRCS AWDB
 * API — this does real work against real services, unlike most of this
 * codebase's other scripts, which were written without live access (see
 * README.md's "Flagged assumptions"). Expect it to take a while for the
 * full resort roster at a multi-decade range: one AWDB call plus one
 * archive-api call per resort, not per day.
 */

import { getServiceDb } from "../src/lib/db/client";
import { runSlrReanalysisBacktestForResort } from "../src/lib/backtest/slr-reanalysis";
import type { Resort } from "../src/lib/db/types";

const DEFAULT_YEARS_BACK = 10;

function parseArgs(argv: string[]): { years: number; resortSlug: string | null } {
  let years = DEFAULT_YEARS_BACK;
  let resortSlug: string | null = null;
  for (const arg of argv) {
    const yearsMatch = arg.match(/^--years=(\d+)$/);
    if (yearsMatch) years = Number(yearsMatch[1]);
    const resortMatch = arg.match(/^--resort=(.+)$/);
    if (resortMatch) resortSlug = resortMatch[1]!;
  }
  return { years, resortSlug };
}

function isoDateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function main() {
  const { years, resortSlug } = parseArgs(process.argv.slice(2));
  // ERA5 reanalysis has a reporting lag of roughly a week — ending the
  // range a few days back avoids requesting dates the archive doesn't
  // have yet (which would just come back empty for those last days, not
  // an error, but there's no reason to request them).
  const endDate = isoDateDaysAgo(7);
  const startDate = isoDateDaysAgo(7 + years * 365);

  const db = getServiceDb();
  let query = db.from("resorts").select("*").eq("active", true).not("snotel_station_triplet", "is", null);
  if (resortSlug) query = query.eq("slug", resortSlug);
  const { data, error } = await query;
  if (error) throw error;
  const resorts = (data ?? []) as Resort[];

  if (resorts.length === 0) {
    console.log(resortSlug ? `No active resort found with slug "${resortSlug}" and a resolved SNOTEL station.` : "No active resorts have a resolved SNOTEL station yet — run seed:resorts first.");
    return;
  }

  console.log(`Running SLR reanalysis backtest for ${resorts.length} resort(s), ${startDate} to ${endDate} (~${years} years)...`);

  let totalCompared = 0;
  let totalSkipped = 0;
  const failures: string[] = [];

  for (const resort of resorts) {
    const summary = await runSlrReanalysisBacktestForResort(resort, startDate, endDate);
    totalCompared += summary.daysCompared;
    totalSkipped += summary.daysSkipped;
    if (summary.error) {
      failures.push(`${summary.resortSlug}: ${summary.error}`);
      console.log(`  ${summary.resortSlug}: FAILED — ${summary.error}`);
    } else {
      console.log(`  ${summary.resortSlug}: ${summary.daysCompared} days compared, ${summary.daysSkipped} skipped`);
    }
  }

  console.log(`\nDone. ${totalCompared} resort-days compared, ${totalSkipped} skipped, ${failures.length} resorts failed.`);
  if (failures.length > 0) {
    console.log("Failures:");
    for (const f of failures) console.log(`  ${f}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
