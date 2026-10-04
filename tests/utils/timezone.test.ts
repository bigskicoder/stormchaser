import { describe, expect, it } from "vitest";
import { localDateRangeToUtc } from "@/lib/utils/timezone";

describe("localDateRangeToUtc", () => {
  it("returns the UTC midnight range unchanged for the UTC timezone itself", () => {
    const { start, end } = localDateRangeToUtc("2026-01-15", "UTC");
    expect(start).toBe("2026-01-15T00:00:00.000Z");
    expect(end).toBe("2026-01-16T00:00:00.000Z");
  });

  it("shifts the range by the fixed winter offset for America/Denver (MST, UTC-7)", () => {
    const { start, end } = localDateRangeToUtc("2026-01-15", "America/Denver");
    expect(start).toBe("2026-01-15T07:00:00.000Z");
    expect(end).toBe("2026-01-16T07:00:00.000Z");
  });

  it("shifts the range by the fixed winter offset for America/Los_Angeles (PST, UTC-8)", () => {
    const { start, end } = localDateRangeToUtc("2026-01-15", "America/Los_Angeles");
    expect(start).toBe("2026-01-15T08:00:00.000Z");
    expect(end).toBe("2026-01-16T08:00:00.000Z");
  });

  it("uses the summer DST offset for America/Denver in July (MDT, UTC-6)", () => {
    const { start, end } = localDateRangeToUtc("2026-07-15", "America/Denver");
    expect(start).toBe("2026-07-15T06:00:00.000Z");
    expect(end).toBe("2026-07-16T06:00:00.000Z");
  });

  it("produces a 23-hour UTC range on the US spring-forward DST transition day", () => {
    // 2026-03-08 is the second Sunday in March (US DST start). Denver goes
    // MST (UTC-7) -> MDT (UTC-6) at 2am local, so this calendar day is only
    // 23 real hours long.
    const { start, end } = localDateRangeToUtc("2026-03-08", "America/Denver");
    const hours = (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60);
    expect(hours).toBe(23);
    expect(start).toBe("2026-03-08T07:00:00.000Z"); // still MST at local midnight
    expect(end).toBe("2026-03-09T06:00:00.000Z"); // already MDT by next local midnight
  });

  it("produces a 25-hour UTC range on the US fall-back DST transition day", () => {
    // 2026-11-01 is the first Sunday in November (US DST end). Denver goes
    // MDT (UTC-6) -> MST (UTC-7) at 2am local, so this calendar day is 25
    // real hours long.
    const { start, end } = localDateRangeToUtc("2026-11-01", "America/Denver");
    const hours = (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60);
    expect(hours).toBe(25);
  });

  it("gives different (non-overlapping, adjacent) ranges for consecutive days", () => {
    const day1 = localDateRangeToUtc("2026-01-15", "America/New_York");
    const day2 = localDateRangeToUtc("2026-01-16", "America/New_York");
    expect(day1.end).toBe(day2.start);
  });
});
