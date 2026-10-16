import { describe, expect, it } from "vitest";
import { RESORTS_SEED } from "@/lib/config/resorts-seed";
import { RESORT_REGIONS, type ClimateRegion } from "@/lib/config/resort-regions";
import { REGIONAL_MODEL_WEIGHTS } from "@/lib/config/regional-model-weights";
import { MODEL_WEIGHTS_BY_BUCKET } from "@/lib/config/constants";

const VALID_REGIONS: ClimateRegion[] = ["pacific-maritime", "interior-west", "continental-rockies", "northeast-coastal", "midwest-great-lakes"];

describe("RESORT_REGIONS", () => {
  it("classifies every resort in the real seed roster — catches a new resort added without a region", () => {
    const unclassified = RESORTS_SEED.filter((r) => !RESORT_REGIONS[r.slug]).map((r) => r.slug);
    expect(unclassified).toEqual([]);
  });

  it("does not classify a resort that isn't in the real seed roster — catches a stale/typo'd slug", () => {
    const seedSlugs = new Set(RESORTS_SEED.map((r) => r.slug));
    const phantomSlugs = Object.keys(RESORT_REGIONS).filter((slug) => !seedSlugs.has(slug));
    expect(phantomSlugs).toEqual([]);
  });

  it("only uses valid ClimateRegion values", () => {
    for (const region of Object.values(RESORT_REGIONS)) {
      expect(VALID_REGIONS).toContain(region);
    }
  });
});

describe("REGIONAL_MODEL_WEIGHTS", () => {
  it("deliberately has no entry for midwest-great-lakes", () => {
    expect(REGIONAL_MODEL_WEIGHTS["midwest-great-lakes"]).toBeUndefined();
  });

  it("every weights table present sums to 1.0 per bucket (catches a hand-authored arithmetic error)", () => {
    for (const [region, weights] of Object.entries(REGIONAL_MODEL_WEIGHTS)) {
      for (const [bucket, modelWeights] of Object.entries(weights!)) {
        const sum = Object.values(modelWeights).reduce((a, b) => a + (b ?? 0), 0);
        expect(sum, `${region} ${bucket} should sum to 1.0`).toBeCloseTo(1.0, 10);
      }
    }
  });

  it("pacific-maritime, interior-west, and continental-rockies share the exact same weighting profile", () => {
    expect(REGIONAL_MODEL_WEIGHTS["pacific-maritime"]).toEqual(REGIONAL_MODEL_WEIGHTS["interior-west"]);
    expect(REGIONAL_MODEL_WEIGHTS["interior-west"]).toEqual(REGIONAL_MODEL_WEIGHTS["continental-rockies"]);
  });

  it("the mountain-west profile nudges T0_48 toward HRRR relative to the compiled-in baseline, taken from GFS", () => {
    const mountainWest = REGIONAL_MODEL_WEIGHTS["pacific-maritime"]!;
    expect(mountainWest.T0_48.hrrr).toBeGreaterThan(MODEL_WEIGHTS_BY_BUCKET.T0_48.hrrr!);
    expect(mountainWest.T0_48.gfs).toBeLessThan(MODEL_WEIGHTS_BY_BUCKET.T0_48.gfs!);
    expect(mountainWest.T0_48.icon).toBe(MODEL_WEIGHTS_BY_BUCKET.T0_48.icon);
    expect(mountainWest.T0_48.ecmwf).toBe(MODEL_WEIGHTS_BY_BUCKET.T0_48.ecmwf);
  });

  it("the mountain-west profile leaves T48_120/T120_PLUS identical to the compiled-in baseline", () => {
    const mountainWest = REGIONAL_MODEL_WEIGHTS["pacific-maritime"]!;
    expect(mountainWest.T48_120).toEqual(MODEL_WEIGHTS_BY_BUCKET.T48_120);
    expect(mountainWest.T120_PLUS).toEqual(MODEL_WEIGHTS_BY_BUCKET.T120_PLUS);
  });

  it("the northeast-coastal profile nudges ECMWF up at every bucket relative to the compiled-in baseline", () => {
    const northeast = REGIONAL_MODEL_WEIGHTS["northeast-coastal"]!;
    expect(northeast.T0_48.ecmwf).toBeGreaterThan(MODEL_WEIGHTS_BY_BUCKET.T0_48.ecmwf!);
    expect(northeast.T48_120.ecmwf).toBeGreaterThan(MODEL_WEIGHTS_BY_BUCKET.T48_120.ecmwf!);
    expect(northeast.T120_PLUS.ecmwf).toBeGreaterThan(MODEL_WEIGHTS_BY_BUCKET.T120_PLUS.ecmwf!);
  });

  it("the northeast-coastal profile holds HRRR at or below the compiled-in baseline at T0_48 (not boosted, unlike the mountain west)", () => {
    const northeast = REGIONAL_MODEL_WEIGHTS["northeast-coastal"]!;
    expect(northeast.T0_48.hrrr).toBeLessThanOrEqual(MODEL_WEIGHTS_BY_BUCKET.T0_48.hrrr!);
  });

  it("neither regional profile touches ICON or GEM anywhere — no evidence was found for either this session", () => {
    for (const weights of Object.values(REGIONAL_MODEL_WEIGHTS)) {
      for (const [bucket, modelWeights] of Object.entries(weights!)) {
        const baselineBucket = MODEL_WEIGHTS_BY_BUCKET[bucket as keyof typeof MODEL_WEIGHTS_BY_BUCKET];
        if ("icon" in baselineBucket) expect(modelWeights.icon).toBe(baselineBucket.icon);
        if ("gem" in baselineBucket) expect(modelWeights.gem).toBe(baselineBucket.gem);
      }
    }
  });
});
