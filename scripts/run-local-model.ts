/**
 * Local, resumable driver for the historical "download + compute" pass:
 * runs both backtests (lib/backtest/slr-reanalysis.ts and
 * lib/backtest/reconciliation-forecast-archive.ts) for every resort with a
 * resolved SNOTEL station, then generates calibration recommendations,
 * then exports the results to local CSVs. Invoked by
 * scripts/run-local-model.sh, which installs Node/npm deps and loads the
 * env first — run that, not this file directly.
 *
 * Why this exists instead of just calling the two backtest:* scripts:
 * those send ONE Open-Meteo request per resort for the whole range. Open-
 * Meteo weights a request by how much data it covers (every 2 weeks of
 * one location counts as another call — see open-meteo.com/en/pricing),
 * so a single 40-year request is worth ~1,000 calls, more than the free
 * tier's 600/minute on its own. This driver splits each resort's range
 * into 1-year chunks (~26 weighted calls each), waits out minutely/hourly
 * limits, and on the daily limit saves progress and exits so the next run
 * resumes where it stopped. The underlying backtest functions are called
 * unchanged — this only changes how the date range is sliced and paced.
 *
 * Chunks run NEWEST-FIRST with a 1-day overlap. The SNOTEL backfill
 * derives each day's new-snow figure from the previous day's depth, so the
 * first day of any chunk has no delta. Overlapping by a day and walking
 * backwards means the older chunk always runs last for that shared day
 * and writes the correct value over the null one.
 *
 * Results land in Supabase (accuracy_log, snotel_actuals,
 * calibration_recommendations — the same tables the admin dashboard and
 * model-version comparison read), plus CSV copies under local-data/.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getServiceDb } from "../src/lib/db/client";
import { runSlrReanalysisBacktestForResort } from "../src/lib/backtest/slr-reanalysis";
import { runReconciliationBacktestForResort } from "../src/lib/backtest/reconciliation-forecast-archive";
import { generateCalibrationRecommendations } from "../src/lib/calibration/generate";
import { getActiveModelVersion, getModelVersionById } from "../src/lib/model-versions/resolve";
import { resolveScoringConfigForResort } from "../src/lib/scoring/config";
import type { ModelVersion, Resort } from "../src/lib/db/types";

const DATA_DIR = join(process.cwd(), "local-data");
const PROGRESS_FILE = join(DATA_DIR, "progress.json");
const PAUSE_BETWEEN_CHUNKS_MS = 1_000;
const MINUTELY_WAIT_MS = 70_000;
const HOURLY_WAIT_MS = 61 * 60_000;
const MAX_RATE_LIMIT_RETRIES_PER_CHUNK = 3;

interface Options {
  slrYears: number;
  forecastYears: number;
  resortSlug: string | null;
  versionId: string | null;
  skipSlr: boolean;
  skipForecast: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { slrYears: 40, forecastYears: 5, resortSlug: null, versionId: null, skipSlr: false, skipForecast: false };
  for (const arg of argv) {
    const [key, value] = arg.split("=", 2);
    if (key === "--years" && value) opts.slrYears = Number(value);
    else if (key === "--forecast-years" && value) opts.forecastYears = Number(value);
    else if (key === "--resort" && value) opts.resortSlug = value;
    else if (key === "--version" && value) opts.versionId = value;
    else if (key === "--skip-slr") opts.skipSlr = true;
    else if (key === "--skip-forecast") opts.skipForecast = true;
  }
  return opts;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/** [start, end] pairs, newest first, 1-year each, overlapping by one day (see file header). */
function yearlyChunksNewestFirst(years: number): Array<[string, string]> {
  const chunks: Array<[string, string]> = [];
  // ERA5 lags ~a week behind real time; same 7-day offset the backtest:* scripts use.
  for (let i = 0; i < years; i++) {
    const end = isoDaysAgo(7 + i * 365);
    const start = isoDaysAgo(7 + (i + 1) * 365 + 1);
    chunks.push([start, end]);
  }
  return chunks;
}

type RateLimit = "minutely" | "hourly" | "daily" | "unknown" | null;

/** Classifies an Open-Meteo 429 from the error text the backtest functions surface (open-meteo-historical.ts includes the status and response body). */
function rateLimitKind(messages: string[]): RateLimit {
  const hit = messages.find((m) => m.includes("(429)"));
  if (!hit) return null;
  const lower = hit.toLowerCase();
  if (lower.includes("daily")) return "daily";
  if (lower.includes("hourly")) return "hourly";
  if (lower.includes("minutely") || lower.includes("minute")) return "minutely";
  return "unknown";
}

type Progress = Record<string, true>;
function loadProgress(): Progress {
  if (!existsSync(PROGRESS_FILE)) return {};
  return JSON.parse(readFileSync(PROGRESS_FILE, "utf8")) as Progress;
}
function saveProgress(p: Progress) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
}

class DailyLimitReached extends Error {}

