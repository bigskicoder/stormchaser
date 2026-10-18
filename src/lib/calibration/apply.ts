/**
 * ROADMAP Phase B — the only code path allowed to write
 * resorts.slr_calibration_multiplier as a result of a calibration
 * recommendation. Requires an explicit admin decision (approve/reject);
 * nothing in lib/calibration/generate.ts or the cron job calls this.
 *
 * ROADMAP Phase C (model versioning): approving a recommendation no longer
 * overwrites resorts.slr_calibration_multiplier directly with nothing to
 * undo. It creates a new model_versions row — same global scoring config as
 * whatever's currently active, just this one resort's multiplier changed —
 * and activates it via lib/model-versions/activate.ts, which is what
 * actually performs the resorts table write (same end effect, now with a
 * named, timestamped, rollback-able version behind it). The version this
 * branches from becomes parent_version_id, so "undo this calibration
 * change" is just activating that parent again from the admin dashboard —
 * no separate undo code path needed.
 */

import { getServiceDb } from "@/lib/db/client";
import type { CalibrationRecommendation } from "@/lib/db/types";
import { activateModelVersion } from "@/lib/model-versions/activate";
import { createBaselineVersionIfNoneExists, createModelVersion } from "@/lib/model-versions/create";
import { toScoringConfig } from "@/lib/scoring/config";

export async function reviewCalibrationRecommendation(
  recommendationId: string,
  decision: "approved" | "rejected",
  reviewedBy: string
): Promise<CalibrationRecommendation> {
  const db = getServiceDb();

  const { data: recData, error: recError } = await db
    .from("calibration_recommendations")
    .select("*, resorts(slug)")
    .eq("id", recommendationId)
    .maybeSingle();
  if (recError) throw recError;
  const recommendation = recData as (CalibrationRecommendation & { resorts: { slug: string } | null }) | null;
  if (!recommendation) throw new Error("recommendation_not_found");
  if (recommendation.status !== "pending") throw new Error(`recommendation already ${recommendation.status}`);

  if (decision === "approved") {
    // Guarantees an active version to branch from, even on a deploy where
    // seed-resorts.ts's baseline step hasn't run yet — see that function's
    // own doc comment.
    const currentActive = await createBaselineVersionIfNoneExists();
    const resortLabel = recommendation.resorts?.slug ?? recommendation.resort_id;
    const phase = recommendation.enso_phase;
    const phaseLabel = phase === "el_nino" ? " (El Niño)" : phase === "la_nina" ? " (La Niña)" : "";
    const currentEnso = currentActive.resort_enso_slr_multipliers ?? {};

    // A phase recommendation changes only that resort's multiplier for that
    // phase; the base multiplier, and so the resorts table, stays as is.
    const draft = await createModelVersion({
      name: `Calibration: ${resortLabel}${phaseLabel} → ${recommendation.recommended_multiplier.toFixed(3)}`,
      description: `Auto-created on approval of calibration recommendation ${recommendation.id} for ${resortLabel}${phaseLabel} (${recommendation.sample_count} samples, mean signed error ${recommendation.mean_signed_error_in.toFixed(2)}in, ${recommendation.current_multiplier.toFixed(3)} → ${recommendation.recommended_multiplier.toFixed(3)}).`,
      config: toScoringConfig(currentActive),
      resortSlrMultipliers: phase
        ? currentActive.resort_slr_multipliers
        : { ...currentActive.resort_slr_multipliers, [recommendation.resort_id]: recommendation.recommended_multiplier },
      resortScoringOverrides: currentActive.resort_scoring_overrides,
      resortEnsoSlrMultipliers: phase
        ? { ...currentEnso, [recommendation.resort_id]: { ...currentEnso[recommendation.resort_id], [phase]: recommendation.recommended_multiplier } }
        : currentEnso,
      parentVersionId: currentActive.id,
      createdBy: reviewedBy,
      status: "draft",
    });
    await activateModelVersion(draft.id, reviewedBy);
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
