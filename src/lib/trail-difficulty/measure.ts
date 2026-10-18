/**
 * Turns a trail's mapped lines plus an elevation model into the inputs the
 * score needs: slope every SAMPLE_STEP_M, length, vertical, the direction
 * the steep part faces and a top-to-bottom pitch profile. Pure: the caller
 * passes elevation as a function (scripts/trail-difficulty/build.ts reads
 * USGS 1 m lidar for it; tests pass a formula).
 */
import { resample, lineLength } from "./geo";
import type { SlopePiece } from "./score";
import { PROFILE_STEP_M } from "./types";

/** Spacing of slope samples along the trail. */
export const SAMPLE_STEP_M = 2;
/**
 * Slope is the terrain gradient across ±BASELINE_M around each sample:
 * the fall-line steepness a skier meets there, whichever way the mapped
 * line runs, while a 6 m baseline smooths out single rocks and water bars
 * in 1 m lidar.
 */
export const BASELINE_M = 3;
/**
 * Mapped centrelines can sit several metres off the real trail, and on a
 * narrow trail or cat track that puts the sample on the trail-side bank.
 * So each sample takes the median slope across the trail, at these
 * sideways offsets: a wide fall-line run reads the same everywhere, while
 * a road cut into a sidehill reads as its flat bed, not its cutbank.
 */
export const CROSS_OFFSETS_M = [-6, -3, 0, 3, 6];

export type Elevation = (x: number, y: number) => number | null;

export interface TrailMeasurement {
  pieces: SlopePiece[];
  lengthM: number;
  verticalM: number;
  /** Compass bearing (0 = north) of the downhill direction, weighted to the steep parts; null if flat. */
  aspectDeg: number | null;
  /** Average pitch every PROFILE_STEP_M on the longest piece, top first. */
  profileDeg: number[];
}

interface Sample {
  slope: number;
  z: number;
  /** downhill unit-ish direction */
  dx: number;
  dy: number;
}

function gradientAt(elev: Elevation, x: number, y: number): Sample | null {
  const h = BASELINE_M;
  const z = elev(x, y);
  const e = elev(x + h, y);
  const w = elev(x - h, y);
  const n = elev(x, y + h);
  const s = elev(x, y - h);
  if (z == null || e == null || w == null || n == null || s == null) return null;
  const gx = (e - w) / (2 * h);
  const gy = (n - s) / (2 * h);
  const g = Math.hypot(gx, gy);
  return { slope: (Math.atan(g) * 180) / Math.PI, z, dx: -gx, dy: -gy };
}

/** Median-slope sample across the trail at (x, y); (ux, uy) is the unit direction along it. */
function sampleAcross(elev: Elevation, x: number, y: number, ux: number, uy: number): Sample | null {
  const centre = gradientAt(elev, x, y);
  if (!centre) return null;
  const slopes: number[] = [];
  for (const o of CROSS_OFFSETS_M) {
    const g = o === 0 ? centre : gradientAt(elev, x - uy * o, y + ux * o);
    if (g) slopes.push(g.slope);
  }
  slopes.sort((a, b) => a - b);
  return { ...centre, slope: slopes[Math.floor(slopes.length / 2)]! };
}

/** `lines` are planar metre coordinates (e.g. UTM), one per mapped piece. */
export function measureTrail(lines: [number, number][][], elev: Elevation): TrailMeasurement | null {
  const pieces: SlopePiece[] = [];
  const zs: number[] = [];
  let ax = 0;
  let ay = 0;
  let longest: Sample[] = [];
  let lengthM = 0;

  for (const line of lines) {
    if (line.length < 2) continue;
    lengthM += lineLength(line);
    const samples: Sample[] = [];
    const pts = resample(line, SAMPLE_STEP_M);
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i]!;
      const a = pts[Math.max(0, i - 1)]!;
      const b = pts[Math.min(pts.length - 1, i + 1)]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const s = sampleAcross(elev, x, y, (b[0] - a[0]) / len, (b[1] - a[1]) / len);
      if (s) samples.push(s);
    }
    if (samples.length === 0) continue;
    pieces.push({ spacingM: SAMPLE_STEP_M, slopesDeg: samples.map((s) => s.slope) });
    for (const s of samples) {
      zs.push(s.z);
      // Weight the facing direction by slope², so the steep pitches decide it.
      const len = Math.hypot(s.dx, s.dy);
      if (len > 0) {
        const wgt = s.slope * s.slope;
        ax += (s.dx / len) * wgt;
        ay += (s.dy / len) * wgt;
      }
    }
    if (samples.length > longest.length) longest = samples;
  }
  if (pieces.length === 0) return null;

  const aspectDeg = Math.hypot(ax, ay) > 0 ? (((Math.atan2(ax, ay) * 180) / Math.PI) % 360 + 360) % 360 : null;

  // Profile runs top to bottom.
  const ordered = longest[0]!.z >= longest[longest.length - 1]!.z ? longest : [...longest].reverse();
  const per = Math.max(1, Math.round(PROFILE_STEP_M / SAMPLE_STEP_M));
  const profileDeg: number[] = [];
  for (let i = 0; i < ordered.length; i += per) {
    const chunk = ordered.slice(i, i + per);
    if (chunk.length < per / 2 && profileDeg.length > 0) break;
    profileDeg.push(chunk.reduce((a, s) => a + s.slope, 0) / chunk.length);
  }

  return {
    pieces,
    lengthM,
    verticalM: Math.max(...zs) - Math.min(...zs),
    aspectDeg,
    profileDeg,
  };
}
