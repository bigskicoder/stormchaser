/**
 * Operator-run backfill: runs the forecast-archive-driven reconciliation
 * backtest (lib/backtest/reconciliation-forecast-archive.ts) across every
 * resort with a resolved SNOTEL station, writing
 * accuracy_log(source='reconciliation_forecast_backtest') rows. Much
 * shallower range than the SLR reanalysis backtest — the archive only
 * goes back to ~2021 at best, varies by model — see that module's header
 * for the full explanation of what this does and doesn't validate.
 *
 * Usage:
 *   npm run backtest:reconciliation -- --years=4
 *   npm run backtest:reconciliation -- --years=2 --resort=alta
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env,
 * plus live network access to historical-forecast-api.open-meteo.com and
 * the NRCS AWDB API. This makes one historical-forecast-api call PER MODEL
 * per resort (4 models, see RECONCILIATION_BACKTEST_MODELS) plus one AWDB
 * call per resort — meaningfully more requests than the SLR reanalysis
 * script for the same resort count, though still one call per
 * (resort, model), not per day.
 */

import { getServiceDb } from "../src/lib/db/client";
import { runReconciliationBacktestForResort } from "../src/lib/backtest/reconciliation-forecast-archive";
import type { Resort } from "../src/lib/db/types";

const DEFAULT_YEARS_BACK = 4;

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

  console.log(`Running reconciliation forecast-archive backtest for ${resorts.length} resort(s), ${startDate} to ${endDate} (~${years} years)...`);
  console.log("Note: the archive doesn't cover this full range for every model (varies ~2021-2022 onward) — per-model failures for the earliest dates are expected and reported per resort below, not fatal to the run.\n");

  let totalCompared = 0;
  let totalSkipped = 0;
  const failures: string[] = [];

  for (const resort of resorts) {
    const summary = await runReconciliationBacktestForResort(resort, startDate, endDate);
    totalCompared += summary.daysCompared;
    totalSkipped += summary.daysSkipped;
    if (summary.error) {
      failures.push(`${summary.resortSlug}: ${summary.error}`);
      console.log(`  ${summary.resortSlug}: FAILED — ${summary.error}`);
    } else {
      console.log(`  ${summary.resortSlug}: ${summary.daysCompared} days compared, ${summary.daysSkipped} skipped`);
      if (summary.modelErrors.length > 0) {
        for (const e of summary.modelErrors) console.log(`    model error: ${e}`);
      }
    }
  }

  console.log(`\nDone. ${totalCompared} resort-days compared, ${totalSkipped} skipped, ${failures.length} resorts failed outright.`);
  if (failures.length > 0) {
    console.log("Failures:");
    for (const f of failures) console.log(`  ${f}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
