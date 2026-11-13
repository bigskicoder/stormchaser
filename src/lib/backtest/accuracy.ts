/**
 * Backtest/accuracy loop (BUILD_PRIMER section 5.5), extended to also log
 * accuracy for the NWS public-baseline comparison pipeline (see
 * lib/ingestion/nws.ts, ROADMAP.md) alongside our own scoring engine's
 * predictions — both measured against the same SNOTEL ground truth, so
 * `getAccuracySummary` can report "us vs. a public baseline vs. observed."
 *
 * Daily job joining the T-1 (yesterday's) predictions in snow_scores
 * against snotel_actuals for the same resort/date, logging accuracy_error
 * for season-long calibration reporting. This is the credibility metric
 * required before PART_2 (booking) begins — the primer says to build the
 * logging now even though the reporting UI can stay minimal (see
 * /admin/backtest page).
 *
 * Ground truth is snotel_actuals.observed_depth_change_in: the day's rise
 * in measured snow depth (never negative), the same figure the
 * forecast-archive backtest uses. Until 2026-11-13 this used
 * observed_swe_mm, which is SNOTEL's season-to-date snow water (WTEQ), not
 * the day's new snow, so every snowy day at a deep-snowpack station looked
 * like a huge storm (Aspen Highlands logged 47" on 2026-11-04 for a real
 * 6-7") and the calibration proposals built on it were inflated. Depth
 * change also stays independent of our own SLR, so it can actually check
 * the SLR step. Days with no depth reading are skipped.
 */

import { getServiceDb } from "@/lib/db/client";
import type { AccuracyLogSource, BenchmarkForecast, Resort, SnowScore, SnotelActual } from "@/lib/db/types";

/** The day's measured new snow (inches): the rise in snow depth, or null when the station gave no depth. */
export function observedNewSnowIn(actual: Pick<SnotelActual, "observed_depth_change_in">): number | null {
  const v = actual.observed_depth_change_in;
  return v == null ? null : Math.max(0, Number(v));
}

