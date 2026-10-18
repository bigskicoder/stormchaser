/**
 * Measured trail data per resort, written by scripts/trail-difficulty-build.ts
 * (via the "Trail difficulty" GitHub workflow) and bundled with the site.
 * A resort whose file has no trails yet shows a "being measured" note.
 */
import stowe from "@/data/trail-difficulty/stowe.json";
import type { MeasuredTrail, ResortDifficultyData } from "./types";

const DATA: Record<string, ResortDifficultyData> = {
  stowe: stowe as unknown as ResortDifficultyData,
};

export function difficultyResorts(): ResortDifficultyData[] {
  return Object.values(DATA);
}

export function difficultyData(slug: string): ResortDifficultyData | undefined {
  return DATA[slug];
}

export function difficultyTrail(resortSlug: string, trailSlug: string): { resort: ResortDifficultyData; trail: MeasuredTrail } | undefined {
  const resort = DATA[resortSlug];
  const trail = resort?.trails.find((t) => t.slug === trailSlug);
  return resort && trail ? { resort, trail } : undefined;
}

/** Trails at the same resort with the closest scores, for "skis about the same". */
export function similarTrails(resort: ResortDifficultyData, trail: MeasuredTrail, count = 4): MeasuredTrail[] {
  return resort.trails
    .filter((t) => t.slug !== trail.slug)
    .sort((a, b) => Math.abs(a.score - trail.score) - Math.abs(b.score - trail.score))
    .slice(0, count);
}

/** Start index of the steepest run of `n` profile steps (for marking a window on the chart). */
export function steepestStretch(profile: number[], n: number): number {
  if (n >= profile.length) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += profile[i]!;
  let best = sum;
  let at = 0;
  for (let i = n; i < profile.length; i++) {
    sum += profile[i]! - profile[i - n]!;
    if (sum > best) {
      best = sum;
      at = i - n + 1;
    }
  }
  return at;
}

const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
export function compassWord(deg: number): string {
  return COMPASS[Math.round(deg / 45) % 8]!;
}