async function runChunked(
  label: "slr" | "forecast",
  resorts: Resort[],
  years: number,
  versionKey: string,
  progress: Progress,
  runChunk: (resort: Resort, start: string, end: string) => Promise<{ errors: string[]; compared: number }>
) {
  const chunks = yearlyChunksNewestFirst(years);
  const total = resorts.length * chunks.length;
  let done = 0;
  let compared = 0;
  const failures: string[] = [];

  for (const resort of resorts) {
    for (const [start, end] of chunks) {
      done += 1;
      const key = `${label}:${versionKey}:${resort.slug}:${start}:${end}`;
      if (progress[key]) continue;

      for (let attempt = 0; ; attempt++) {
        const result = await runChunk(resort, start, end);
        const limit = rateLimitKind(result.errors);
        if (!limit) {
          compared += result.compared;
          if (result.errors.length > 0) failures.push(`${resort.slug} ${start}..${end}: ${result.errors.join("; ").slice(0, 300)}`);
          progress[key] = true;
          saveProgress(progress);
          console.log(`  [${label} ${done}/${total}] ${resort.slug} ${start}..${end}: ${result.compared} days compared${result.errors.length ? " (with errors)" : ""}`);
          break;
        }
        if (limit === "daily") throw new DailyLimitReached();
        if (attempt >= MAX_RATE_LIMIT_RETRIES_PER_CHUNK) throw new DailyLimitReached();
        const wait = limit === "hourly" ? HOURLY_WAIT_MS : MINUTELY_WAIT_MS;
        console.log(`  Open-Meteo ${limit} limit hit — waiting ${Math.round(wait / 60_000)} min, then retrying ${resort.slug} ${start}..${end}.`);
        await sleep(wait);
      }
      await sleep(PAUSE_BETWEEN_CHUNKS_MS);
    }
  }
  return { compared, failures };
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]!);
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
}

async function exportTable(table: string, orderBy: string) {
  const db = getServiceDb();
  const pageSize = 1000;
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db.from(table).select("*").order(orderBy).range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < pageSize) break;
  }
  const path = join(DATA_DIR, `${table}.csv`);
  writeFileSync(path, toCsv(rows));
  console.log(`  ${path} (${rows.length} rows)`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(DATA_DIR, { recursive: true });
  const progress = loadProgress();
  const db = getServiceDb();

  let query = db.from("resorts").select("*").eq("active", true).not("snotel_station_triplet", "is", null).order("slug");
  if (opts.resortSlug) query = query.eq("slug", opts.resortSlug);
  const { data, error } = await query;
  if (error) throw error;
  const resorts = (data ?? []) as Resort[];
  if (resorts.length === 0) {
    console.log("No active resorts with a resolved SNOTEL station — the seed step resolves these; check its output above.");
    process.exit(1);
  }

  let version: ModelVersion | null;
  if (opts.versionId) {
    version = await getModelVersionById(opts.versionId);
    if (!version) throw new Error(`No model version found with id "${opts.versionId}".`);
  } else {
    version = await getActiveModelVersion();
  }
  // Same rule as the backtest:* scripts: only a pinned --version uses its
  // own multiplier snapshot; the active version uses each resort's live one.
  const multipliers = opts.versionId ? version?.resort_slr_multipliers ?? null : null;
  const versionKey = version?.id ?? "defaults";
  console.log(`Model version: ${version ? `"${version.name}" (${version.id})` : "compiled-in defaults"}. ${resorts.length} resorts with SNOTEL coverage.\n`);

  try {
    if (!opts.skipSlr) {
      console.log(`Step 1/4: SLR reanalysis backtest, ${opts.slrYears} years (ERA5 history + SNOTEL observations)...`);
      const r = await runChunked("slr", resorts, opts.slrYears, versionKey, progress, async (resort, start, end) => {
        const slrStrategyName = version ? resolveScoringConfigForResort(version, resort.id).slrStrategyName : undefined;
        const s = await runSlrReanalysisBacktestForResort(resort, start, end, {
          slrStrategyName,
          calibrationMultiplier: multipliers?.[resort.id],
          modelVersionId: version?.id ?? null,
        });
        return { compared: s.daysCompared, errors: s.error ? [s.error] : [] };
      });
      console.log(`  Done: ${r.compared} resort-days compared, ${r.failures.length} chunks with errors.\n`);
      for (const f of r.failures) console.log(`    ${f}`);
    }

    if (!opts.skipForecast) {
      console.log(`Step 2/4: forecast-archive backtest, ${opts.forecastYears} years (archived model forecasts + SNOTEL)...`);
      console.log("  Early chunks will report per-model errors where Open-Meteo's forecast archive doesn't reach back that far — expected.");
      const r = await runChunked("forecast", resorts, opts.forecastYears, versionKey, progress, async (resort, start, end) => {
        const scoringConfig = version ? resolveScoringConfigForResort(version, resort.id) : undefined;
        const s = await runReconciliationBacktestForResort(resort, start, end, {
          scoringConfig,
          calibrationMultiplier: multipliers?.[resort.id],
          modelVersionId: version?.id ?? null,
        });
        return { compared: s.daysCompared, errors: [...(s.error ? [s.error] : []), ...s.modelErrors] };
      });
      console.log(`  Done: ${r.compared} resort-days compared, ${r.failures.length} chunks with errors.\n`);
    }
  } catch (err) {
    if (err instanceof DailyLimitReached) {
      console.log("\nOpen-Meteo's daily free-tier limit was reached. Progress is saved in local-data/progress.json —");
      console.log("run the same command again tomorrow and it picks up where it stopped.");
      process.exit(2);
    }
    throw err;
  }

  console.log("Step 3/4: generating calibration recommendations (pending admin approval at /admin/calibration)...");
  const cal = await generateCalibrationRecommendations();
  console.log(`  ${cal.proposed} proposed, ${cal.skipped} skipped${cal.errors.length ? `, ${cal.errors.length} errors` : ""}.\n`);

  console.log("Step 4/4: exporting results to local-data/...");
  await exportTable("accuracy_log", "target_date");
  await exportTable("snotel_actuals", "date");
  await exportTable("calibration_recommendations", "computed_at");
  console.log("\nAll done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
