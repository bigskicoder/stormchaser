/**
 * ROADMAP Phase B — DB-facing orchestrator for calibration recommendations.
 * Fetches each resort's recent accuracy_log (source='powder_alert') history,
 * runs the pure update rule (lib/calibration/recommend.ts), and inserts a
 * `calibration_recommendations` row when eligible. Never writes to
 * resorts.slr_calibration_multiplier — see lib/calibration/apply.ts for the
 * only path that does, which requires admin approval.
 */

import { getServiceDb } from "@/lib/db/client";
import { CALIBRATION_LOOKBACK_DAYS, CALIBRATION_SKIP_IF_PENDING_EXISTS } from "@/lib/config/constants";
import type { Resort } from "@/lib/db/types";
import { computeCalibrationRecommendation, type AccuracySample } from "./recommend";

export async function generateCalibrationRecommendations(): Promise<{
  proposed: number;
  skipped: number;
  errors: string[];
}> {
  const db = getServiceDb();
  const { data: resortsData, error: resortsError } = await db.from("resorts").select("*").eq("active", true);
  if (resortsError) throw resortsError;
  const resorts = (resortsData ?? []) as Resort[];

  let proposed = 0;
  let skipped = 0;
  const errors: string[] = [];
  const since = new Date(Date.now() - CALIBRATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  for (const resort of resorts) {
    try {
      if (CALIBRATION_SKIP_IF_PENDING_EXISTS) {
        const { data: pending, error: pendingError } = await db
          .from("calibration_recommendations")
          .select("id")
          .eq("resort_id", resort.id)
          .eq("status", "pending")
          .limit(1);
        if (pendingError) throw pendingError;
        if ((pending ?? []).length > 0) {
          skipped += 1;
          continue;
        }
      }

      const { data: logRows, error: logError } = await db
        .from("accuracy_log")
        .select("predicted_snowfall_in, accuracy_error_in")
        .eq("resort_id", resort.id)
        .eq("source", "powder_alert")
        .gte("target_date", since.slice(0, 10))
        .not("accuracy_error_in", "is", null);
      if (logError) throw logError;

      const samples: AccuracySample[] = (logRows ?? []).map((r) => ({
        predictedIn: r.predicted_snowfall_in as number,
        errorIn: r.accuracy_error_in as number,
      }));

      const result = computeCalibrationRecommendation(resort.slr_calibration_multiplier, samples);
      if (!result.eligible) {
        skipped += 1;
        continue;
      }

      const { error: insertError } = await db.from("calibration_recommendations").insert({
        resort_id: resort.id,
        sample_count: result.sampleCount,
        mean_signed_error_in: result.meanSignedErrorIn,
        current_multiplier: resort.slr_calibration_multiplier,
        recommended_multiplier: result.recommendedMultiplier,
      });
      if (insertError) throw insertError;
      proposed += 1;
    } catch (err) {
      errors.push(`${resort.slug}: ${(err as Error).message}`);
    }
  }

  return { proposed, skipped, errors };
}
