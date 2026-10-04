/**
 * ROADMAP Phase B — the only code path allowed to write
 * resorts.slr_calibration_multiplier as a result of a calibration
 * recommendation. Requires an explicit admin decision (approve/reject);
 * nothing in lib/calibration/generate.ts or the cron job calls this.
 */

import { getServiceDb } from "@/lib/db/client";
import type { CalibrationRecommendation } from "@/lib/db/types";

export async function reviewCalibrationRecommendation(
  recommendationId: string,
  decision: "approved" | "rejected",
  reviewedBy: string
): Promise<CalibrationRecommendation> {
  const db = getServiceDb();

  const { data: recData, error: recError } = await db
    .from("calibration_recommendations")
    .select("*")
    .eq("id", recommendationId)
    .maybeSingle();
  if (recError) throw recError;
  const recommendation = recData as CalibrationRecommendation | null;
  if (!recommendation) throw new Error("recommendation_not_found");
  if (recommendation.status !== "pending") throw new Error(`recommendation already ${recommendation.status}`);

  if (decision === "approved") {
    const { error: updateResortError } = await db
      .from("resorts")
      .update({ slr_calibration_multiplier: recommendation.recommended_multiplier })
      .eq("id", recommendation.resort_id);
    if (updateResortError) throw updateResortError;
  }

  const { data: updated, error: updateRecError } = await db
    .from("calibration_recommendations")
    .update({ status: decision, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() })
    .eq("id", recommendationId)
    .select()
    .single();
  if (updateRecError) throw updateRecError;

  return updated as CalibrationRecommendation;
}
