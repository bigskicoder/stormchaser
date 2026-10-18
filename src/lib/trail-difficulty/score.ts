/**
 * True trail difficulty (ROADMAP D.4): one absolute 1–100 score per trail,
 * measured from lidar and OpenStreetMap instead of the resort's own color,
 * so trails compare across mountains. 100 is hardest.
 *
 * Points (Nick, 2026-10-18):
 *   effective pitch 60 · grooming 15 · width 10 · features 15
 *
 * Effective pitch blends how steep a trail gets over four lengths, so a
 * short steep roll counts less than a long sustained pitch (Nick: "a trail
 * with a 10m 45 deg pitch would score more than a 30 deg sustained
 * otherwise"). Everything here is pure; scripts/trail-difficulty/build.ts
 * does the downloading and sampling.
 */

/** Window lengths (m) and their weights in the effective pitch. Nick approved these. */
export const PITCH_WINDOWS = [
  { lengthM: 10, weight: 0.1 },
  { lengthM: 30, weight: 0.2 },
  { lengthM: 100, weight: 0.3 },
  { lengthM: 300, weight: 0.4 },
] as const;

/** Effective pitch that scores 0 pitch points, and the one that scores all 60. */
export const PITCH_ZERO_DEG = 10;
export const PITCH_FULL_DEG = 45;

export const MAX_POINTS = { pitch: 60, grooming: 15, width: 10, features: 15 } as const;

/** Wider than this scores no width points; narrower than WIDTH_FULL_M scores all 10. */
export const WIDTH_ZERO_M = 40;
export const WIDTH_FULL_M = 10;
/** Width points when nothing in OSM gives a width. */
export const WIDTH_UNKNOWN_POINTS = 3;

/**
 * A steepest 10 m at or above CLIFF_DEG counts as a cliff band / no-fall
 * section, but only when the steepest 30 m is also at least
 * CLIFF_SUPPORT_DEG: a lone 10 m spike on an otherwise moderate trail is
 * usually the line crossing a road cut or stream bank, not a ledge.
 */
export const CLIFF_DEG = 45;
export const CLIFF_SUPPORT_DEG = 38;

export const FEATURE_POINTS = { trees: 6, moguls: 5, cliff: 5, northFacing: 4, northish: 2 } as const;

export type Grooming = "groomed" | "sometimes" | "ungroomed" | "unknown";

export const GROOMING_POINTS: Record<Grooming, number> = { groomed: 0, sometimes: 7, ungroomed: 15, unknown: 7 };

/** One continuous stretch of a trail: slope (degrees) at evenly spaced points. */
export interface SlopePiece {
  spacingM: number;
  slopesDeg: number[];
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Steepest average slope over any stretch `lengthM` long. A trail mapped as
 * several disconnected pieces uses the best piece that is long enough; if
 * none is, the longest piece's overall average stands in (a 120 m trail's
 * "steepest 300 m" is just the whole trail).
 */
export function steepestWindowDeg(pieces: SlopePiece[], lengthM: number): number | null {
  const usable = pieces.filter((p) => p.slopesDeg.length > 0);
  if (usable.length === 0) return null;
  let best: number | null = null;
  for (const p of usable) {
    const n = Math.max(1, Math.round(lengthM / p.spacingM));
    if (n > p.slopesDeg.length) continue;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += p.slopesDeg[i]!;
    let top = sum;
    for (let i = n; i < p.slopesDeg.length; i++) {
      sum += p.slopesDeg[i]! - p.slopesDeg[i - n]!;
      if (sum > top) top = sum;
    }
    const avg = top / n;
    if (best == null || avg > best) best = avg;
  }
  if (best != null) return best;
  const longest = usable.reduce((a, b) => (b.slopesDeg.length * b.spacingM > a.slopesDeg.length * a.spacingM ? b : a));
  return mean(longest.slopesDeg);
}

export interface PitchWindows {
  /** Steepest average pitch for each of PITCH_WINDOWS, same order. */
  windowsDeg: number[];
  effectiveDeg: number;
}

