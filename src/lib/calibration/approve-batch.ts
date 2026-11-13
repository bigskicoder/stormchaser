import { getServiceDb } from "@/lib/db/client";
import type { CalibrationRecommendation } from "@/lib/db/types";
import { activateModelVersion } from "@/lib/model-versions/activate";
import { createBaselineVersionIfNoneExists, createModelVersion } from "@/lib/model-versions/create";
import { toScoringConfig } from "@/lib/scoring/config";

/**
 * Approves several pending calibration recommendations as ONE new model
 * version (base and El Niño / La Niña multipliers together), rather than one
 * version per row. Used by the admin page's "Approve selected" button and by
 * scripts/approve-pending-calibrations.ts. Rolled back like any approval:
 * activate the parent version from /admin/model-versions.
 *
 * ids = null approves every pending row.
 */
export async function approveCalibrationBatch(
  ids: string[] | null,
  by: string
): Promise<{ approved: number; versionId: string | null; versionName: string | null }> {
  const db = getServiceDb();
  let query = db.from("calibration_recommendations").select("*").eq("status", "pending");
  if (ids) query = query.in("id", ids);
  const { data, error } = await query;
  if (error) throw error;
  const recs = (data ?? []) as CalibrationRecommendation[];
  if (recs.length === 0) return { approved: 0, versionId: null, versionName: null };

  const active = await createBaselineVersionIfNoneExists();
  const base = { ...active.resort_slr_multipliers };
  const enso = { ...(active.resort_enso_slr_multipliers ?? {}) };
  for (const r of recs) {
    if (r.enso_phase) enso[r.resort_id] = { ...enso[r.resort_id], [r.enso_phase]: Number(r.recommended_multiplier) };
    else base[r.resort_id] = Number(r.recommended_multiplier);
  }
  const nBase = recs.filter((r) => !r.enso_phase).length;

  const draft = await createModelVersion({
    name: `Calibration: ${recs.length} approved together`,
    description: `Approved by ${by} in one step: ${nBase} year-round and ${recs.length - nBase} El Niño / La Niña multipliers from calibration_recommendations.`,
    config: toScoringConfig(active),
    resortSlrMultipliers: base,
    resortScoringOverrides: active.resort_scoring_overrides,
    resortEnsoSlrMultipliers: enso,
    parentVersionId: active.id,
    createdBy: by,
    status: "draft",
  });
  await activateModelVersion(draft.id, by);

  const { error: updError } = await db
    .from("calibration_recommendations")
    .update({ status: "approved", reviewed_by: by, reviewed_at: new Date().toISOString() })
    .in("id", recs.map((r) => r.id));
  if (updError) throw updError;
  return { approved: recs.length, versionId: draft.id, versionName: draft.name };
}
