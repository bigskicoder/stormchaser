import { describe, expect, it } from "vitest";
import { cToF, kmhToMph } from "@/lib/utils/units";

describe("kmhToMph", () => {
  it("converts 100 km/h to ~62.14 mph", () => {
    expect(kmhToMph(100)).toBeCloseTo(62.1371, 3);
  });

  it("converts 0 to 0", () => {
    expect(kmhToMph(0)).toBe(0);
  });
});

describe("cToF", () => {
  it("converts freezing point", () => {
    expect(cToF(0)).toBe(32);
  });

  it("converts a negative temperature", () => {
    expect(cToF(-10)).toBe(14);
  });

  it("converts body temperature-ish value", () => {
    expect(cToF(100)).toBe(212);
  });
});
