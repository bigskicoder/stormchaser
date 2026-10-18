/** Small geometry helpers for the trail measurements: WGS84 → UTM, resampling, simplifying. */

/** Latitude/longitude (degrees) to UTM easting/northing (m), northern hemisphere. */
export function toUtm(lat: number, lng: number, zone: number): [number, number] {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const k0 = 0.9996;
  const phi = (lat * Math.PI) / 180;
  const lam = (lng * Math.PI) / 180;
  const lam0 = ((-183 + 6 * zone) * Math.PI) / 180;
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  const N = a / Math.sqrt(1 - e2 * sin * sin);
  const T = Math.tan(phi) ** 2;
  const C = ep2 * cos * cos;
  const A = cos * (lam - lam0);
  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const x = k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  const y =
    k0 *
    (M +
      N *
        Math.tan(phi) *
        ((A * A) / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
  return [x, y];
}

/** Points every `step` metres along a polyline (planar metres), always including both ends. */
export function resample(line: [number, number][], step: number): [number, number][] {
  if (line.length === 0) return [];
  const out: [number, number][] = [line[0]!];
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1]!;
    const [x1, y1] = line[i]!;
    const seg = Math.hypot(x1 - x0, y1 - y0);
    let d = step - carry;
    while (d <= seg) {
      const t = d / seg;
      out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
      d += step;
    }
    carry = seg - (d - step);
  }
  const last = line[line.length - 1]!;
  const tail = out[out.length - 1]!;
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step / 4) out.push(last);
  return out;
}

export function lineLength(line: [number, number][]): number {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]);
  return s;
}

/** Douglas–Peucker on planar points; returns the indexes kept. */
export function simplifyIndexes(pts: [number, number][], tolerance: number): number[] {
  if (pts.length <= 2) return pts.map((_, i) => i);
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const [ax, ay] = pts[s]!;
    const [bx, by] = pts[e]!;
    const len = Math.hypot(bx - ax, by - ay);
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const [px, py] = pts[i]!;
      const d = len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: number[] = [];
  keep.forEach((k, i) => k && out.push(i));
  return out;
}

/** Area of a planar polygon (m²), shoelace. */
export function polygonArea(ring: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[(i + 1) % ring.length]!;
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
}

/** Point-in-polygon (ray casting), any consistent planar coordinates. */
export function pointInRing(p: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** URL slug for a trail name. */
export function slugify(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "trail"
  );
}
