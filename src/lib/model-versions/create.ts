import { getServiceDb } from "@/lib/db/client";
import type { ModelVersion, ResortScoringOverride, Resort } from "@/lib/db/types";
import { DEFAULT_SCORING_CONFIG, scoringConfigToVersionFields, type ScoringConfig } from "@/lib/scoring/config";
import { getActiveModelVersion } from "./resolve";

export interface CreateModelVersionParams {
  name: string;
  description?: string | null;
  config: ScoringConfig;
  /** resort_id -> slr_calibration_multiplier snapshot. Pass the live current values when snapshotting "now"; pass an edited copy when proposing a change to one or more resorts. */
  resortSlrMultipliers: Record<string, number>;
  /** resort_id -> partial scoring-config override snapshot (ROADMAP Phase B.3). Defaults to {} — no resort differs from this version's own global config unless explicitly set. */
  resortScoringOverrides?: Record<string, ResortScoringOverride>;
  /** resort_id -> El Nino / La Nina SLR multipliers (ROADMAP Phase B.6). Defaults to {}; pass the source version's when branching from it, or they're dropped. */
  resortEnsoSlrMultipliers?: ModelVersion["resort_enso_slr_multipliers"];
  parentVersionId?: string | null;
  createdBy: string;
  status?: "draft" | "active" | "archived";
}

export async function createModelVersion(params: CreateModelVersionParams): Promise<ModelVersion> {
  const db = getServiceDb();
  const status = params.status ?? "draft";
  const { data, error } = await db
    .from("model_versions")
    .insert({
      name: params.name,
      description: params.description ?? null,
      status,
      ...scoringConfigToVersionFields(params.config),
      resort_slr_multipliers: params.resortSlrMultipliers,
      resort_scoring_overrides: params.resortScoringOverrides ?? {},
      resort_enso_slr_multipliers: params.resortEnsoSlrMultipliers ?? {},
      parent_version_id: params.parentVersionId ?? null,
      created_by: params.createdBy,
      activated_by: status === "active" ? params.createdBy : null,
      activated_at: status === "active" ? new Date().toISOString() : null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as ModelVersion;
}

/** Current resort_id -> slr_calibration_multiplier for every active resort — the live values, not a version's snapshot of them. */
async function currentResortMultipliers(): Promise<Record<string, number>> {
  const db = getServiceDb();
  const { data, error } = await db.from("resorts").select("id, slr_calibration_multiplier").eq("active", true);
  if (error) throw error;
  const map: Record<string, number> = {};
  for (const r of (data ?? []) as Array<Pick<Resort, "id" | "slr_calibration_multiplier">>) {
    map[r.id] = r.slr_calibration_multiplier;
  }
  return map;
}

/**
 * Idempotent: if any model_versions row already exists, returns the
 * current active one (or the most recent, if somehow none is active) and
 * does nothing. Otherwise seeds and activates "v1 — baseline" from the
 * hardcoded defaults (lib/scoring/config.ts) and every resort's current
 * (live) SLR multiplier — the starting point every later version's
 * lineage traces back to. Call this once per deploy (e.g. from
 * scripts/seed-resorts.ts) rather than relying on getActiveModelVersion's
 * own null fallback forever, so live scores start getting a real
 * model_version_id instead of staying permanently version-less.
 */
export async function createBaselineVersionIfNoneExists(createdBy = "system:baseline"): Promise<ModelVersion> {
  const db = getServiceDb();
  const existingActive = await getActiveModelVersion();
  if (existingActive) return existingActive;

  const { data: anyExisting, error: anyError } = await db
    .from("model_versions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (anyError) throw anyError;
  if (anyExisting) return anyExisting as ModelVersion;

  const resortSlrMultipliers = await currentResortMultipliers();
  return createModelVersion({
    name: "v1 — baseline",
    description: "Seeded automatically from lib/config/constants.ts's hardcoded defaults and each resort's SLR multiplier at the time model versioning was turned on.",
    config: DEFAULT_SCORING_CONFIG,
    resortSlrMultipliers,
    parentVersionId: null,
    createdBy,
    status: "active",
  });
}
