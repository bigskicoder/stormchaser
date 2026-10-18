/**
 * Measures one resort's trails for true trail difficulty (ROADMAP D.4) and
 * writes src/data/trail-difficulty/<slug>.json, which the /difficulty pages
 * read. Run by the "Trail difficulty" GitHub workflow, which commits the
 * file; the site redeploys on that push.
 *
 *   npx tsx scripts/trail-difficulty-build.ts --resort=stowe [--osm=file.json]
 *
 * Downloads (cached under local-data/trail-difficulty/):
 * - OSM trails, lifts and resort boundary from Overpass (or --osm=<file>).
 * - USGS 3DEP 1 m lidar tiles from the public prd-tnm S3 bucket, ~350 MB
 *   each; only the part inside the resort's bbox is read into memory.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import { fromFile } from "geotiff";
import { toUtm } from "../src/lib/trail-difficulty/geo";
import { overpassQuery, parseOverpass, type OverpassElement } from "../src/lib/trail-difficulty/osm";
import { buildResortData, type TrailOverrides } from "../src/lib/trail-difficulty/pipeline";
import { difficultyResort } from "../src/lib/trail-difficulty/resorts";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k!, v.join("=") || "true"];
  })
);

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const UA = "PowderSeeker/1.0 (https://powderseeker.us; trail difficulty)";
const TILE_M = 10000;
const MARGIN_M = 50;

async function fetchOsm(query: string): Promise<OverpassElement[]> {
  let last: unknown;
  for (const url of OVERPASS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(240_000),
        });
        if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
        const json = (await res.json()) as { elements: OverpassElement[] };
        return json.elements;
      } catch (e) {
        last = e;
        console.warn(`Overpass failed (${url}, try ${attempt + 1}): ${String(e)}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
  throw last;
}

async function download(url: string, file: string) {
  if (existsSync(file)) return;
  console.log(`Downloading ${url}`);
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok || !res.body) throw new Error(`${url} → HTTP ${res.status}`);
  const tmp = `${file}.part`;
  await streamPipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
  const { renameSync } = await import("node:fs");
  renameSync(tmp, file);
}

interface DemWindow {
  x0: number; // easting of column 0 (pixel centre)
  y0: number; // northing of row 0 (pixel centre)
  res: number;
  w: number;
  h: number;
  data: Float32Array;
  nodata: number | null;
}

async function loadDem(project: string, zone: number, bbox: [number, number, number, number], dir: string): Promise<DemWindow[]> {
  const [s, w, n, e] = bbox;
  const corners = [toUtm(s, w, zone), toUtm(s, e, zone), toUtm(n, w, zone), toUtm(n, e, zone)];
  const minE = Math.min(...corners.map((c) => c[0])) - MARGIN_M;
  const maxE = Math.max(...corners.map((c) => c[0])) + MARGIN_M;
  const minN = Math.min(...corners.map((c) => c[1])) - MARGIN_M;
  const maxN = Math.max(...corners.map((c) => c[1])) + MARGIN_M;

  const out: DemWindow[] = [];
  for (let tx = Math.floor(minE / TILE_M); tx <= Math.floor(maxE / TILE_M); tx++) {
    // USGS names 1 m tiles by their west and NORTH edges, in 10 km units.
    for (let ty = Math.ceil(minN / TILE_M); ty <= Math.ceil(maxN / TILE_M); ty++) {
      const name = `USGS_1M_${zone}_x${tx}y${ty}_${project}.tif`;
      const url = `https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/${project}/TIFF/${name}`;
      const file = path.join(dir, name);
      try {
        await download(url, file);
      } catch (err) {
        console.warn(`No lidar tile ${name}: ${String(err)}`);
        continue;
      }
      const img = await (await fromFile(file)).getImage();
      const [ox, oy] = img.getOrigin() as [number, number];
      const [rx, ry] = img.getResolution() as [number, number];
      const col0 = Math.max(0, Math.floor((minE - ox) / rx));
      const col1 = Math.min(img.getWidth(), Math.ceil((maxE - ox) / rx));
      const row0 = Math.max(0, Math.floor((maxN - oy) / ry));
      const row1 = Math.min(img.getHeight(), Math.ceil((minN - oy) / ry));
      if (col1 <= col0 || row1 <= row0) continue;
      console.log(`Reading ${name} columns ${col0}-${col1}, rows ${row0}-${row1}`);
      const rasters = await img.readRasters({ window: [col0, row0, col1, row1], samples: [0] });
      const nd = img.getGDALNoData();
      out.push({
        x0: ox + (col0 + 0.5) * rx,
        y0: oy + (row0 + 0.5) * ry,
        res: rx,
        w: col1 - col0,
        h: row1 - row0,
        data: rasters[0] as Float32Array,
        nodata: nd ?? null,
      });
    }
  }
  if (out.length === 0) throw new Error("No lidar covers this resort.");
  return out;
}

/** Bilinear elevation at an easting/northing, or null outside the lidar / on nodata. */
function makeElevation(wins: DemWindow[]) {
  return (x: number, y: number): number | null => {
    for (const d of wins) {
      const c = (x - d.x0) / d.res;
      const r = (d.y0 - y) / d.res;
      if (c < 0 || r < 0 || c >= d.w - 1 || r >= d.h - 1) continue;
      const c0 = Math.floor(c);
      const r0 = Math.floor(r);
      const fc = c - c0;
      const fr = r - r0;
      const i = r0 * d.w + c0;
      const v00 = d.data[i]!;
      const v01 = d.data[i + 1]!;
      const v10 = d.data[i + d.w]!;
      const v11 = d.data[i + d.w + 1]!;
      const bad = (v: number) => !Number.isFinite(v) || (d.nodata != null && Math.abs(v - d.nodata) < 1e-3) || v < -1000;
      if (bad(v00) || bad(v01) || bad(v10) || bad(v11)) return null;
      return v00 * (1 - fc) * (1 - fr) + v01 * fc * (1 - fr) + v10 * (1 - fc) * fr + v11 * fc * fr;
    }
    return null;
  };
}

