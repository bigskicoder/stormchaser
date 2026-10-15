/**
 * Compares model versions using accuracy_log rows already tagged with
 * model_version_id (see lib/scoring/run.ts and the two backtest
 * pipelines) — a read-only aggregation over real computed history, not a
 * re-run. A version with no comparison data yet (never activated, never
 * backtested under) simply has zero samples; the caller decides how to
 * present that ("run a backtest under this version first").
 */

import { getServiceDb } from "@/lib/db/client";

export interface ModelVersionAccuracySummary {
  modelVersionId: string;
  sampleCount: number;
  meanAbsoluteErrorIn: number;
  hitRatePct: number;
}

const HIT_TOLERANCE_IN = 2;

/**
 * resortId (ROADMAP Phase B.3) narrows the comparison to one resort's own
 * accuracy_log rows — lets an admin check whether a resort-specific
 * override is actually helping THAT resort, not just the all-resorts
 * blend. Omit for the original all-resorts aggregate.
 */
export async function compareModelVersions(versionIds: string[], resortId?: string): Promise<ModelVersionAccuracySummary[]> {
  if (versionIds.length === 0) return [];
  const db = getServiceDb();
  let query = db
    .from("accuracy_log")
    .select("model_version_id, accuracy_error_in")
    .in("model_version_id", versionIds)
    .not("accuracy_error_in", "is", null);
  if (resortId) query = query.eq("resort_id", resortId);
  const { data, error } = await query;
  if (error) throw error;

  const errorsByVersion = new Map<string, number[]>();
  for (const row of (data ?? []) as Array<{ model_version_id: string | null; accuracy_error_in: number }>) {
    if (!row.model_version_id) continue;
    const list = errorsByVersion.get(row.model_version_id) ?? [];
    list.push(Math.abs(row.accuracy_error_in));
    errorsByVersion.set(row.model_version_id, list);
  }

  return versionIds.map((modelVersionId) => {
    const errors = errorsByVersion.get(modelVersionId) ?? [];
    if (errors.length === 0) return { modelVersionId, sampleCount: 0, meanAbsoluteErrorIn: 0, hitRatePct: 0 };
    return {
      modelVersionId,
      sampleCount: errors.length,
      meanAbsoluteErrorIn: errors.reduce((a, b) => a + b, 0) / errors.length,
      hitRatePct: (100 * errors.filter((e) => e <= HIT_TOLERANCE_IN).length) / errors.length,
    };
  });
}
