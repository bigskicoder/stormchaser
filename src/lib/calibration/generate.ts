/**
 * ROADMAP Phase B — DB-facing orchestrator for calibration recommendations.
 * Fetches each resort's accuracy_log history (recent live 'powder_alert'
 * rows plus every backtest row), runs the pure update rule
 * (lib/calibration/recommend.ts), and inserts a `calibration_recommendations`
 * row when eligible. Never writes to resorts.slr_calibration_multiplier —
 * see lib/calibration/apply.ts for the only path that does, which requires
 * admin approval.
 *
 * Phase B.6 adds two things, both requested directly:
 * - Recency weighting: each sample counts 0.5 ^ (age / half-life), so last
 *   season outweighs 1990 (CALIBRATION_RECENCY_HALF_LIFE_YEARS).
 * - ENSO: every sample is tagged with its winter's El Nino / La Nina /
 *   neutral phase from NOAA's ONI (lib/enso/oni.ts). A resort gets a
 *   separate El Nino or La Nina multiplier proposed only once its error in
 *   that phase is statistically distinct from neutral winters
 *   (ENSO_SIGNIFICANCE_T); after that, that phase's samples tune that
 *   multiplier and are left out of the base one.
 */

import { getServiceDb } from "@/lib/db/client";
import {
  CALIBRATION_BACKTEST_SOURCES,
  CALIBRATION_LOOKBACK_DAYS,
  CALIBRATION_RECENCY_HALF_LIFE_YEARS,
  CALIBRATION_SKIP_IF_PENDING_EXISTS,
  ENSO_MIN_PHASE_SAMPLES,
  ENSO_SIGNIFICANCE_T,
} from "@/lib/config/constants";
import type { Resort } from "@/lib/db/types";
import { ENSO_ADJUSTABLE_PHASES, EnsoPhaseLookup, loadEnsoOni, type EnsoAdjustablePhase, type EnsoPhase } from "@/lib/enso/oni";
import { getActiveModelVersion } from "@/lib/model-versions/resolve";
import { computeCalibrationRecommendation, recencyWeight, welchT, type AccuracySample } from "./recommend";

const PAGE_SIZE = 1000;
const MS_PER_YEAR = 365.25 * 86_400_000;

interface TaggedSample extends AccuracySample {
  phase: EnsoPhase | null;
}

type AccuracyRow = { predicted_snowfall_in: number; accuracy_error_in: number; target_date: string };

/**
 * Pages through accuracy_log. Supabase returns at most 1,000 rows per
 * request, so the unpaged query this replaced silently calibrated on an
 * arbitrary first 1,000 of a resort's backtest rows.
 */
