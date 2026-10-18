import { describe, expect, it } from "vitest";
import {
  RADAR_FRAME_STEP_MINUTES,
  RADAR_IMAGE_HEIGHT,
  RADAR_IMAGE_WIDTH,
  framesFromTimeExtent,
  lngLatToMercator,
  noaaExportImageUrl,
  parseBbox,
  projectToBbox,
  radarBboxAround,
} from "@/lib/radar/noaa";

describe("lngLatToMercator", () => {
  it("maps the origin to 0,0 and 180° to the projection edge", () => {
    const [x0, y0] = lngLatToMercator(0, 0);
    expect(x0).toBeCloseTo(0, 6);
    expect(y0).toBeCloseTo(0, 6);
    expect(lngLatToMercator(180, 0)[0]).toBeCloseTo(20037508.34, 1);
  });
});

describe("radarBboxAround", () => {
  it("centers on the point and keeps the image aspect ratio", () => {
    const b = radarBboxAround(40.59, -111.64);
    const [x, y] = projectToBbox(-111.64, 40.59, b);
    expect(x).toBeCloseTo(RADAR_IMAGE_WIDTH / 2, 0);
    expect(y).toBeCloseTo(RADAR_IMAGE_HEIGHT / 2, 0);
    expect((b.xmax - b.xmin) / (b.ymax - b.ymin)).toBeCloseTo(RADAR_IMAGE_WIDTH / RADAR_IMAGE_HEIGHT, 2);
    expect(parseBbox(`${b.xmin},${b.ymin},${b.xmax},${b.ymax}`)).toEqual(b);
  });
});

describe("parseBbox", () => {
  it("rejects malformed, inverted, and oversized boxes", () => {
    expect(parseBbox(null)).toBeNull();
    expect(parseBbox("1,2,3")).toBeNull();
    expect(parseBbox("a,b,c,d")).toBeNull();
    expect(parseBbox("10,10,0,20")).toBeNull();
    expect(parseBbox("0,0,5000000,100")).toBeNull();
    expect(parseBbox("-1e9,0,0,10")).toBeNull();
  });
});

describe("framesFromTimeExtent", () => {
  const step = RADAR_FRAME_STEP_MINUTES * 60_000;
  it("ends on the latest frame and steps back, oldest first", () => {
    const end = 1_790_975_099_000;
    const frames = framesFromTimeExtent([end - 4 * 3600_000, end]);
    expect(frames.at(-1)).toBe(end);
    expect(frames[1]! - frames[0]!).toBe(step);
    expect(frames.length).toBe(13);
  });
  it("never asks for a frame before the window starts", () => {
    const end = 1_790_975_099_000;
    const frames = framesFromTimeExtent([end - 25 * 60_000, end]);
    expect(frames).toEqual([end - 2 * step, end - step, end]);
  });
  it("returns nothing for missing or bad extents", () => {
    expect(framesFromTimeExtent(undefined)).toEqual([]);
    expect(framesFromTimeExtent([5, 1])).toEqual([]);
  });
});

describe("noaaExportImageUrl", () => {
  it("asks for a transparent PNG in Web Mercator, with time only when given", () => {
    const b = { xmin: 0, ymin: 0, xmax: 960000, ymax: 540000 };
    const latest = new URL(noaaExportImageUrl(b));
    expect(latest.pathname.endsWith("/exportImage")).toBe(true);
    expect(latest.searchParams.get("bboxSR")).toBe("3857");
    expect(latest.searchParams.get("transparent")).toBe("true");
    expect(latest.searchParams.has("time")).toBe(false);
    expect(new URL(noaaExportImageUrl(b, 123)).searchParams.get("time")).toBe("123");
  });
});