export function pitchWindows(pieces: SlopePiece[]): PitchWindows | null {
  const windowsDeg: number[] = [];
  for (const w of PITCH_WINDOWS) {
    const v = steepestWindowDeg(pieces, w.lengthM);
    if (v == null) return null;
    windowsDeg.push(v);
  }
  const effectiveDeg = PITCH_WINDOWS.reduce((s, w, i) => s + w.weight * windowsDeg[i]!, 0);
  return { windowsDeg, effectiveDeg };
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export function pitchPoints(effectiveDeg: number): number {
  return MAX_POINTS.pitch * clamp01((effectiveDeg - PITCH_ZERO_DEG) / (PITCH_FULL_DEG - PITCH_ZERO_DEG));
}

export function widthPoints(widthM: number | null): number {
  if (widthM == null) return WIDTH_UNKNOWN_POINTS;
  return MAX_POINTS.width * clamp01((WIDTH_ZERO_M - widthM) / (WIDTH_ZERO_M - WIDTH_FULL_M));
}

/** Smallest angle between two compass bearings, 0–180. */
export function bearingGap(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

export interface FeatureInputs {
  trees: boolean;
  moguls: boolean;
  /** Steepest 10 m and 30 m, degrees. */
  steepest10mDeg: number;
  steepest30mDeg: number;
  /** Compass bearing the steep part faces (downhill direction), or null if flat. */
  aspectDeg: number | null;
}

export interface FeatureResult {
  points: number;
  labels: string[];
}

export function featurePoints(f: FeatureInputs): FeatureResult {
  const labels: string[] = [];
  let pts = 0;
  if (f.trees) {
    pts += FEATURE_POINTS.trees;
    labels.push("Trees");
  }
  if (f.moguls) {
    pts += FEATURE_POINTS.moguls;
    labels.push("Moguls");
  }
  if (f.steepest10mDeg >= CLIFF_DEG && f.steepest30mDeg >= CLIFF_SUPPORT_DEG) {
    pts += FEATURE_POINTS.cliff;
    labels.push("Cliff band or no-fall pitch");
  }
  if (f.aspectDeg != null) {
    const gap = bearingGap(f.aspectDeg, 0);
    if (gap <= 45) {
      pts += FEATURE_POINTS.northFacing;
      labels.push("North-facing, holds ice");
    } else if (gap <= 67.5) {
      pts += FEATURE_POINTS.northish;
      labels.push("Faces partly north");
    }
  }
  return { points: Math.min(MAX_POINTS.features, pts), labels };
}

export interface ScoreBreakdown {
  pitch: number;
  grooming: number;
  width: number;
  features: number;
}

/** Total, rounded and kept within 1–100. */
export function totalScore(b: ScoreBreakdown): number {
  return Math.min(100, Math.max(1, Math.round(b.pitch + b.grooming + b.width + b.features)));
}

/** Map color band for a score: five even bands, light to hot. */
export function scoreBand(score: number): 1 | 2 | 3 | 4 | 5 {
  if (score > 80) return 5;
  if (score > 60) return 4;
  if (score > 40) return 3;
  if (score > 20) return 2;
  return 1;
}

export const BAND_COLORS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "#9BE7C4",
  2: "#5FB4FF",
  3: "#FFD166",
  4: "#FF8A3D",
  5: "#FF4D8D",
};

/**
 * OSM piste:grooming → our grooming class. OSM uses "classic" for a
 * groomed downhill run, "mogul" for bumps, "backcountry"/"no" for none.
 * A run tagged both groomed and mogul is groomed some days.
 */
export function groomingFromOsm(tag: string | undefined): Grooming {
  if (!tag) return "unknown";
  const parts = tag.toLowerCase().split(/[;+,]/).map((s) => s.trim());
  const groomed = parts.some((p) => ["classic", "skating", "yes", "groomed", "scooter"].includes(p));
  const not = parts.some((p) => ["mogul", "backcountry", "no", "none"].includes(p));
  if (groomed && not) return "sometimes";
  if (groomed) return "groomed";
  if (not) return "ungroomed";
  return "unknown";
}

/** The resort's own rating, from OSM piste:difficulty, in North American terms. */
export function resortRatingFromOsm(tag: string | undefined): string | null {
  switch ((tag ?? "").toLowerCase()) {
    case "novice":
    case "easy":
      return "Green";
    case "intermediate":
      return "Blue";
    case "advanced":
      return "Black";
    case "expert":
      return "Double black";
    case "freeride":
    case "extreme":
      return "Expert only";
    default:
      return null;
  }
}
