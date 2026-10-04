import { describe, expect, it } from "vitest";
import { nextNDates } from "@/lib/scoring/run";

describe("nextNDates", () => {
  it("starts from the resort's LOCAL today, not UTC today", () => {
    // 6pm Mountain time on Jan 14 is already 1am UTC Jan 15 — the bug this
    // fixes would have started the list at Jan 15 instead of Jan 14.
    const now = new Date("2026-01-15T01:00:00Z"); // 6pm MST Jan 14
    const dates = nextNDates(5, "America/Denver", now);
    expect(dates[0]).toBe("2026-01-14");
    expect(dates).toEqual(["2026-01-14", "2026-01-15", "2026-01-16", "2026-01-17", "2026-01-18"]);
  });

  it("agrees with UTC when the instant is well within the same local and UTC day", () => {
    const now = new Date("2026-01-14T18:00:00Z"); // 11am MST Jan 14 — same calendar date either way
    const dates = nextNDates(3, "America/Denver", now);
    expect(dates).toEqual(["2026-01-14", "2026-01-15", "2026-01-16"]);
  });

  it("produces different lists for resorts in different timezones at the same instant", () => {
    // 6am UTC Jan 15 = 1am EST Jan 15 (already tomorrow locally) = 10pm PST Jan 14 (still today locally).
    const now = new Date("2026-01-15T06:00:00Z");
    const eastern = nextNDates(1, "America/New_York", now);
    const pacific = nextNDates(1, "America/Los_Angeles", now);
    expect(eastern[0]).toBe("2026-01-15");
    expect(pacific[0]).toBe("2026-01-14");
  });
});
