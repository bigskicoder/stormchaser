/**
 * Read-only database health check: times a few small queries the site
 * depends on and prints recent cron results, so slowness can be seen
 * without database access from the sandbox.
 *
 *   npx tsx scripts/db-health.ts
 */

import { getServiceDb } from "../src/lib/db/client";

async function timed(label: string, fn: () => PromiseLike<{ error: unknown; count?: number | null; data?: unknown }>) {
  const t = Date.now();
  const r = await fn();
  console.log(`${label.padEnd(44)} ${String(Date.now() - t).padStart(6)} ms ${r.error ? `ERROR ${JSON.stringify(r.error)}` : ""}${r.count != null ? ` count=${r.count}` : ""}`);
  return r;
}

async function main() {
  const db = getServiceDb();
  for (let i = 0; i < 2; i++) {
    await timed("resorts (65 rows)", () => db.from("resorts").select("id"));
    await timed("snow_scores latest 50", () => db.from("snow_scores").select("id").order("computed_at", { ascending: false }).limit(50));
    await timed("forecast_pulls newest run", () => db.from("forecast_pulls").select("run_init_time").order("run_init_time", { ascending: false }).limit(1));
    await timed("forecast_pulls oldest run", () => db.from("forecast_pulls").select("run_init_time").order("run_init_time", { ascending: true }).limit(1));
    await timed("forecast_archive_chunk 2026-10-25 x100", () => db.rpc("forecast_archive_chunk", { p_run_date: "2026-10-25", p_after_time: null, p_after_id: null, p_limit: 100 }));
  }
  const { data } = await db.from("cron_runs").select("job, ran_at, resorts, error_count").order("ran_at", { ascending: false }).limit(15);
  for (const r of data ?? []) console.log(`cron ${r.ran_at} ${String(r.job).padEnd(24)} resorts=${r.resorts} errors=${r.error_count}`);
  const { data: logs } = await db.from("forecast_archive_log").select("run_date, part, row_count, deleted").order("run_date", { ascending: false }).order("part", { ascending: false }).limit(5);
  for (const r of logs ?? []) console.log(`archived ${r.run_date} part ${r.part}: ${r.row_count} rows, deleted=${r.deleted}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
