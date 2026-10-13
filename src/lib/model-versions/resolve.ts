/**
 * Read side of model versioning (ROADMAP Phase C). getActiveScoringConfig
 * is what lib/scoring/run.ts calls on every live scoring run — if no
 * active model_versions row exists yet (a fresh deploy, before the
 * baseline has been seeded), it falls back to DEFAULT_SCORING_CONFIG
 * (lib/scoring/config.ts, itself built from lib/config/constants.ts) so
 * live scoring never breaks for lack of a DB row.
 */

import { getServiceDb } from "@/lib/db/client";
import type { ModelVersion } from "@/lib/db/types";
import { DEFAULT_SCORING_CONFIG, toScoringConfig, type ScoringConfig } from "@/lib/scoring/config";

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

/** The config + version id the live scoring pipeline should use right now. versionId is null only when no model_versions row has ever been activated (pre-baseline). */
export async function getActiveScoringConfig(): Promise<{ config: ScoringConfig; versionId: string | null }> {
  const active = await getActiveModelVersion();
  if (!active) return { config: DEFAULT_SCORING_CONFIG, versionId: null };
  return { config: toScoringConfig(active), versionId: active.id };
}
