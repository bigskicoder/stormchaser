/**
 * Operator-run: creates a DRAFT model version whose resort_scoring_overrides
 * apply the regional model-weighting hypothesis (lib/config/resort-regions.ts
 * + lib/config/regional-model-weights.ts — ROADMAP Phase B.5) to every
 * active resort with a classified region. Never activates or shadows the
 * draft itself — same "every activation/shadow-start is an explicit admin
 * click" principle already documented for every other version-creation
 * path in this codebase (Phase B.1/B.2). Start shadowing it from
 * /admin/model-versions when you're ready to compare it against real
 * data this season.
 *
 * Usage:
 *   npm run create:regional-weighting-draft
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env.
 * No live network calls of its own — reads/writes Postgres only.
 */

import { createBaselineVersionIfNoneExists, createModelVersion } from "../src/lib/model-versions/create";
import { getActiveModelVersion } from "../src/lib/model-versions/resolve";
import { buildRegionalResortScoringOverridesForAllResorts } from "../src/lib/model-versions/regional-overrides";
import { toScoringConfig } from "../src/lib/scoring/config";

async function main() {
  // Same fallback every other draft-creation path uses (admin API route,
  // calibration approval) — never throws on a brand-new deploy for lack
  // of a baseline.
  const source = (await getActiveModelVersion()) ?? (await createBaselineVersionIfNoneExists());
  console.log(`Cloning global config + lineage from "${source.name}" (${source.id}).`);

  const resortScoringOverrides = await buildRegionalResortScoringOverridesForAllResorts();
  const differentiatedCount = Object.keys(resortScoringOverrides).length;
  console.log(`Built regional overrides for ${differentiatedCount} resort(s) (every active resort with a classified region whose region has a weighting hypothesis — see regional-model-weights.ts for why some regions are deliberately excluded).`);

  const created = await createModelVersion({
    name: "Regional NWP weighting v1",
    description:
      "Phase B.5 — a reasoned (not fabricated, not yet data-validated) per-region model-weighting hypothesis. See ROADMAP.md and lib/config/regional-model-weights.ts for the full research/sourcing behind each region's weights.",
    config: toScoringConfig(source),
    resortSlrMultipliers: source.resort_slr_multipliers,
    resortScoringOverrides,
    resortEnsoSlrMultipliers: source.resort_enso_slr_multipliers,
    parentVersionId: source.id,
    createdBy: "script:create-regional-weighting-draft",
    status: "draft",
  });

  console.log(`\nCreated draft "${created.name}" (${created.id}).`);
  console.log("Next step: go to /admin/model-versions and click \"Start shadowing\" on this draft when you're ready to compare it against real data this season — nothing changes for live scoring until then.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
