/**
 * Read side of model versioning (ROADMAP Phase C). getActiveModelVersion is
 * what lib/scoring/run.ts and both backtest scripts resolve once per run,
 * then pass into lib/scoring/config.ts's resolveScoringConfigForResort
 * (ROADMAP Phase B.3) to get each resort's own effective config — null
 * only when no model_versions row has ever been activated yet (a fresh
 * deploy, before the baseline has been seeded), in which case those callers
 * fall back to DEFAULT_SCORING_CONFIG themselves.
 */

import { getServiceDb } from "@/lib/db/client";
import type { ModelVersion } from "@/lib/db/types";

export async function getActiveModelVersion(): Promise<ModelVersion | null> {
  const db = getServiceDb();
  const { data, error } = await db.from("model_versions").select("*").eq("status", "active").maybeSingle();
  if (error) throw error;
  return data as ModelVersion | null;
}

export async function getModelVersionById(id: string): Promise<ModelVersion | null> {
  const db = getServiceDb();
  const { data, error } = await db.from("model_versions").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as ModelVersion | null;
}

export async function listModelVersions(): Promise<ModelVersion[]> {
  const db = getServiceDb();
  const { data, error } = await db.from("model_versions").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ModelVersion[];
}

/** Every version currently being scored in parallel alongside the active one — see lib/model-versions/shadow.ts. Never includes the active version itself (DB-enforced mutual exclusion). */
export async function listShadowModelVersions(): Promise<ModelVersion[]> {
  const db = getServiceDb();
  const { data, error } = await db.from("model_versions").select("*").eq("is_shadow", true);
  if (error) throw error;
  return (data ?? []) as ModelVersion[];
}
