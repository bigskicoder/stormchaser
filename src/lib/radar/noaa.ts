/**
 * Live radar for the public site (Nick, 2026-10-18: "use NOAA for now.
 * easiest and free and can revisit later on").
 *
 * Primary feed: NOAA/NWS MRMS base reflectivity, published as a
 * time-enabled ArcGIS ImageServer. US-government data, so free for any use
 * including commercial; about a 2-4 hour rolling window, refreshed every
 * 5-10 minutes. Fallback: Iowa State's IEM WMS of the same NEXRAD
 * composite, latest frame only (it has no matching time window for us to
 * animate across).
 *
 * Rejected: RainViewer. Since Jan 2026 it is personal/educational use only,
 * zoom is capped at 7 (too coarse for one resort) and nowcast frames are
 * gone. Snow-vs-rain coloring needs a paid feed (Rainbow.ai, Tomorrow.io,
 * Xweather) and is deferred.
 *
 * Images are fetched server-side through /api/radar/* so the browser never
 * depends on either host's CORS headers, and Vercel's CDN caches each
 * frame for every visitor looking at the same area.
 */

export const NOAA_RADAR_SERVICE =
  "https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer";
export const IEM_RADAR_WMS = "https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q.cgi";

/** Rendered radar image size. Fixed, so cached frames are shared across visitors. */
export const RADAR_IMAGE_WIDTH = 960;
export const RADAR_IMAGE_HEIGHT = 540;

/** Loop length and spacing. MRMS updates every 5-10 min, so 10 min steps never repeat a frame. */
export const RADAR_LOOP_MINUTES = 120;
export const RADAR_FRAME_STEP_MINUTES = 10;

/** Half the ground width of a resort-centered view: about 400 km across, enough to see a storm coming. */
export const RADAR_VIEW_HALF_WIDTH_KM = 200;

const EARTH_RADIUS_M = 6378137;
/** Web Mercator's valid square, ±π·R. */
const MERCATOR_LIMIT_M = Math.PI * EARTH_RADIUS_M;

export interface MercatorBbox {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

/** WGS84 lon/lat → Web Mercator (EPSG:3857) meters. */
export function lngLatToMercator(lng: number, lat: number): [number, number] {
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const x = (EARTH_RADIUS_M * lng * Math.PI) / 180;
  const y = EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI) / 360));
  return [x, y];
}

/**
 * A bbox centered on a point, RADAR_VIEW_HALF_WIDTH_KM to each side on the
 * ground, with the image's aspect ratio. Mercator stretches distances by
 * 1/cos(lat), so the half-width in projected meters grows with latitude.
 * Rounded to 1 km so nearby requests for the same resort share a cache key.
 */
export function radarBboxAround(lat: number, lng: number): MercatorBbox {
  const [cx, cy] = lngLatToMercator(lng, lat);
  const halfW = (RADAR_VIEW_HALF_WIDTH_KM * 1000) / Math.cos((lat * Math.PI) / 180);
  const halfH = (halfW * RADAR_IMAGE_HEIGHT) / RADAR_IMAGE_WIDTH;
  const r = (v: number) => Math.round(v / 1000) * 1000;
  return { xmin: r(cx - halfW), ymin: r(cy - halfH), xmax: r(cx + halfW), ymax: r(cy + halfH) };
}

/** Pixel position of a lon/lat inside a bbox rendered at width×height (origin top-left). */
export function projectToBbox(
  lng: number,
  lat: number,
  bbox: MercatorBbox,
  width = RADAR_IMAGE_WIDTH,
  height = RADAR_IMAGE_HEIGHT
): [number, number] {
  const [x, y] = lngLatToMercator(lng, lat);
  return [((x - bbox.xmin) / (bbox.xmax - bbox.xmin)) * width, ((bbox.ymax - y) / (bbox.ymax - bbox.ymin)) * height];
}

/** Parses "xmin,ymin,xmax,ymax" from a query string; null unless it's a sane, non-empty Web Mercator box. */
export function parseBbox(raw: string | null): MercatorBbox | null {
  if (!raw) return null;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [xmin, ymin, xmax, ymax] = parts as [number, number, number, number];
  if (xmin >= xmax || ymin >= ymax) return null;
  if ([xmin, ymin, xmax, ymax].some((n) => Math.abs(n) > MERCATOR_LIMIT_M)) return null;
  // Larger than a few states wide isn't a view this site makes; refusing it
  // keeps the route from being used as a general-purpose image proxy.
  if (xmax - xmin > 3_000_000 || ymax - ymin > 3_000_000) return null;
  return { xmin, ymin, xmax, ymax };
}

export function bboxParam(b: MercatorBbox): string {
  return `${b.xmin},${b.ymin},${b.xmax},${b.ymax}`;
}

