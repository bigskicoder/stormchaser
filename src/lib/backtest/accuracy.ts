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
 * SNOTEL reports snow-water-equivalent (observed_swe_mm), not snowfall
 * inches directly, so the "observed equivalent" here converts SWE back to
 * an inches figure using the SAME resort-specific SLR the prediction used
 * (resort.slr_calibration_multiplier via the Kuchera strategy evaluated at
 * that day's predicted Tmax) — an apples-to-apples comparison against what
 * the model predicted, not an independent ground-truth snowfall
 * measurement (NRCS doesn't publish forecast-independent snowfall depth
 * consistently across stations). This is a known limitation: it validates
 * the reconciled SWE forecast against ground truth precipitation, while the
 * SLR conversion step itself is validated separately by comparing multiple
 * SLR strategies against the same SWE actuals during manual season review.
 * The NWS benchmark comparison below sidesteps this issue — NWS already
 * reports snowfallAmount directly in inches-equivalent (converted from mm),
 * so no SLR re-derivation is needed for that side of the comparison.
 */

import { getServiceDb } from "@/lib/db/client";
import type { AccuracyLogSource, BenchmarkForecast, Resort, SnowScore, SnotelActual } from "@/lib/db/types";

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
  if (!latestData || actual.observed_swe_mm == null) return { matched: 0, skipped: 1 };

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
    const observedEquivalentIn = score.is_rain_case ? 0 : (actual.observed_swe_mm * score.snow_to_liquid_ratio) / 25.4;
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
  if (!benchmark || actual.observed_swe_mm == null) return "skipped";

  // NWS's snowfallAmount is already a snowfall-inches estimate, not a raw
  // SWE value, so there's no SLR re-derivation here — compare directly
  // against SNOTEL's SWE converted through a plain 12:1 fixed ratio as the
  // simplest neutral "observed equivalent" baseline for this comparison
  // (not the resort-tuned Kuchera ratio used for the Powder Seeker side,
  // since this is a baseline-vs-baseline check, not our own calibration).
  const observedEquivalentIn = (actual.observed_swe_mm * 12) / 25.4;
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
      if (!actual || actual.observed_swe_mm == null) {
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
