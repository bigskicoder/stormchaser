/**
 * The one function that changes what live scoring actually does —
 * everything else in lib/model-versions/ only reads or creates draft rows.
 * "Rollback" is just calling this with an older version's id; there's no
 * separate rollback code path, which is deliberate — rolling back and
 * rolling forward are the same operation (activate a specific version),
 * so there's only one path to get right and test.
 */

import { getServiceDb } from "@/lib/db/client";
import type { ModelVersion } from "@/lib/db/types";
import { getActiveModelVersion, getModelVersionById } from "./resolve";

export class ModelVersionNotFoundError extends Error {
  constructor(id: string) {
    super(`model version not found: ${id}`);
  }
}

/**
 * Activates `versionId`: archives whichever version is currently active
 * (if any), marks this one active, and writes its resort_slr_multipliers
 * snapshot back onto the live resorts table — so activating a version
 * immediately changes what the next scoring run produces, for both the
 * global weights (read fresh via getActiveScoringConfig each run) and the
 * per-resort SLR multipliers (written through to resorts now, same as
 * Phase B's existing apply.ts has always done on a calibration approval).
 *
 * Not wrapped in a DB transaction (the supabase-js client doesn't offer
 * one easily, and no other write path in this codebase uses one either —
 * consistent with the project's existing simplicity level). There's a
 * brief window with zero active versions between the archive and activate
 * writes; getActiveScoringConfig's DEFAULT_SCORING_CONFIG fallback makes
 * that window harmless even if a scoring run lands exactly inside it.
 */
export async function activateModelVersion(versionId: string, activatedBy: string): Promise<ModelVersion> {
  const db = getServiceDb();
  const target = await getModelVersionById(versionId);
  if (!target) throw new ModelVersionNotFoundError(versionId);

  const currentlyActive = await getActiveModelVersion();
  if (currentlyActive && currentlyActive.id !== versionId) {
    const { error: archiveError } = await db.from("model_versions").update({ status: "archived" }).eq("id", currentlyActive.id);
    if (archiveError) throw archiveError;
  }

  const { data: activated, error: activateError } = await db
    .from("model_versions")
    .update({ status: "active", activated_by: activatedBy, activated_at: new Date().toISOString() })
    .eq("id", versionId)
    .select()
    .single();
  if (activateError) throw activateError;

  // Only touches resorts present in this version's snapshot — a resort
  // added after this version was saved simply isn't in resort_slr_multipliers
  // and keeps whatever multiplier it already has, rather than being zeroed
  // or erroring the whole activation.
  for (const [resortId, multiplier] of Object.entries(target.resort_slr_multipliers)) {
    const { error: resortError } = await db.from("resorts").update({ slr_calibration_multiplier: multiplier }).eq("id", resortId);
    if (resortError) throw resortError;
  }

  return activated as ModelVersion;
}
