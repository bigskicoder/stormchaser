/**
 * One-off repair after the live-scorecard fix (2026-11-13, Nick: "Fix"):
 *
 *   1. Deletes the live 'powder_alert' and 'nws' accuracy_log rows from
 *      --since on, which compared forecasts with SNOTEL's season-to-date
 *      snow water instead of the day's new snow.
 *   2. Rebuilds them day by day with the fixed code (lib/backtest/accuracy.ts).
 *   3. Sets aside every pending calibration proposal (status 'superseded';
 *      the 53 from 2026-11-08 were built on the bad rows). Nothing that is
 *      approved or live changes.
 *   4. Runs a fresh calibration pass, leaving new pending proposals for admin.
 *
 *   npx tsx scripts/fix-scorecard.ts [--since=2026-10-15]
 */

import { getServiceDb } from "../src/lib/db/client";
import { runBacktestForDate } from "../src/lib/backtest/accuracy";
import { generateCalibrationRecommendations } from "../src/lib/calibration/generate";

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main() {
  const db = getServiceDb();
  const since = arg("since") ?? "2026-10-15";
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const startedAt = new Date().toISOString();

  const del = await db.from("accuracy_log").delete({ count: "exact" }).in("source", ["powder_alert", "nws"]).gte("target_date", since);
  if (del.error) throw del.error;
  console.log(`Deleted ${del.count ?? "?"} old live scorecard rows from ${since} on.`);

  for (let d = since; d <= yesterday; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
    const r = await runBacktestForDate(d);
    console.log(`  ${d}: ${r.matched} rows, ${r.skipped} skipped${r.errors.length ? `, ${r.errors.length} errors (${r.errors[0]})` : ""}`);
  }

  const aside = await db
    .from("calibration_recommendations")
    .update({ status: "superseded" }, { count: "exact" })
    .eq("status", "pending")
    .lt("created_at", startedAt);
  if (aside.error) throw aside.error;
  console.log(`Set aside ${aside.count ?? "?"} pending calibration proposals.`);

  const result = await generateCalibrationRecommendations();
  console.log(`Fresh calibration pass: proposed ${result.proposed}, skipped ${result.skipped}.`);
  for (const e of result.errors) console.log(`  error: ${e}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
