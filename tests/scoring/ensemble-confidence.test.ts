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
});
