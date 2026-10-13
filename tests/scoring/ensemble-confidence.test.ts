import { describe, expect, it } from "vitest";
import { scoreEnsembleConfidence } from "@/lib/scoring/ensemble-confidence";

describe("scoreEnsembleConfidence", () => {
  it("labels tight ensemble spread as high confidence", () => {
    const result = scoreEnsembleConfidence([10, 10.5, 9.8, 10.2, 10.1], false);
    expect(result.confidenceLabel).toBe("high");
    expect(result.ensembleSpreadScore).toBeGreaterThan(0.7);
  });

  it("labels wide ensemble spread as low confidence", () => {
    const result = scoreEnsembleConfidence([5, 40, 15, 60, 2], false);
    expect(result.confidenceLabel).toBe("low");
  });

  it("downgrades one tier when the independent disagreement flag is set", () => {
    const clean = scoreEnsembleConfidence([10, 10.5, 9.8, 10.2, 10.1], false);
    const withDisagreement = scoreEnsembleConfidence([10, 10.5, 9.8, 10.2, 10.1], true);
    expect(clean.confidenceLabel).toBe("high");
    expect(withDisagreement.confidenceLabel).toBe("medium");
    expect(withDisagreement.downgradedForDisagreement).toBe(true);
  });

  it("floors low confidence at low even with disagreement (no downgrade below low)", () => {
    const result = scoreEnsembleConfidence([5, 40, 15, 60, 2], true);
    expect(result.confidenceLabel).toBe("low");
  });

  it("handles an empty member list without throwing", () => {
    const result = scoreEnsembleConfidence([], false);
    expect(Number.isFinite(result.ensembleSpreadScore)).toBe(true);
  });

  describe("config override (model versioning)", () => {
    it("uses overridden thresholds instead of the compiled-in defaults", () => {
      // sd=10 -> spread score 1-10/25=0.6 -> "medium" by default thresholds (0.7/0.4)...
      const members = [0, 30, 10, 20, 15];
      const defaultResult = scoreEnsembleConfidence(members, false);
      expect(defaultResult.confidenceLabel).toBe("medium");
      // ...but becomes "high" under a much more permissive override.
      const lenientResult = scoreEnsembleConfidence(members, false, { thresholds: { HIGH_MIN: 0.01, MEDIUM_MIN: 0 } });
      expect(lenientResult.confidenceLabel).toBe("high");
    });

    it("uses an overridden spread-normalization ceiling instead of the compiled-in default", () => {
      const members = [10, 20, 30, 40, 50]; // real spread, would floor to low confidence by default
      const defaultResult = scoreEnsembleConfidence(members, false);
      // A much larger ceiling makes the same raw spread look "tight" by comparison.
      const lenientResult = scoreEnsembleConfidence(members, false, { spreadNormalizationCeilingMm: 1000 });
      expect(lenientResult.ensembleSpreadScore).toBeGreaterThan(defaultResult.ensembleSpreadScore);
    });
  });
});
