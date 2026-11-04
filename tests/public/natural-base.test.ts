import { describe, expect, it } from "vitest";
import { summarizeNaturalBase } from "@/lib/public/natural-base";

const row = (date: string, depth_in: number, swe_mm = 100, calibrated = true) => ({ date, depth_in, swe_mm, calibrated });

describe("summarizeNaturalBase", () => {
  it("reads today, the week's change and the last projected day", () => {
    const rows = [row("2026-11-01", 10), row("2026-11-08", 18, 127), row("2026-11-09", 20), row("2026-11-18", 30)];
    const b = summarizeNaturalBase(rows, "2026-11-08", 15)!;
    expect(b.todayIn).toBe(18);
    expect(b.pastWeekChangeIn).toBe(8);
    expect(b.projectedIn).toBe(30);
    expect(b.projectedDate).toBe("2026-11-18");
    expect(b.sweIn).toBeCloseTo(5, 5);
    expect(b.stationDepthIn).toBe(15);
    expect(b.calibrated).toBe(true);
  });

  it("is null when today isn't modeled, and leaves out what isn't stored", () => {
    expect(summarizeNaturalBase([row("2026-11-07", 5)], "2026-11-08", null)).toBeNull();
    const b = summarizeNaturalBase([row("2026-11-08", 5, 50, false)], "2026-11-08", null)!;
    expect(b.pastWeekChangeIn).toBeNull();
    expect(b.projectedIn).toBeNull();
    expect(b.calibrated).toBe(false);
  });
});
