/**
 * Expands the regional model-weighting hypothesis (lib/config/resort-regions.ts
 * + lib/config/regional-model-weights.ts — ROADMAP Phase B.5) into the
 * resort_scoring_overrides shape a model_versions row actually stores.
 * Separate from the region/weights data itself so that data can be unit
 * tested on its own shape, and this expansion logic can be unit tested
 * without needing real Resort rows.
 */

import { getServiceDb } from "@/lib/db/client";
import type { Resort, ResortScoringOverride } from "@/lib/db/types";
import { RESORT_REGIONS } from "@/lib/config/resort-regions";
import { REGIONAL_MODEL_WEIGHTS } from "@/lib/config/regional-model-weights";
import { partialScoringConfigToResortOverride } from "@/lib/scoring/config";

/**
 * Pure: builds resort_scoring_overrides entries for whichever resorts are
 * passed in. A resort absent from RESORT_REGIONS (not yet classified), or
 * classified into a region with no entry in REGIONAL_MODEL_WEIGHTS (today:
 * midwest-great-lakes — see that file's header for why), is simply left
 * out of the result rather than given a forced no-op entry: omission from
 * resort_scoring_overrides already means "inherit the version's global
 * config unchanged" per resolveScoringConfigForResort's own semantics, so
 * there's nothing to add for a resort with no regional hypothesis.
 * Exported for unit testing — no DB access.
 */
export function buildRegionalResortScoringOverrides(
  resorts: Array<Pick<Resort, "id" | "slug">>
): Record<string, ResortScoringOverride> {
  const overrides: Record<string, ResortScoringOverride> = {};
  for (const resort of resorts) {
    const region = RESORT_REGIONS[resort.slug];
    if (!region) continue;
    const weights = REGIONAL_MODEL_WEIGHTS[region];
    if (!weights) continue;
    overrides[resort.id] = partialScoringConfigToResortOverride({ modelWeightsByBucket: weights });
  }
  return overrides;
}

/** DB-aware wrapper: resolves every active resort and builds the full regional overrides map in one call — what scripts/create-regional-weighting-draft.ts actually calls. */
export async function buildRegionalResortScoringOverridesForAllResorts(): Promise<Record<string, ResortScoringOverride>> {
  const db = getServiceDb();
  const { data, error } = await db.from("resorts").select("id, slug").eq("active", true);
  if (error) throw error;
  return buildRegionalResortScoringOverrides((data ?? []) as Array<Pick<Resort, "id" | "slug">>);
}