function yesterdayIso(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * Logs one accuracy_log row PER MODEL VERSION present in the latest scoring
 * run for this resort/date — not just the production score. A run can
 * write a primary (active-version) row plus one row per shadow version
 * (ROADMAP Phase B.2, "run multiple models parallel and compare" —
 * requested directly); every one of them needs its own accuracy tracking,
 * each against its OWN predicted snowfall and its OWN SLR ratio, or a
 * shadow version would never accumulate the season-long accuracy_log data
 * the comparison view (lib/model-versions/compare.ts) depends on.
 */
async function logPowderAlertAccuracy(
  resort: Resort,
  targetDateIso: string,
  actual: SnotelActual
): Promise<{ matched: number; skipped: number }> {
  const db = getServiceDb();

  const { data: latestData, error: latestError } = await db
    .from("snow_scores")
    .select("computed_at")
    .eq("resort_id", resort.id)
    .eq("target_date", targetDateIso)
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw latestError;
  const observedIn = observedNewSnowIn(actual);
  if (!latestData || observedIn == null) return { matched: 0, skipped: 1 };

  const { data: scoresData, error: scoresError } = await db
    .from("snow_scores")
    .select("*")
    .eq("resort_id", resort.id)
    .eq("target_date", targetDateIso)
    .eq("computed_at", latestData.computed_at as string);
  if (scoresError) throw scoresError;
  const scores = (scoresData ?? []) as SnowScore[];

  let matched = 0;
  for (const score of scores) {
    const observedEquivalentIn = observedIn;
    const accuracyErrorIn = score.estimated_snowfall_in - observedEquivalentIn;

    const { error: upsertError } = await db.from("accuracy_log").upsert(
      {
        resort_id: resort.id,
        snow_score_id: score.id,
        target_date: targetDateIso,
        predicted_snowfall_in: score.estimated_snowfall_in,
        observed_equivalent_in: observedEquivalentIn,
        accuracy_error_in: accuracyErrorIn,
        lead_time_hours_at_prediction: score.lead_time_hours,
        source: "powder_alert",
        model_version_id: score.model_version_id,
        is_primary: score.is_primary,
      },
      { onConflict: "resort_id,target_date,lead_time_hours_at_prediction,source,model_version_id" }
    );
    if (upsertError) throw upsertError;
    matched += 1;
  }
  return { matched, skipped: 0 };
}

async function logNwsBenchmarkAccuracy(
  resort: Resort,
  targetDateIso: string,
  actual: SnotelActual
): Promise<"matched" | "skipped"> {
  const db = getServiceDb();

  const { data: benchmarkData, error: benchmarkError } = await db
    .from("benchmark_forecasts")
    .select("*")
    .eq("resort_id", resort.id)
    .eq("source", "nws")
    .eq("target_date", targetDateIso)
    .order("pulled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (benchmarkError) throw benchmarkError;
  const benchmark = benchmarkData as BenchmarkForecast | null;
  const observedIn = observedNewSnowIn(actual);
  if (!benchmark || observedIn == null) return "skipped";

  // NWS's snowfallAmount is already a snowfall-inches estimate, so it's
  // compared against the same measured new snow as our own forecast.
  const observedEquivalentIn = observedIn;
  const accuracyErrorIn = benchmark.estimated_snowfall_in - observedEquivalentIn;

  const { error: upsertError } = await db.from("accuracy_log").upsert(
    {
      resort_id: resort.id,
      target_date: targetDateIso,
      predicted_snowfall_in: benchmark.estimated_snowfall_in,
      observed_equivalent_in: observedEquivalentIn,
      accuracy_error_in: accuracyErrorIn,
      lead_time_hours_at_prediction: benchmark.lead_time_hours,
      source: "nws",
    },
    { onConflict: "resort_id,target_date,lead_time_hours_at_prediction,source" }
  );
  if (upsertError) throw upsertError;
  return "matched";
}

export async function runBacktestForDate(targetDateIso: string = yesterdayIso()): Promise<{
  matched: number;
  skipped: number;
  errors: string[];
}> {
  const db = getServiceDb();

  const { data: resortsData, error: resortsError } = await db.from("resorts").select("*");
  if (resortsError) throw resortsError;
  const resorts = (resortsData ?? []) as Resort[];

  let matched = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const resort of resorts) {
    try {
      const { data: actualData, error: actualError } = await db
        .from("snotel_actuals")
        .select("*")
        .eq("resort_id", resort.id)
        .eq("date", targetDateIso)
        .maybeSingle();
      if (actualError) throw actualError;
      const actual = actualData as SnotelActual | null;
      if (!actual || observedNewSnowIn(actual) == null) {
        skipped += 1;
        continue;
      }

      const powderAlertResult = await logPowderAlertAccuracy(resort, targetDateIso, actual);
      const nwsResult = await logNwsBenchmarkAccuracy(resort, targetDateIso, actual);
      matched += powderAlertResult.matched + (nwsResult === "matched" ? 1 : 0);
      skipped += powderAlertResult.skipped + (nwsResult === "skipped" ? 1 : 0);
    } catch (err) {
      errors.push(`${resort.slug}: ${(err as Error).message}`);
    }
  }

  return { matched, skipped, errors };
}

export interface AccuracySummary {
  resortId: string;
  resortName: string;
  source: AccuracyLogSource;
  sampleCount: number;
  meanAbsoluteErrorIn: number;
  hitRatePct: number; // % of predictions within +/-2in of observed equivalent
}

const HIT_TOLERANCE_IN = 2;

export async function getAccuracySummary(): Promise<AccuracySummary[]> {
  const db = getServiceDb();
  // is_primary=true: NWS and backtest-script rows are always true (shadow
  // scoring doesn't touch them), so this only actually excludes a shadow
  // model version's live powder_alert rows — without it, an experimental
  // version's accuracy would blend into "how is our production forecast
  // doing," which is exactly the number this report exists to answer
  // honestly. Per-version comparison lives at lib/model-versions/compare.ts.
  const { data, error } = await db
    .from("accuracy_log")
    .select("resort_id, source, accuracy_error_in, resorts(name)")
    .eq("is_primary", true)
    .not("accuracy_error_in", "is", null);
  if (error) throw error;

  type Row = {
    resort_id: string;
    source: AccuracyLogSource;
    accuracy_error_in: number;
    resorts: { name: string } | { name: string }[] | null;
  };
  const grouped = new Map<string, { resortId: string; name: string; source: AccuracyLogSource; errors: number[] }>();

  for (const row of (data ?? []) as Row[]) {
    const nameField = row.resorts;
    const name = Array.isArray(nameField) ? nameField[0]?.name : nameField?.name;
    const key = `${row.resort_id}:${row.source}`;
    const entry = grouped.get(key) ?? { resortId: row.resort_id, name: name ?? row.resort_id, source: row.source, errors: [] };
    entry.errors.push(Math.abs(row.accuracy_error_in));
    grouped.set(key, entry);
  }

  return Array.from(grouped.values()).map(({ resortId, name, source, errors }) => ({
    resortId,
    resortName: name,
    source,
    sampleCount: errors.length,
    meanAbsoluteErrorIn: errors.reduce((a, b) => a + b, 0) / errors.length,
    hitRatePct: (100 * errors.filter((e) => e <= HIT_TOLERANCE_IN).length) / errors.length,
  }));
}
