import { describe, expect, it } from "vitest";
import { slrMultiplierForPhase } from "@/lib/scoring/enso-multiplier";

describe("slrMultiplierForPhase", () => {
  const phaseMultipliers = { la_nina: 1.08 };

  it("uses the phase multiplier when one exists for that phase", () => {
    expect(slrMultiplierForPhase(1.0, phaseMultipliers, "la_nina")).toBe(1.08);
  });

  it("falls back to the base multiplier otherwise", () => {
    expect(slrMultiplierForPhase(1.0, phaseMultipliers, "el_nino")).toBe(1.0);
    expect(slrMultiplierForPhase(1.0, phaseMultipliers, "neutral")).toBe(1.0);
    expect(slrMultiplierForPhase(1.0, phaseMultipliers, null)).toBe(1.0);
    expect(slrMultiplierForPhase(0.95, undefined, "la_nina")).toBe(0.95);
  });
});
