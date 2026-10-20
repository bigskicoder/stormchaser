import type { SnowpackDay } from "@/lib/snowpack/model";

/** A deterministic mountain winter: cold Dec-Feb storms every 4 days, spring warm-up, dry summer. */
export function syntheticWinter(waterYear: number, opts: { tempShiftC?: number; precipScale?: number } = {}): SnowpackDay[] {
  const days: SnowpackDay[] = [];
  const start = Date.UTC(waterYear - 1, 9, 1);
  for (let i = 0; i < 365; i++) {
    const d = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    // Coldest around day 110 (mid-January), warmest around day 290 (mid-July).
    const tMean = -2 + 10 * Math.sin(((i - 200) * 2 * Math.PI) / 365) + (opts.tempShiftC ?? 0) + ((waterYear * 7 + i * 13) % 5) - 2;
    const stormy = i % 4 === 0 && i < 240;
    days.push({
      date: d,
      precipMm: stormy ? (12 + ((i * 31) % 9)) * (opts.precipScale ?? 1) : 0,
      tMeanC: tMean,
      tMinC: tMean - 5,
      tMaxC: tMean + 5,
      rhPct: stormy ? 95 : 55,
      windMs: 4,
      pressureHpa: 720,
    });
  }
  return days;
}
