/**
 * Moves forecast runs nothing reads any more out of forecast_pulls into
 * gzipped JSON Lines files in the private 'forecast-archive' Storage bucket
 * (migration 0018 says which rows). Each part is uploaded, downloaded again
 * and checked, logged in forecast_archive_log, and only then are exactly
 * those rows deleted by id. Without --delete it only writes and checks the
 * files.
 *
 *   npx tsx scripts/archive-forecast-pulls.ts [--delete] [--days=N] [--keep-days=3]
 *
 * Without --delete: writes one part of the oldest date under dry-run/,
 * reads it back, removes it, and reports the size; nothing else changes.
 *
 * --keep-days: runs from the most recent N UTC days are left alone.
 * --days: at most this many run dates per invocation (oldest first).
 * Files: forecast_pulls/run_date=YYYY-MM-DD/part-0001.jsonl.gz, one row per line.
 */

import { gunzipSync, gzipSync } from "node:zlib";
import { getServiceDb } from "../src/lib/db/client";

const BUCKET = "forecast-archive";
const PAGE = 5_000; // keeps each RPC well under the API's 8 s statement timeout
const PART_ROWS = 100_000; // about 10-20 MB gzipped, under Storage's 50 MB per-file limit
const DELETE_BATCH = 5_000;

/** Postgres "statement timeout": the API cuts every call off at 8 s. */
function isTimeout(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "57014";
}

async function deleteIds(ids: string[]): Promise<number> {
  const { data, error } = await getServiceDb().rpc("forecast_archive_delete", { p_ids: ids });
  if (!error) return data as number;
  // A slow moment on the database: split the batch rather than fail the run.
  if (isTimeout(error) && ids.length > 100) {
    const mid = Math.floor(ids.length / 2);
    return (await deleteIds(ids.slice(0, mid))) + (await deleteIds(ids.slice(mid)));
  }
  throw error;
}

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function runDates(keepDays: number): Promise<string[]> {
  const db = getServiceDb();
  const cutoff = new Date(Date.now() - keepDays * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await db.from("forecast_pulls").select("run_init_time").lt("run_init_time", cutoff).order("run_init_time").limit(1);
  if (error) throw error;
  const first = (data ?? [])[0] as { run_init_time: string } | undefined;
  if (!first) return [];
  const out: string[] = [];
  for (let d = first.run_init_time.slice(0, 10); d < cutoff; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) out.push(d);
  return out;
}

async function nextPart(runDate: string): Promise<number> {
  const { data, error } = await getServiceDb().from("forecast_archive_log").select("part").eq("run_date", runDate).order("part", { ascending: false }).limit(1);
  if (error) throw error;
  return (((data ?? [])[0] as { part: number } | undefined)?.part ?? 0) + 1;
}

async function writePart(runDate: string, part: number, rows: Array<{ id: string }>, del: boolean): Promise<void> {
  const db = getServiceDb();
  const body = gzipSync(Buffer.from(rows.map((r) => JSON.stringify(r)).join("\n") + "\n"), { level: 9 });
  const path = `${del ? "" : "dry-run/"}forecast_pulls/run_date=${runDate}/part-${String(part).padStart(4, "0")}.jsonl.gz`;
  const up = await db.storage.from(BUCKET).upload(path, body, { contentType: "application/gzip", upsert: false });
  if (up.error) throw up.error;

  // Read it back and check every row made it before anything is deleted.
  const down = await db.storage.from(BUCKET).download(path);
  if (down.error) throw down.error;
  const lines = gunzipSync(Buffer.from(await down.data.arrayBuffer())).toString("utf8").trimEnd().split("\n");
  if (lines.length !== rows.length || (JSON.parse(lines[lines.length - 1]!) as { id: string }).id !== rows[rows.length - 1]!.id) {
    throw new Error(`${path}: read back ${lines.length} rows, expected ${rows.length}`);
  }

  const ids = rows.map((r) => r.id);
  if (!del) {
    // Dry run: the round trip worked; remove the test file and log nothing.
    const rm = await db.storage.from(BUCKET).remove([path]);
    if (rm.error) throw rm.error;
    console.log(`  ${path}: ${rows.length} rows, ${(body.length / 1e6).toFixed(1)} MB gzipped, read back OK (dry run, nothing deleted)`);
    return;
  }
  const { error: logError } = await db.from("forecast_archive_log").insert({
    run_date: runDate,
    part,
    object_path: path,
    row_count: rows.length,
    bytes: body.length,
    first_id: ids[0],
    last_id: ids[ids.length - 1],
    deleted: false,
  });
  if (logError) throw logError;

  {
    let deleted = 0;
    for (let i = 0; i < ids.length; i += DELETE_BATCH) {
      deleted += await deleteIds(ids.slice(i, i + DELETE_BATCH));
    }
    const { error: updError } = await db.from("forecast_archive_log").update({ deleted: true }).eq("run_date", runDate).eq("part", part);
    if (updError) throw updError;
    console.log(`  ${path}: ${rows.length} rows, ${(body.length / 1e6).toFixed(1)} MB, ${deleted} deleted`);
  }
}

async function main() {
  const del = process.argv.includes("--delete");
  const keepDays = Number(arg("keep-days") ?? 3);
  const maxDays = Number(arg("days") ?? 1000);
  const dates = (await runDates(keepDays)).slice(0, maxDays);
  console.log(`${dates.length} run date(s) to archive${del ? "" : " (dry run)"}.`);
  const db = getServiceDb();

  for (const runDate of dates) {
    let part = await nextPart(runDate);
    let after: { run_init_time: string; id: string } | null = null;
    let buffer: Array<{ id: string; run_init_time: string }> = [];
    let total = 0;
    let page = PAGE;
    for (;;) {
      const { data, error } = await db.rpc("forecast_archive_chunk", {
        p_run_date: runDate,
        p_after_time: after?.run_init_time ?? null,
        p_after_id: after?.id ?? null,
        p_limit: page,
      });
      if (error) {
        // Timed out: retry the same page smaller, then grow back.
        if (isTimeout(error) && page > 250) {
          page = Math.floor(page / 2);
          continue;
        }
        throw error;
      }
      page = Math.min(PAGE, page * 2);
      const rows = (data ?? []) as Array<{ id: string; run_init_time: string }>;
      if (rows.length === 0) break;
      buffer.push(...rows);
      after = rows[rows.length - 1]!;
      // A dry run checks one part and stops.
      if (!del && buffer.length >= PART_ROWS) break;
      if (buffer.length >= PART_ROWS) {
        await writePart(runDate, part++, buffer, del);
        total += buffer.length;
        buffer = [];
      }
    }
    if (buffer.length) {
      await writePart(runDate, part++, buffer, del);
      total += buffer.length;
    }
    console.log(`${runDate}: ${total} rows archived.`);
    if (!del) break;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
