import type { Grooming, ScoreBreakdown } from "./score";

/** [lat, lng] */
export type LatLng = [number, number];

export interface MeasuredTrail {
  slug: string;
  name: string;
  /** The resort's own rating (from OSM), e.g. "Black". */
  resortRating: string | null;
  score: number;
  points: ScoreBreakdown;
  effectivePitchDeg: number;
  /** Steepest average pitch over 10 / 30 / 100 / 300 m. */
  windowsDeg: number[];
  lengthM: number;
  verticalM: number;
  grooming: Grooming;
  /** null when nothing in OSM gives a width. */
  widthM: number | null;
  featureLabels: string[];
  /** Compass bearing the steep part faces, or null. */
  aspectDeg: number | null;
  /** Average pitch every PROFILE_STEP_M along the longest piece, top to bottom. */
  profileDeg: number[];
  /** Map lines, one per mapped piece. */
  lines: LatLng[][];
}

export interface MeasuredLift {
  name: string;
  line: LatLng[];
}

export interface ResortDifficultyData {
  slug: string;
  name: string;
  measuredAt: string;
  center: LatLng;
  bounds: [LatLng, LatLng];
  sources: string[];
  trails: MeasuredTrail[];
  lifts: MeasuredLift[];
}

export const PROFILE_STEP_M = 10;