/** NOAA ImageServer exportImage URL for one frame. `timeMs` omitted = latest. */
export function noaaExportImageUrl(bbox: MercatorBbox, timeMs?: number): string {
  const params = new URLSearchParams({
    bbox: bboxParam(bbox),
    bboxSR: "3857",
    imageSR: "3857",
    size: `${RADAR_IMAGE_WIDTH},${RADAR_IMAGE_HEIGHT}`,
    format: "png32",
    transparent: "true",
    f: "image",
  });
  if (timeMs != null) params.set("time", String(timeMs));
  return `${NOAA_RADAR_SERVICE}/exportImage?${params.toString()}`;
}

/** IEM WMS GetMap URL for the latest NEXRAD composite over the same bbox. */
export function iemLatestImageUrl(bbox: MercatorBbox): string {
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    LAYERS: "nexrad-n0q-900913",
    STYLES: "",
    SRS: "EPSG:3857",
    BBOX: bboxParam(bbox),
    WIDTH: String(RADAR_IMAGE_WIDTH),
    HEIGHT: String(RADAR_IMAGE_HEIGHT),
    FORMAT: "image/png",
    TRANSPARENT: "true",
  });
  return `${IEM_RADAR_WMS}?${params.toString()}`;
}

/**
 * Loop frame times from the service's [start, end] time extent: the latest
 * frame, then every RADAR_FRAME_STEP_MINUTES back for RADAR_LOOP_MINUTES,
 * never before the window's start. Oldest first, as the loop plays.
 */
export function framesFromTimeExtent(extent: unknown): number[] {
  if (!Array.isArray(extent) || extent.length !== 2) return [];
  const [start, end] = extent.map(Number) as [number, number];
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const step = RADAR_FRAME_STEP_MINUTES * 60_000;
  const count = Math.floor(RADAR_LOOP_MINUTES / RADAR_FRAME_STEP_MINUTES);
  const frames: number[] = [];
  for (let i = count; i >= 0; i--) {
    const t = end - i * step;
    if (t >= start) frames.push(t);
  }
  return frames;
}

/**
 * Terrain under the radar: USGS National Map shaded relief, a public-domain
 * US-government basemap served as standard Web Mercator tiles, so no key,
 * no attribution fee and no usage cap. The first live look (2026-10-18)
 * showed the state-outline-only background as an empty navy box whenever
 * no storm was nearby; relief makes the mountains and valleys readable.
 */
export const USGS_RELIEF_TILES =
  "https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/tile";

const TILE_PX = 256;
const MIN_TILE_ZOOM = 4;
/**
 * The deepest level USGS actually renders for this service. Its tileInfo
 * lists levels 0-23, but maxScale is 1:4,622,324 (level 7), and deeper
 * tiles fail; the first live deploy asked for level 9 and showed broken
 * images (2026-10-18). Level 7 is about 1.2 km per pixel, so at storm
 * scale the relief is upscaled about 2x, which soft shading tolerates.
 */
const MAX_TILE_ZOOM = 7;

export interface BasemapTile {
  url: string;
  /** Position and size as percentages of the bbox, so tiles scale with the stage. */
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The tiles covering a bbox, at the zoom where a tile pixel is no larger
 * than a stage pixel at `widthPx`, capped at MAX_TILE_ZOOM (so relief is
 * slightly scaled down where it can be, and upscaled past the cap).
 */
export function basemapTilesForBbox(bbox: MercatorBbox, widthPx = RADAR_IMAGE_WIDTH): BasemapTile[] {
  const world = 2 * MERCATOR_LIMIT_M;
  const metersPerPx = (bbox.xmax - bbox.xmin) / widthPx;
  const zoom = Math.max(MIN_TILE_ZOOM, Math.min(MAX_TILE_ZOOM, Math.ceil(Math.log2(world / (TILE_PX * metersPerPx)))));
  const tileM = world / 2 ** zoom;
  const x0 = Math.floor((bbox.xmin + MERCATOR_LIMIT_M) / tileM);
  const x1 = Math.floor((bbox.xmax + MERCATOR_LIMIT_M) / tileM);
  const y0 = Math.floor((MERCATOR_LIMIT_M - bbox.ymax) / tileM);
  const y1 = Math.floor((MERCATOR_LIMIT_M - bbox.ymin) / tileM);
  const spanX = bbox.xmax - bbox.xmin;
  const spanY = bbox.ymax - bbox.ymin;
  const tiles: BasemapTile[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const tileXmin = x * tileM - MERCATOR_LIMIT_M;
      const tileYmax = MERCATOR_LIMIT_M - y * tileM;
      tiles.push({
        url: `${USGS_RELIEF_TILES}/${zoom}/${y}/${x}`,
        left: ((tileXmin - bbox.xmin) / spanX) * 100,
        top: ((bbox.ymax - tileYmax) / spanY) * 100,
        width: (tileM / spanX) * 100,
        height: (tileM / spanY) * 100,
      });
    }
  }
  return tiles;
}
