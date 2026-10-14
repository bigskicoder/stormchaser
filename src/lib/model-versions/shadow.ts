/**
 * Shadow scoring — orthogonal to activation (lib/model-versions/activate.ts).
 * A shadowed version is computed every live scoring run alongside whichever
 * version is active, on the exact same forecast inputs, writing its own
 * is_primary=false snow_scores and accuracy_log rows (lib/scoring/run.ts) —
 * never read by the public site or the alert trigger, which only ever see
 * is_primary=true rows. Requested directly: "produce multiple models, run
 * them parallel this season, compare" (ROADMAP Phase B.2) — this is how a
 * draft accumulates real, same-storm comparison data before ever being
 * activated, continuously, not just via an operator-run backtest script.
 */

import { getServiceDb } from "@/lib/db/client";
import type { ModelVersion } from "@/lib/db/types";
import { ModelVersionNotFoundError } from "./activate";
import { getModelVersionById } from "./resolve";

export { ModelVersionNotFoundError };

/**
 * Setting isShadow=true on the currently active version is refused, not
 * silently ignored — the database's own check constraint
 * (model_versions_active_not_shadow) would reject it anyway, but failing
 * here with a clear message is more useful than a raw constraint-violation
 * error reaching the admin UI. Shadowing an already-active version would
 * also be pure waste: its shadow score and its primary score would be
 * mathematically identical, computed twice for nothing.
 */
export async function setShadowing(versionId: string, isShadow: boolean): Promise<ModelVersion> {
  const db = getServiceDb();
  const version = await getModelVersionById(versionId);
  if (!version) throw new ModelVersionNotFoundError(versionId);
  if (isShadow && version.status === "active") {
    throw new Error("the active version already scores live every run; shadowing it would just duplicate that computation");
  }

  const { data, error } = await db.from("model_versions").update({ is_shadow: isShadow }).eq("id", versionId).select().single();
  if (error) throw error;
  return data as ModelVersion;
}
