/**
 * OSM trails + elevation → the scored data file one resort's pages read
 * (src/data/trail-difficulty/<slug>.json). Pure apart from the elevation
 * function; scripts/trail-difficulty/build.ts supplies OSM and lidar.
 */
import { lineLength, pointInRing, polygonArea, simplifyIndexes, slugify, toUtm } from "./geo";
import { type Elevation, measureTrail } from "./measure";
import type { OsmData, OsmTrail } from "./osm";
import type { DifficultyResortConfig } from "./resorts";
import {
  type Grooming,
  GROOMING_POINTS,
  featurePoints,
  groomingFromOsm,
  pitchPoints,
  pitchWindows,
  resortRatingFromOsm,
  totalScore,
  widthPoints,
} from "./score";
import type { LatLng, MeasuredTrail, ResortDifficultyData } from "./types";

/** Trails shorter than this are connectors and cat tracks between runs, not runs. */
export const MIN_TRAIL_LENGTH_M = 80;

/** Hand corrections from someone who knows the mountain, by trail name. */
export interface TrailOverride {
  grooming?: Grooming;
  widthM?: number;
  trees?: boolean;
  moguls?: boolean;
  exclude?: boolean;
}
export type TrailOverrides = Record<string, TrailOverride>;

const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

function insideResort(t: OsmTrail, rings: LatLng[][]): boolean {
  if (rings.length === 0) return true;
  const pts = t.pieces.flat();
  const inside = pts.filter((p) => rings.some((r) => pointInRing(p, r))).length;
  return inside >= pts.length / 2;
}

function widthFromOsm(t: OsmTrail, utm: (p: LatLng) => [number, number], centerlineM: number): number | null {
  const tag = Number.parseFloat(t.tags.width ?? t.tags["piste:width"] ?? "");
  if (Number.isFinite(tag) && tag > 0) return tag;
  if (t.areas.length === 0 || centerlineM <= 0) return null;
  const area = t.areas.reduce((s, r) => s + polygonArea(r.map(utm)), 0);
  const w = area / centerlineM;
  return w >= 3 && w <= 200 ? w : null;
}

function hasTrees(t: OsmTrail): boolean {
  return t.tags.gladed === "yes" || t.tags["piste:gladed"] === "yes" || /\b(glade|glades|woods|trees)\b/i.test(t.name);
}

function simplifyLine(line: LatLng[], utm: (p: LatLng) => [number, number]): LatLng[] {
  return simplifyIndexes(line.map(utm), 1.5).map((i) => {
    const [lat, lng] = line[i]!;
    return [round(lat, 6), round(lng, 6)] as LatLng;
  });
}

export function buildResortData(args: {
  config: DifficultyResortConfig;
  osm: OsmData;
  elevation: Elevation;
  overrides?: TrailOverrides;
  measuredAt: string;
}): ResortDifficultyData {
  const { config, osm, elevation, overrides = {}, measuredAt } = args;
  const utm = (p: LatLng) => toUtm(p[0], p[1], config.utmZone);
  const rings = osm.resortAreas.filter((a) => config.areaName.test(a.name)).map((a) => a.ring);

  const trails: MeasuredTrail[] = [];
  const slugs = new Set<string>();
  for (const t of osm.trails) {
    const o = overrides[t.name] ?? {};
    if (o.exclude || !insideResort(t, rings)) continue;
    const lines = t.pieces.map((p) => p.map(utm));
    const centerline = lines.reduce((s, l) => s + lineLength(l), 0);
    if (centerline < MIN_TRAIL_LENGTH_M) continue;
    const m = measureTrail(lines, elevation);
    if (!m) continue;
    const pw = pitchWindows(m.pieces);
    if (!pw) continue;

    const grooming = o.grooming ?? groomingFromOsm(t.tags["piste:grooming"]);
    const trees = o.trees ?? hasTrees(t);
    const moguls = o.moguls ?? /mogul/i.test(t.tags["piste:grooming"] ?? "");
    const widthM = o.widthM ?? widthFromOsm(t, utm, centerline) ?? (trees ? 10 : null);
    const features = featurePoints({ trees, moguls, steepest10mDeg: pw.windowsDeg[0]!, aspectDeg: m.aspectDeg });
    const points = {
      pitch: round(pitchPoints(pw.effectiveDeg)),
      grooming: GROOMING_POINTS[grooming],
      width: round(widthPoints(widthM)),
      features: features.points,
    };

    let slug = slugify(t.name);
    for (let i = 2; slugs.has(slug); i++) slug = `${slugify(t.name)}-${i}`;
    slugs.add(slug);

    trails.push({
      slug,
      name: t.name,
      resortRating: resortRatingFromOsm(t.tags["piste:difficulty"]),
      score: totalScore(points),
      points,
      effectivePitchDeg: round(pw.effectiveDeg),
      windowsDeg: pw.windowsDeg.map((d) => round(d)),
      lengthM: Math.round(m.lengthM),
      verticalM: Math.round(m.verticalM),
      grooming,
      widthM: widthM == null ? null : Math.round(widthM),
      featureLabels: features.labels,
      aspectDeg: m.aspectDeg == null ? null : Math.round(m.aspectDeg),
      profileDeg: m.profileDeg.map((d) => round(d)),
      lines: t.pieces.map((p) => simplifyLine(p, utm)),
    });
  }
  trails.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const allPts = trails.flatMap((t) => t.lines.flat());
  const lats = allPts.map((p) => p[0]);
  const lngs = allPts.map((p) => p[1]);
  const [s, w, n, e] = config.bbox;
  const bounds: [LatLng, LatLng] = allPts.length
    ? [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ]
    : [
        [s, w],
        [n, e],
      ];

  return {
    slug: config.slug,
    name: config.name,
    measuredAt,
    center: [round((bounds[0][0] + bounds[1][0]) / 2, 5), round((bounds[0][1] + bounds[1][1]) / 2, 5)],
    bounds,
    sources: [
      `USGS 3DEP 1 m lidar (${config.demProject}), public domain`,
      "Trails and lifts © OpenStreetMap contributors (ODbL)",
    ],
    trails,
    lifts: osm.lifts
      .filter((l) => l.line.length >= 2 && (rings.length === 0 || l.line.some((p) => rings.some((r) => pointInRing(p, r)))))
      .map((l) => ({ name: l.name, line: simplifyLine(l.line, utm) })),
  };
}
