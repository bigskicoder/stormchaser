import { describe, expect, it } from "vitest";
import { slugify, toUtm } from "@/lib/trail-difficulty/geo";
import { measureTrail } from "@/lib/trail-difficulty/measure";
import { joinWays, parseOverpass, type OverpassElement } from "@/lib/trail-difficulty/osm";
import { buildResortData } from "@/lib/trail-difficulty/pipeline";
import {
  featurePoints,
  groomingFromOsm,
  pitchPoints,
  pitchWindows,
  steepestWindowDeg,
  totalScore,
  widthPoints,
} from "@/lib/trail-difficulty/score";

const piece = (slopes: number[]) => ({ spacingM: 2, slopesDeg: slopes });
const flat = (deg: number, m: number) => Array<number>(m / 2).fill(deg);

describe("effective pitch", () => {
  it("scores a long sustained 30° above a 20° trail with one short 45° roll (Nick's example)", () => {
    const sustained = pitchWindows([piece(flat(30, 300))])!;
    expect(sustained.effectiveDeg).toBeCloseTo(30, 5);

    const roll = pitchWindows([piece([...flat(20, 150), ...flat(45, 10), ...flat(20, 140)])])!;
    expect(roll.windowsDeg[0]).toBeCloseTo(45, 5);
    expect(roll.effectiveDeg).toBeGreaterThan(24);
    expect(roll.effectiveDeg).toBeLessThan(26);
    expect(sustained.effectiveDeg).toBeGreaterThan(roll.effectiveDeg);
  });

  it("uses the whole trail for windows longer than it", () => {
    expect(steepestWindowDeg([piece(flat(25, 120))], 300)).toBeCloseTo(25, 5);
  });

  it("ignores short pieces for long windows when a long piece exists", () => {
    const v = steepestWindowDeg([piece(flat(40, 20)), piece(flat(22, 400))], 300);
    expect(v).toBeCloseTo(22, 5);
  });

  it("scales 10° to 0 and 45° to 60 pitch points", () => {
    expect(pitchPoints(10)).toBe(0);
    expect(pitchPoints(45)).toBe(60);
    expect(pitchPoints(27.5)).toBeCloseTo(30, 5);
    expect(pitchPoints(5)).toBe(0);
    expect(pitchPoints(60)).toBe(60);
  });
});

describe("other points", () => {
  it("width: 0 when wide, 10 when narrow, 3 when unknown", () => {
    expect(widthPoints(60)).toBe(0);
    expect(widthPoints(8)).toBe(10);
    expect(widthPoints(25)).toBeCloseTo(5, 5);
    expect(widthPoints(null)).toBe(3);
  });

  it("grooming from OSM tags", () => {
    expect(groomingFromOsm("classic")).toBe("groomed");
    expect(groomingFromOsm("mogul")).toBe("ungroomed");
    expect(groomingFromOsm("classic;mogul")).toBe("sometimes");
    expect(groomingFromOsm(undefined)).toBe("unknown");
  });

  it("features cap at 15", () => {
    const f = featurePoints({ trees: true, moguls: true, steepest10mDeg: 50, aspectDeg: 10 });
    expect(f.points).toBe(15);
    expect(f.labels).toContain("Trees");
    expect(featurePoints({ trees: false, moguls: false, steepest10mDeg: 30, aspectDeg: 180 }).points).toBe(0);
  });

  it("total stays within 1-100", () => {
    expect(totalScore({ pitch: 0, grooming: 0, width: 0, features: 0 })).toBe(1);
    expect(totalScore({ pitch: 60, grooming: 15, width: 10, features: 15 })).toBe(100);
  });
});

