/**
 * Backtest/accuracy loop (BUILD_PRIMER section 5.5). Daily job joining the
 * T-1 (yesterday's) predictions in snow_scores against snotel_actuals for
 * the same resort/date, logging accuracy_error for season-long calibration
 * reporting. This is the credibility metric required before PART_2
 * (booking) begins — the primer says to build the logging now even though
 * the reporting UI can stay minimal (see /admin/backtest page).
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
 */

import { getServiceDb } from "@/lib/db/client";
import type { Resort, SnowScore, SnotelActual } from "@/lib/db/types";

function yesterdayIso(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
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

      // Use the most recent (shortest lead-time, presumably most accurate)
      // prediction that was made for this target date.
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
      if (!score) {
        skipped += 1;
        continue;
      }

      const observedEquivalentIn = score.is_rain_case
        ? 0
        : (actual.observed_swe_mm * score.snow_to_liquid_ratio) / 25.4;
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
        },
        { onConflict: "resort_id,target_date,lead_time_hours_at_prediction" }
      );
      if (upsertError) throw upsertError;
      matched += 1;
    } catch (err) {
      errors.push(`${resort.slug}: ${(err as Error).message}`);
    }
  }

  return { matched, skipped, errors };
}

export interface AccuracySummary {
  resortId: string;
  resortName: string;
  sampleCount: number;
  meanAbsoluteErrorIn: number;
  hitRatePct: number; // % of predictions within +/-2in of observed equivalent
}

const HIT_TOLERANCE_IN = 2;

export async function getAccuracySummary(): Promise<AccuracySummary[]> {
  const db = getServiceDb();
  const { data, error } = await db
    .from("accuracy_log")
    .select("resort_id, accuracy_error_in, resorts(name)")
    .not("accuracy_error_in", "is", null);
  if (error) throw error;

  type Row = { resort_id: string; accuracy_error_in: number; resorts: { name: string } | { name: string }[] | null };
  const byResort = new Map<string, { name: string; errors: number[] }>();

  for (const row of (data ?? []) as Row[]) {
    const nameField = row.resorts;
    const name = Array.isArray(nameField) ? nameField[0]?.name : nameField?.name;
    const entry = byResort.get(row.resort_id) ?? { name: name ?? row.resort_id, errors: [] };
    entry.errors.push(Math.abs(row.accuracy_error_in));
    byResort.set(row.resort_id, entry);
  }

  return Array.from(byResort.entries()).map(([resortId, { name, errors }]) => ({
    resortId,
    resortName: name,
    sampleCount: errors.length,
    meanAbsoluteErrorIn: errors.reduce((a, b) => a + b, 0) / errors.length,
    hitRatePct: (100 * errors.filter((e) => e <= HIT_TOLERANCE_IN).length) / errors.length,
  }));
}
