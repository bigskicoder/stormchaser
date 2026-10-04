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
import type { BenchmarkForecast, Resort, SnowScore, SnotelActual } from "@/lib/db/types";

function yesterdayIso(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

async function logPowderAlertAccuracy(
  resort: Resort,
  targetDateIso: string,
  actual: SnotelActual
): Promise<"matched" | "skipped"> {
  const db = getServiceDb();

  const { data: scoreData, error: scoreError } = await db
    .from("snow_scores")
    .select("*")
    .eq("resort_id", resort.id)
    .eq("target_date", targetDateIso)
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (scoreError) throw scoreError;
  const score = scoreData as SnowScore | null;
  if (!score || actual.observed_swe_mm == null) return "skipped";

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
    },
    { onConflict: "resort_id,target_date,lead_time_hours_at_prediction,source" }
  );
  if (upsertError) throw upsertError;
  return "matched";
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
  // (not the resort-tuned Kuchera ratio used for the powder-alert side,
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
      matched += [powderAlertResult, nwsResult].filter((r) => r === "matched").length;
      skipped += [powderAlertResult, nwsResult].filter((r) => r === "skipped").length;
    } catch (err) {
      errors.push(`${resort.slug}: ${(err as Error).message}`);
    }
  }

  return { matched, skipped, errors };
}

export interface AccuracySummary {
  resortId: string;
  resortName: string;
  source: "powder_alert" | "nws";
  sampleCount: number;
  meanAbsoluteErrorIn: number;
  hitRatePct: number; // % of predictions within +/-2in of observed equivalent
}

const HIT_TOLERANCE_IN = 2;

export async function getAccuracySummary(): Promise<AccuracySummary[]> {
  const db = getServiceDb();
  const { data, error } = await db
    .from("accuracy_log")
    .select("resort_id, source, accuracy_error_in, resorts(name)")
    .not("accuracy_error_in", "is", null);
  if (error) throw error;

  type Row = {
    resort_id: string;
    source: "powder_alert" | "nws";
    accuracy_error_in: number;
    resorts: { name: string } | { name: string }[] | null;
  };
  const grouped = new Map<string, { resortId: string; name: string; source: "powder_alert" | "nws"; errors: number[] }>();

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