describe("geometry", () => {
  it("converts Stowe to UTM zone 18", () => {
    const [x, y] = toUtm(44.53, -72.79, 18);
    expect(x).toBeGreaterThan(675000);
    expect(x).toBeLessThan(676200);
    expect(y).toBeGreaterThan(4932500);
    expect(y).toBeLessThan(4933700);
  });

  it("slugs", () => {
    expect(slugify("Perry Merrill")).toBe("perry-merrill");
    expect(slugify("Lord's Way")).toBe("lords-way");
  });

  it("joins split ways end to end, in either direction", () => {
    const joined = joinWays([
      [
        [1, 1],
        [1, 2],
      ],
      [
        [1, 3],
        [1, 2],
      ],
      [
        [5, 5],
        [5, 6],
      ],
    ]);
    expect(joined).toHaveLength(2);
    expect(joined[0]).toEqual([
      [1, 1],
      [1, 2],
      [1, 3],
    ]);
  });
});

describe("measuring", () => {
  // A plane tilted 30° facing north: z rises to the south.
  const tan30 = Math.tan((30 * Math.PI) / 180);
  const plane = (_x: number, y: number) => 1000 - y * tan30;

  it("reads the fall-line slope and aspect of a plane, whichever way the line runs", () => {
    const across = measureTrail(
      [
        [
          [0, 0],
          [200, 0],
        ],
      ],
      (_x, y) => 1000 + y * tan30
    )!;
    expect(across.pieces[0]!.slopesDeg[10]).toBeCloseTo(30, 3);
    expect(across.aspectDeg).toBeCloseTo(180, 3);

    const down = measureTrail(
      [
        [
          [0, 0],
          [0, -300],
        ],
      ],
      plane
    )!;
    expect(down.aspectDeg).toBeCloseTo(0, 3);
    expect(down.verticalM).toBeCloseTo(300 * tan30, 0);
    expect(down.profileDeg.length).toBe(30);
  });
});

describe("pipeline", () => {
  it("builds a scored, sorted resort file from Overpass JSON", () => {
    const steep = Math.tan((35 * Math.PI) / 180);
    const easy = Math.tan((12 * Math.PI) / 180);
    const origin = toUtm(44.53, -72.8, 18);
    // Steep west of x=origin, gentle east of it; both fall to the north.
    const elevation = (x: number, y: number) => 1000 - (y - origin[1]) * (x < origin[0] ? steep : easy);
    const elements: OverpassElement[] = [
      {
        type: "way",
        id: 1,
        tags: { "piste:type": "downhill", name: "Steep One", "piste:difficulty": "expert", "piste:grooming": "mogul" },
        geometry: [
          { lat: 44.53, lon: -72.805 },
          { lat: 44.535, lon: -72.805 },
        ],
      },
      {
        type: "way",
        id: 2,
        tags: { "piste:type": "downhill", name: "Easy One", "piste:difficulty": "easy", "piste:grooming": "classic" },
        geometry: [
          { lat: 44.53, lon: -72.795 },
          { lat: 44.535, lon: -72.795 },
        ],
      },
      {
        type: "way",
        id: 3,
        tags: { "piste:type": "downhill", name: "Tiny Connector" },
        geometry: [
          { lat: 44.53, lon: -72.79 },
          { lat: 44.5302, lon: -72.79 },
        ],
      },
    ];
    const data = buildResortData({
      config: { slug: "test", name: "Test", bbox: [44.5, -72.85, 44.56, -72.75], areaName: /test/i, demProject: "X", utmZone: 18 },
      osm: parseOverpass(elements),
      elevation,
      measuredAt: "2026-10-18T00:00:00Z",
    });
    expect(data.trails.map((t) => t.name)).toEqual(["Steep One", "Easy One"]);
    const [hard, soft] = data.trails;
    expect(hard!.effectivePitchDeg).toBeCloseTo(35, 0);
    expect(hard!.resortRating).toBe("Double black");
    expect(hard!.grooming).toBe("ungroomed");
    expect(soft!.effectivePitchDeg).toBeCloseTo(12, 0);
    expect(hard!.score).toBeGreaterThan(soft!.score);
  });
});
