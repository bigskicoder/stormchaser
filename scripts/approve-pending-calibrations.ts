/**
 * Approves every pending calibration recommendation at once, as ONE new
 * model version (base and El Nino / La Nina multipliers together), instead
 * of one version per row the way /admin/calibration does. Written for
 * Nick's 2026-11-04 instruction in the project thread ("approve them",
 * "50"). Rolled back like any approval: activate the parent version from
 * /admin/model-versions.
 *
 *   npx tsx scripts/approve-pending-calibrations.ts --by="Nick"
 */

import { getServiceDb } from "../src/lib/db/client";
import type { CalibrationRecommendation } from "../src/lib/db/types";
import { activateModelVersion } from "../src/lib/model-versions/activate";
import { createBaselineVersionIfNoneExists, createModelVersion } from "../src/lib/model-versions/create";
import { toScoringConfig } from "../src/lib/scoring/config";

async function main() {
  const by = process.argv.find((a) => a.startsWith("--by="))?.slice(5) || "admin";
  const db = getServiceDb();
  const { data, error } = await db.from("calibration_recommendations").select("*").eq("status", "pending");
  if (error) throw error;
  const recs = (data ?? []) as CalibrationRecommendation[];
  if (recs.length === 0) {
    console.log("No pending recommendations.");
    return;
  }

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
  console.log(`Activated "${draft.name}" (${draft.id}); parent ${active.id}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
