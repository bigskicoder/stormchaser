import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCORING_CONFIG,
  partialScoringConfigToResortOverride,
  resolveScoringConfigForResort,
  scoringConfigToVersionFields,
  toScoringConfig,
} from "@/lib/scoring/config";
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

/** Minimal fixture — only the fields resolveScoringConfigForResort actually reads. */
function versionFixture(overrides: {
  slrStrategyName?: ModelVersion["slr_strategy_name"];
  resortOverrides?: ModelVersion["resort_scoring_overrides"];
} = {}): ModelVersion {
  return {
    ...(scoringConfigToVersionFields({ ...DEFAULT_SCORING_CONFIG, slrStrategyName: overrides.slrStrategyName ?? DEFAULT_SCORING_CONFIG.slrStrategyName }) as ModelVersion),
    resort_scoring_overrides: overrides.resortOverrides ?? {},
  };
}

describe("resolveScoringConfigForResort", () => {
  it("returns this version's own global config unchanged for a resort absent from resort_scoring_overrides — the common, un-differentiated case", () => {
    const version = versionFixture();
    expect(resolveScoringConfigForResort(version, "no-override-resort")).toEqual(toScoringConfig(version));
  });

  it("returns this version's own global config unchanged when the resort's override is an empty object", () => {
    const version = versionFixture({ resortOverrides: { "resort-1": {} } });
    expect(resolveScoringConfigForResort(version, "resort-1")).toEqual(toScoringConfig(version));
  });

  it("overlays only the fields a resort's override sets, leaving every other field as this version's own global value — not DEFAULT_SCORING_CONFIG", () => {
    const version = versionFixture({
      slrStrategyName: "fixed-ratio",
      resortOverrides: { "resort-1": { slr_strategy_name: "kuchera-wind" } },
    });
    const resolved = resolveScoringConfigForResort(version, "resort-1");
    expect(resolved.slrStrategyName).toBe("kuchera-wind");
    // Every other field still matches THIS version's own global config
    // (fixed-ratio base), proving the merge is per-field against the
    // version, not a wholesale replacement or a fall-through to defaults.
    expect(resolved.modelWeightsByBucket).toEqual(version.model_weights_by_bucket);
    expect(resolved.modelDisagreementThreshold).toBe(version.model_disagreement_threshold);
  });

  it("does not affect a different resort's resolved config", () => {
    const version = versionFixture({ resortOverrides: { "resort-1": { slr_strategy_name: "kuchera-wind" } } });
    expect(resolveScoringConfigForResort(version, "resort-2").slrStrategyName).toBe(version.slr_strategy_name);
  });

  it("overlays modelWeightsByBucket when a resort override sets it", () => {
    const customWeights = { T0_48: { hrrr: 1 }, T48_120: { gfs: 1 }, T120_PLUS: { ecmwf: 1 } };
    const version = versionFixture({ resortOverrides: { "resort-1": { model_weights_by_bucket: customWeights } } });
    expect(resolveScoringConfigForResort(version, "resort-1").modelWeightsByBucket).toEqual(customWeights);
  });

  it("can override every field at once", () => {
    const version = versionFixture({
      resortOverrides: {
        "resort-1": {
          model_weights_by_bucket: { T0_48: { hrrr: 1 }, T48_120: { hrrr: 1 }, T120_PLUS: { hrrr: 1 } },
          model_disagreement_threshold: 0.9,
          ensemble_confidence_thresholds: { HIGH_MIN: 0.99, MEDIUM_MIN: 0.5 },
          ensemble_spread_normalization_ceiling_mm: 1,
          slr_strategy_name: "kuchera-wind",
          powder_score_weights: { SNOWFALL: 1, CONFIDENCE: 0, LEAD_TIME_FIT: 0 },
          confidence_weight_by_label: { high: 1, medium: 1, low: 1 },
          actionable_window_hours: { min: 1, max: 2 },
          lead_time_fit_decay_per_hour: 0.5,
        },
      },
    });
    const resolved = resolveScoringConfigForResort(version, "resort-1");
    const override = version.resort_scoring_overrides["resort-1"]!;
    expect(resolved.modelWeightsByBucket).toEqual(override.model_weights_by_bucket);
    expect(resolved.modelDisagreementThreshold).toBe(override.model_disagreement_threshold);
    expect(resolved.ensembleConfidenceThresholds).toEqual(override.ensemble_confidence_thresholds);
    expect(resolved.ensembleSpreadNormalizationCeilingMm).toBe(override.ensemble_spread_normalization_ceiling_mm);
    expect(resolved.slrStrategyName).toBe(override.slr_strategy_name);
    expect(resolved.powderScoreWeights).toEqual(override.powder_score_weights);
    expect(resolved.confidenceWeightByLabel).toEqual(override.confidence_weight_by_label);
    expect(resolved.actionableWindowHours).toEqual(override.actionable_window_hours);
    expect(resolved.leadTimeFitDecayPerHour).toBe(override.lead_time_fit_decay_per_hour);
  });
});

describe("partialScoringConfigToResortOverride", () => {
  it("returns an empty object for an empty partial — no fields fabricated", () => {
    expect(partialScoringConfigToResortOverride({})).toEqual({});
  });

  it("carries over only the fields present, snake_cased, and nothing else", () => {
    const result = partialScoringConfigToResortOverride({ slrStrategyName: "kuchera-wind" });
    expect(result).toEqual({ slr_strategy_name: "kuchera-wind" });
  });

  it("carries over every field when every field is set", () => {
    const full = { ...DEFAULT_SCORING_CONFIG, slrStrategyName: "fixed-ratio" as const };
    const result = partialScoringConfigToResortOverride(full);
    expect(result).toEqual(scoringConfigToVersionFields(full));
  });
});
