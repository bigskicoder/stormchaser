import { describe, expect, it } from "vitest";
import { observedNewSnowIn } from "@/lib/backtest/accuracy";

describe("live scorecard ground truth", () => {
  it("uses the day's measured depth rise, not season-to-date snow water", () => {
    expect(observedNewSnowIn({ observed_depth_change_in: 6.5 })).toBe(6.5);
    expect(observedNewSnowIn({ observed_depth_change_in: 0 })).toBe(0);
  });
  it("skips days with no depth reading and never goes negative", () => {
    expect(observedNewSnowIn({ observed_depth_change_in: null })).toBeNull();
    expect(observedNewSnowIn({ observed_depth_change_in: -2 })).toBe(0);
  });
});