async function main() {
  const config = difficultyResort(args.resort ?? "stowe");
  if (!config) throw new Error(`Unknown resort ${args.resort}`);
  const cache = path.resolve("local-data/trail-difficulty");
  mkdirSync(cache, { recursive: true });

  let elements: OverpassElement[];
  if (args.osm) elements = (JSON.parse(readFileSync(args.osm, "utf8")) as { elements: OverpassElement[] }).elements;
  else {
    elements = await fetchOsm(overpassQuery(config.bbox));
    writeFileSync(path.join(cache, `${config.slug}-osm.json`), JSON.stringify({ elements }));
  }
  const osm = parseOverpass(elements);
  console.log(`OSM: ${osm.trails.length} named trails, ${osm.lifts.length} lifts, ${osm.resortAreas.length} resort areas`);

  const dem = await loadDem(config.demProject, config.utmZone, config.bbox, args["dem-dir"] ?? cache);
  const overridesFile = path.resolve(`src/data/trail-difficulty/${config.slug}.overrides.json`);
  const overrides: TrailOverrides = existsSync(overridesFile) ? JSON.parse(readFileSync(overridesFile, "utf8")) : {};

  const data = buildResortData({
    config,
    osm,
    elevation: makeElevation(dem),
    overrides,
    measuredAt: new Date().toISOString(),
  });
  const outFile = path.resolve(`src/data/trail-difficulty/${config.slug}.json`);
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(data) + "\n");

  console.log(`\n${data.trails.length} trails measured → ${path.relative(process.cwd(), outFile)}\n`);
  console.log("Score  Eff°   10m  30m  100m 300m  Groom      Width  Resort rating  Trail");
  for (const t of data.trails) {
    console.log(
      `${String(t.score).padStart(5)}  ${t.effectivePitchDeg.toFixed(1).padStart(4)}  ${t.windowsDeg.map((d) => d.toFixed(0).padStart(4)).join(" ")}  ${t.grooming.padEnd(9)}  ${String(t.widthM ?? "?").padStart(5)}  ${(t.resortRating ?? "?").padEnd(13)}  ${t.name}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