async function fetchAccuracyRows(resortId: string, sources: readonly string[], sinceDate: string | null): Promise<AccuracyRow[]> {
  const db = getServiceDb();
  const rows: AccuracyRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = db
      .from("accuracy_log")
      .select("predicted_snowfall_in, accuracy_error_in, target_date")
      .eq("resort_id", resortId)
      .in("source", sources as string[])
      .not("accuracy_error_in", "is", null)
      .order("target_date")
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (sinceDate) query = query.gte("target_date", sinceDate);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...((data ?? []) as AccuracyRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function hasPending(resortId: string, phase: EnsoAdjustablePhase | null): Promise<boolean> {
  const db = getServiceDb();
  let query = db.from("calibration_recommendations").select("id").eq("resort_id", resortId).eq("status", "pending").limit(1);
  query = phase ? query.eq("enso_phase", phase) : query.is("enso_phase", null);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function generateCalibrationRecommendations(now: Date = new Date()): Promise<{
  proposed: number;
  skipped: number;
  errors: string[];
}> {
  const db = getServiceDb();
  const { data: resortsData, error: resortsError } = await db.from("resorts").select("*").eq("active", true);
  if (resortsError) throw resortsError;
  const resorts = (resortsData ?? []) as Resort[];

  const errors: string[] = [];
  // ENSO tagging is additive: with no ONI data loaded every sample is
  // phase-unknown and calibration behaves exactly as before (plus recency).
  let ensoLookup = new EnsoPhaseLookup([]);
  try {
    ensoLookup = new EnsoPhaseLookup(await loadEnsoOni());
  } catch (err) {
    errors.push(`enso_oni: ${(err as Error).message} (ENSO tagging skipped this run)`);
  }
  const activeVersion = await getActiveModelVersion();

  let proposed = 0;
  let skipped = 0;
  const since = new Date(now.getTime() - CALIBRATION_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);

  for (const resort of resorts) {
    try {
      // Live data stays windowed to recent history so calibration tracks
      // current model behavior; backtest rows are all used, down-weighted by age.
      const liveRows = await fetchAccuracyRows(resort.id, ["powder_alert"], since);
      const backtestRows = await fetchAccuracyRows(resort.id, CALIBRATION_BACKTEST_SOURCES, null);

      const samples: TaggedSample[] = [...liveRows, ...backtestRows].map((r) => ({
        predictedIn: r.predicted_snowfall_in,
        errorIn: r.accuracy_error_in,
        weight: recencyWeight((now.getTime() - new Date(`${r.target_date}T00:00:00Z`).getTime()) / MS_PER_YEAR, CALIBRATION_RECENCY_HALF_LIFE_YEARS),
        phase: ensoLookup.phaseForDate(r.target_date),
      }));

      const phaseMultipliers = activeVersion?.resort_enso_slr_multipliers?.[resort.id] ?? {};
      const neutralErrors = samples.filter((s) => s.phase === "neutral").map((s) => s.errorIn);

      // Base multiplier: every sample not already owned by a phase multiplier.
      const ownedPhases = new Set(ENSO_ADJUSTABLE_PHASES.filter((p) => phaseMultipliers[p] != null));
      const slots: Array<{ phase: EnsoAdjustablePhase | null; current: number; samples: TaggedSample[] }> = [
        {
          phase: null,
          current: resort.slr_calibration_multiplier,
          samples: samples.filter((s) => !(s.phase && ownedPhases.has(s.phase as EnsoAdjustablePhase))),
        },
      ];
      for (const phase of ENSO_ADJUSTABLE_PHASES) {
        const phaseSamples = samples.filter((s) => s.phase === phase);
        const existing = phaseMultipliers[phase];
        if (existing == null) {
          const enoughData = phaseSamples.length >= ENSO_MIN_PHASE_SAMPLES && neutralErrors.length >= ENSO_MIN_PHASE_SAMPLES;
          const t = welchT(
            phaseSamples.map((s) => s.errorIn),
            neutralErrors
          );
          if (!enoughData || Math.abs(t) < ENSO_SIGNIFICANCE_T) continue;
        }
        slots.push({ phase, current: existing ?? resort.slr_calibration_multiplier, samples: phaseSamples });
      }

      for (const slot of slots) {
        if (CALIBRATION_SKIP_IF_PENDING_EXISTS && (await hasPending(resort.id, slot.phase))) {
          skipped += 1;
          continue;
        }
        const result = computeCalibrationRecommendation(slot.current, slot.samples);
        if (!result.eligible) {
          skipped += 1;
          continue;
        }
        const { error: insertError } = await db.from("calibration_recommendations").insert({
          resort_id: resort.id,
          enso_phase: slot.phase,
          sample_count: result.sampleCount,
          mean_signed_error_in: result.meanSignedErrorIn,
          current_multiplier: slot.current,
          recommended_multiplier: result.recommendedMultiplier,
        });
        if (insertError) throw insertError;
        proposed += 1;
      }
    } catch (err) {
      errors.push(`${resort.slug}: ${(err as Error).message}`);
    }
  }

  return { proposed, skipped, errors };
}
