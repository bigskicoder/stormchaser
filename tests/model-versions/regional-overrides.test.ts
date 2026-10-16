import { describe, expect, it } from "vitest";
import { buildRegionalResortScoringOverrides } from "@/lib/model-versions/regional-overrides";
import { REGIONAL_MODEL_WEIGHTS } from "@/lib/config/regional-model-weights";

describe("buildRegionalResortScoringOverrides", () => {
  it("produces an override for a resort whose region has a weighting hypothesis", () => {
    const overrides = buildRegionalResortScoringOverrides([{ id: "resort-1", slug: "alta" }]); // interior-west
    expect(overrides["resort-1"]).toBeDefined();
    expect(overrides["resort-1"]!.model_weights_by_bucket).toEqual(REGIONAL_MODEL_WEIGHTS["interior-west"]);
  });

  it("omits a resort whose region has no weighting hypothesis (midwest-great-lakes)", () => {
    const overrides = buildRegionalResortScoringOverrides([{ id: "resort-1", slug: "afton-alps" }]);
    expect(overrides).toEqual({});
  });

  it("omits a resort not present in RESORT_REGIONS at all, without throwing", () => {
    expect(() => buildRegionalResortScoringOverrides([{ id: "resort-1", slug: "not-a-real-resort" }])).not.toThrow();
    expect(buildRegionalResortScoringOverrides([{ id: "resort-1", slug: "not-a-real-resort" }])).toEqual({});
  });

  it("gives two resorts in the same region the exact same override, keyed by their own distinct ids", () => {
    const overrides = buildRegionalResortScoringOverrides([
      { id: "resort-alta", slug: "alta" },
      { id: "resort-snowbird", slug: "snowbird" },
    ]);
    expect(Object.keys(overrides).sort()).toEqual(["resort-alta", "resort-snowbird"]);
    expect(overrides["resort-alta"]).toEqual(overrides["resort-snowbird"]);
  });

  it("gives resorts in different regions different overrides", () => {
    const overrides = buildRegionalResortScoringOverrides([
      { id: "resort-alta", slug: "alta" }, // interior-west
      { id: "resort-stowe", slug: "stowe" }, // northeast-coastal
    ]);
    expect(overrides["resort-alta"]).not.toEqual(overrides["resort-stowe"]);
  });

  it("returns an empty object for an empty input list", () => {
    expect(buildRegionalResortScoringOverrides([])).toEqual({});
  });

  it("only sets model_weights_by_bucket — no other field is touched by the regional hypothesis", () => {
    const overrides = buildRegionalResortScoringOverrides([{ id: "resort-1", slug: "stowe" }]);
    const keys = Object.keys(overrides["resort-1"]!);
    expect(keys).toEqual(["model_weights_by_bucket"]);
  });
});
