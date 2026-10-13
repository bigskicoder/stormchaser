import { describe, expect, it } from "vitest";
import { DEFAULT_SCORING_CONFIG, scoringConfigToVersionFields, toScoringConfig } from "@/lib/scoring/config";
import type { ModelVersion } from "@/lib/db/types";

describe("scoringConfigToVersionFields / toScoringConfig", () => {
  it("round-trips DEFAULT_SCORING_CONFIG through the model_versions row shape unchanged", () => {
    const versionFields = scoringConfigToVersionFields(DEFAULT_SCORING_CONFIG);
    // toScoringConfig only reads these columns, so a partial fixture is
    // enough — mirrors how lib/model-versions/resolve.ts narrows a full row.
    const fakeRow = versionFields as ModelVersion;
    expect(toScoringConfig(fakeRow)).toEqual(DEFAULT_SCORING_CONFIG);
  });

  it("carries a changed field through both directions", () => {
    const edited = { ...DEFAULT_SCORING_CONFIG, slrStrategyName: "fixed-ratio" as const, modelDisagreementThreshold: 0.25 };
    const versionFields = scoringConfigToVersionFields(edited);
    expect(versionFields.slr_strategy_name).toBe("fixed-ratio");
    expect(versionFields.model_disagreement_threshold).toBe(0.25);
    expect(toScoringConfig(versionFields as ModelVersion).slrStrategyName).toBe("fixed-ratio");
  });
});
