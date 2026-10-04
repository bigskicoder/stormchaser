import { describe, expect, it } from "vitest";
import { chunk } from "@/lib/alerts/dispatch";

describe("chunk", () => {
  it("splits an array into groups of the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single chunk when items fit within the size", () => {
    expect(chunk([1, 2, 3], 100)).toEqual([[1, 2, 3]]);
  });

  it("returns an empty array for an empty input", () => {
    expect(chunk([], 100)).toEqual([]);
  });

  it("handles exact multiples of the chunk size with no trailing partial chunk", () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });
});
