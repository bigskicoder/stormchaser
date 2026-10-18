/**
 * OpenStreetMap (Overpass JSON, `out geom`) → named downhill trails, lifts
 * and resort boundaries. OSM often splits one trail into several ways and
 * sometimes names only the route relation, so ways are grouped by name
 * (their own, else their relation's) and joined end to end into pieces.
 */
import type { LatLng } from "./types";

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  tags?: Record<string, string>;
  nodes?: number[];
  geometry?: { lat: number; lon: number }[];
  members?: { type: string; ref: number; role: string; geometry?: { lat: number; lon: number }[] }[];
}

export interface OsmTrail {
  name: string;
  /** Tags merged from every way (and relation) of the trail; first value wins. */
  tags: Record<string, string>;
  /** Joined line pieces. */
  pieces: LatLng[][];
  /** Piste areas (area=yes) with the same name, as closed rings. */
  areas: LatLng[][];
}

export interface OsmData {
  trails: OsmTrail[];
  lifts: { name: string; line: LatLng[] }[];
  resortAreas: { name: string; ring: LatLng[] }[];
}

const LIFT_TYPES = new Set(["chair_lift", "gondola", "mixed_lift", "cable_car", "drag_lift", "t-bar", "j-bar", "platter", "magic_carpet", "rope_tow"]);

function geom(g: { lat: number; lon: number }[] | undefined): LatLng[] {
  return (g ?? []).map((p) => [p.lat, p.lon] as LatLng);
}

function key(p: LatLng): string {
  return `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
}

function isClosed(coords: LatLng[]): boolean {
  return coords.length > 3 && key(coords[0]!) === key(coords[coords.length - 1]!);
}

/**
 * Join lines that share an end point into the longest possible chains.
 * Matched on coordinates rather than node ids, because relation members in
 * Overpass output carry geometry but no node list.
 */
export function joinWays(lines: LatLng[][]): LatLng[][] {
  const left = lines.filter((l) => l.length >= 2).map((l) => [...l]);
  const out: LatLng[][] = [];
  while (left.length) {
    let coords = left.shift()!;
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const w = left[i]!;
        const head = key(coords[0]!);
        const tail = key(coords[coords.length - 1]!);
        const wh = key(w[0]!);
        const wt = key(w[w.length - 1]!);
        if (wh === tail) coords = coords.concat(w.slice(1));
        else if (wt === tail) coords = coords.concat([...w].reverse().slice(1));
        else if (wt === head) coords = w.slice(0, -1).concat(coords);
        else if (wh === head) coords = [...w].reverse().slice(0, -1).concat(coords);
        else continue;
        left.splice(i, 1);
        grew = true;
        break;
      }
    }
    out.push(coords);
  }
  return out;
}

function mergeTags(into: Record<string, string>, from: Record<string, string> | undefined) {
  for (const [k, v] of Object.entries(from ?? {})) if (!(k in into)) into[k] = v;
}

export function parseOverpass(elements: OverpassElement[]): OsmData {
  const ways = new Map<number, OverpassElement>();
  for (const e of elements) if (e.type === "way") ways.set(e.id, e);

  // A way with no name of its own takes the name of a downhill route relation it belongs to.
  const relName = new Map<number, { name: string; tags: Record<string, string> }>();
  const resortAreas: OsmData["resortAreas"] = [];
  for (const e of elements) {
    if (e.type !== "relation" || !e.tags) continue;
    if (e.tags["piste:type"] === "downhill" && (e.tags.name || e.tags["piste:name"])) {
      const name = (e.tags.name ?? e.tags["piste:name"])!;
      for (const m of e.members ?? []) if (m.type === "way" && !relName.has(m.ref)) relName.set(m.ref, { name, tags: e.tags });
    }
    if (e.tags.landuse === "winter_sports" && e.tags.type === "multipolygon") {
      for (const m of e.members ?? []) if (m.role === "outer" && m.geometry) resortAreas.push({ name: e.tags.name ?? "", ring: geom(m.geometry) });
    }
  }

  const groups = new Map<string, { tags: Record<string, string>; lines: LatLng[][]; areas: LatLng[][] }>();
  const lifts: OsmData["lifts"] = [];
  for (const w of ways.values()) {
    const t = w.tags ?? {};
    if (t.landuse === "winter_sports" && isClosed(geom(w.geometry))) {
      resortAreas.push({ name: t.name ?? "", ring: geom(w.geometry) });
      continue;
    }
    if (t.aerialway && LIFT_TYPES.has(t.aerialway)) {
      lifts.push({ name: t.name ?? "", line: geom(w.geometry) });
      continue;
    }
    const rel = relName.get(w.id);
    if (t["piste:type"] !== "downhill" && rel == null) continue;
    const name = (t["piste:name"] ?? t.name ?? rel?.name)?.trim();
    if (!name) continue;
    const g = groups.get(name) ?? { tags: {}, lines: [], areas: [] };
    mergeTags(g.tags, t);
    mergeTags(g.tags, rel?.tags);
    const coords = geom(w.geometry);
    if (t.area === "yes" && isClosed(coords)) g.areas.push(coords);
    else g.lines.push(coords);
    groups.set(name, g);
  }

  // Untagged member ways of a named route relation only come back inside the relation.
  for (const e of elements) {
    if (e.type !== "relation" || e.tags?.["piste:type"] !== "downhill") continue;
    const name = (e.tags.name ?? e.tags["piste:name"])?.trim();
    if (!name) continue;
    for (const m of e.members ?? []) {
      if (m.type !== "way" || ways.has(m.ref) || !m.geometry) continue;
      const g = groups.get(name) ?? { tags: {}, lines: [], areas: [] };
      mergeTags(g.tags, e.tags);
      g.lines.push(geom(m.geometry));
      groups.set(name, g);
    }
  }

  const trails: OsmTrail[] = [];
  for (const [name, g] of groups) {
    if (g.lines.length === 0) continue;
    trails.push({ name, tags: g.tags, pieces: joinWays(g.lines), areas: g.areas });
  }
  trails.sort((a, b) => a.name.localeCompare(b.name));
  return { trails, lifts, resortAreas };
}

/** Overpass query for one bbox (south, west, north, east). */
export function overpassQuery(bbox: [number, number, number, number]): string {
  const b = bbox.join(",");
  return `[out:json][timeout:180];
(
  way["piste:type"="downhill"](${b});
  relation["piste:type"="downhill"](${b});
  way["aerialway"](${b});
  way["landuse"="winter_sports"](${b});
  relation["landuse"="winter_sports"](${b});
);
out geom;`;
}
