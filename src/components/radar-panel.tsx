"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import {
  RADAR_IMAGE_HEIGHT,
  RADAR_IMAGE_WIDTH,
  basemapTilesForBbox,
  bboxParam,
  projectToBbox,
  radarBboxAround,
  type MercatorBbox,
} from "@/lib/radar/noaa";

export interface RadarPin {
  slug: string;
  name: string;
  lat: number;
  lng: number;
}

type FramesState = { status: "loading" } | { status: "ready"; source: "noaa" | "iem"; frames: number[] };

// One fetch per page view, shared by every panel instance and re-centering.
let framesPromise: Promise<{ source: "noaa" | "iem"; frames: number[] }> | null = null;
function loadFrames() {
  framesPromise ??= fetch("/api/radar/frames")
    .then((r) => (r.ok ? r.json() : { source: "iem", frames: [] }))
    .catch(() => ({ source: "iem", frames: [] }));
  return framesPromise;
}

type StateRings = [number, number][][];
let statesPromise: Promise<StateRings> | null = null;
function loadStateRings(): Promise<StateRings> {
  statesPromise ??= fetch("/us-states-10m.json")
    .then((r) => r.json())
    .then((topo: Topology) => {
      const fc = feature(topo, topo.objects.states as GeometryCollection) as unknown as {
        features: { geometry: { type: string; coordinates: unknown } }[];
      };
      const rings: StateRings = [];
      for (const f of fc.features) {
        if (f.geometry.type === "Polygon") rings.push(...(f.geometry.coordinates as [number, number][][]));
        else if (f.geometry.type === "MultiPolygon")
          for (const poly of f.geometry.coordinates as [number, number][][][]) rings.push(...poly);
      }
      return rings;
    })
    .catch(() => []);
  return statesPromise;
}

function ringsToPath(rings: StateRings, bbox: MercatorBbox): string {
  const out: string[] = [];
  for (const ring of rings) {
    let d = "";
    ring.forEach(([lng, lat], i) => {
      const [x, y] = projectToBbox(lng, lat, bbox);
      d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    out.push(d + "Z");
  }
  return out.join("");
}

/**
 * Resorts a few km apart (Alta, Snowbird, Brighton) land on top of each
 * other at storm scale. The selected pin always keeps its label; any other
 * pin whose label would overlap one already placed shows as a bare dot
 * (still clickable, name in its tooltip). Widths are estimated from the
 * name length at the pins' font size.
 */
function declutter<T extends { slug: string; name: string; left: number; top: number }>(
  pins: T[],
  selectedSlug: string | null,
  stageWidth: number
): (T & { labeled: boolean })[] {
  const stageHeight = (stageWidth * RADAR_IMAGE_HEIGHT) / RADAR_IMAGE_WIDTH;
  const ordered = [...pins].sort((a, b) => Number(b.slug === selectedSlug) - Number(a.slug === selectedSlug));
  const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const out = ordered.map((p) => {
    const selected = p.slug === selectedSlug;
    const x = (p.left / 100) * stageWidth - 7;
    const y = (p.top / 100) * stageHeight;
    const w = p.name.length * (selected ? 8 : 6.8) + 30;
    // Labels near the right edge open leftward (the "flip" class), so their box does too.
    const box = p.left > 68 ? { x0: x - w + 14, x1: x + 18, y0: y - 13, y1: y + 13 } : { x0: x - 4, x1: x + w, y0: y - 13, y1: y + 13 };
    const clash = boxes.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0);
    if (!clash || selected) boxes.push(box);
    return { ...p, labeled: selected || !clash };
  });
  // Selected pin last so it paints over its neighbors.
  return out.reverse();
}

/**
 * Whether a loaded radar frame has any echoes at all. Frames come from our
 * own /api/radar proxy (same origin), so the canvas isn't tainted. A tiny
 * downscale is enough: any colored pixel survives as nonzero alpha.
 */
function frameHasEchoes(img: HTMLImageElement): boolean | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 192;
    canvas.height = 108;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 24) return true;
    return false;
  } catch {
    return null;
  }
}

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * NOAA MRMS radar around one point, as a 2-hour loop. The basemap is our
 * own state outlines (no third-party tiles, no API key); resort pins sit on
 * top and re-center the view when clicked. See lib/radar/noaa.ts for the
 * feed choice and its fallback.
 */
export function RadarPanel({
  center,
  pins,
  selectedSlug,
  onSelect,
  title,
  subtitle,
}: {
  center: { lat: number; lng: number };
  pins: RadarPin[];
  selectedSlug: string | null;
  onSelect?: (slug: string) => void;
  title: string;
  subtitle?: string;
}) {
  const bbox = useMemo(() => radarBboxAround(center.lat, center.lng), [center.lat, center.lng]);
  const [frames, setFrames] = useState<FramesState>({ status: "loading" });
  const [rings, setRings] = useState<StateRings>([]);
  const [index, setIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [echoes, setEchoes] = useState<Record<string, boolean | null>>({});
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(RADAR_IMAGE_WIDTH);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setStageWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let live = true;
    loadFrames().then((f) => live && setFrames({ status: "ready", ...f }));
    loadStateRings().then((r) => live && setRings(r));
    return () => {
      live = false;
    };
  }, []);

  const frameList = frames.status === "ready" ? frames.frames : [];
  const hasLoop = frameList.length > 1;
  const current = index ?? frameList.length - 1;

  // Re-centering starts back on the latest frame.
  useEffect(() => {
    setIndex(null);
    setPlaying(false);
    setFailed(new Set());
    setEchoes({});
  }, [bbox]);

  useEffect(() => {
    if (!playing || !hasLoop) return;
    timer.current = setInterval(() => {
      setIndex((i) => {
        const at = i ?? frameList.length - 1;
        return at >= frameList.length - 1 ? 0 : at + 1;
      });
    }, 550);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, hasLoop, frameList.length]);

  const statePath = useMemo(() => ringsToPath(rings, bbox), [rings, bbox]);
  const tiles = useMemo(() => basemapTilesForBbox(bbox), [bbox]);

  const placedPins = declutter(
    pins
      .map((p) => {
        const [x, y] = projectToBbox(p.lng, p.lat, bbox);
        return { ...p, left: (x / RADAR_IMAGE_WIDTH) * 100, top: (y / RADAR_IMAGE_HEIGHT) * 100 };
      })
      .filter((p) => p.left > 2 && p.left < 92 && p.top > 4 && p.top < 96),
    selectedSlug,
    stageWidth
  );

  const imageSrcs =
    frames.status !== "ready"
      ? []
      : frames.source === "noaa" && frameList.length > 0
        ? frameList.map((t) => `/api/radar/image?bbox=${bboxParam(bbox)}&t=${t}`)
        : [`/api/radar/image?bbox=${bboxParam(bbox)}`];
  const shown = Math.min(current, imageSrcs.length - 1);
  const allFailed = imageSrcs.length > 0 && imageSrcs.every((s) => failed.has(s));
  const shownSrc = imageSrcs[shown];
  const quiet = shownSrc != null && echoes[shownSrc] === false;
  const timeText =
    frames.status !== "ready"
      ? "loading"
      : hasLoop
        ? `${timeLabel(frameList[current]!)}${current === frameList.length - 1 ? " (latest)" : ""}`
        : "latest";

  return (
    <div className="ps-radar">
      <div className="ps-radar-head">
        <div>
          <h2 id="radar-title">{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      <div className="ps-radar-stage" role="group" aria-labelledby="radar-title" ref={stageRef}>
        <div className="ps-radar-relief" aria-hidden="true">
          {tiles.map((t) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={t.url}
              src={t.url}
              alt=""
              // A tile that fails to load is hidden rather than shown as a broken image.
              onError={(e) => (e.currentTarget.style.visibility = "hidden")}
              // +1px hides hairline seams where scaled tiles meet.
              style={{ left: `${t.left}%`, top: `${t.top}%`, width: `calc(${t.width}% + 1px)`, height: `calc(${t.height}% + 1px)` }}
            />
          ))}
        </div>
        <svg viewBox={`0 0 ${RADAR_IMAGE_WIDTH} ${RADAR_IMAGE_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
          <path d={statePath} fill="none" stroke="rgba(226, 236, 255, 0.55)" strokeWidth={1.4} />
        </svg>
        {imageSrcs.map((src, i) => (
          // Every frame stays mounted so the loop plays from cache; only one is visible.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={src}
            src={src}
            alt={i === shown ? `Radar around ${title.replace(/^Radar (around )?/, "")} at ${timeText}` : ""}
            aria-hidden={i === shown ? undefined : true}
            style={{ visibility: i === shown ? "visible" : "hidden" }}
            onError={() => setFailed((f) => new Set(f).add(src))}
            onLoad={(e) => {
              const has = frameHasEchoes(e.currentTarget);
              setEchoes((m) => ({ ...m, [src]: has }));
            }}
          />
        ))}
        {placedPins.map((p) => (
          <button
            key={p.slug}
            type="button"
            className={`ps-radar-pin${p.labeled ? (p.left > 68 ? " flip" : "") : " dot"}`}
            style={{ left: `${p.left}%`, top: `${p.top}%` }}
            aria-pressed={p.slug === selectedSlug}
            aria-label={p.labeled ? undefined : p.name}
            title={p.labeled ? undefined : p.name}
            onClick={() => onSelect?.(p.slug)}
            disabled={!onSelect}
          >
            <i aria-hidden="true" />
            {p.labeled && p.name}
          </button>
        ))}
        {quiet && !allFailed && (
          <div className="ps-radar-quiet">No rain or snow on radar in this area {current === frameList.length - 1 || !hasLoop ? "right now" : "at this time"}.</div>
        )}
        {allFailed && <div className="ps-radar-msg">Radar isn&rsquo;t loading right now. Try again in a few minutes.</div>}
        <div className="ps-radar-legend" aria-hidden="true">
          Light <span className="scale" /> Heavy
        </div>
      </div>
      <div className="ps-radar-controls">
        <button
          type="button"
          className="ps-radar-play"
          onClick={() => setPlaying((p) => !p)}
          disabled={!hasLoop}
          aria-label={playing ? "Pause radar loop" : "Play radar loop"}
        >
          {playing ? (
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
            </svg>
          ) : (
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 4l13 8-13 8z" />
            </svg>
          )}
        </button>
        <label className="ps-radar-time">
          <span>
            Radar, last 2 hours &middot; showing <strong>{timeText}</strong>
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(0, frameList.length - 1)}
            value={hasLoop ? current : 0}
            disabled={!hasLoop}
            onChange={(e) => {
              setPlaying(false);
              setIndex(Number(e.target.value));
            }}
          />
        </label>
      </div>
      <p className="ps-radar-foot">
        Radar:{" "}
        <a href="https://www.nssl.noaa.gov/projects/mrms/" target="_blank" rel="noreferrer">
          NOAA/NWS MRMS
        </a>
        {frames.status === "ready" && frames.source === "iem" && (
          <>
            {" "}
            via{" "}
            <a href="https://mesonet.agron.iastate.edu/" target="_blank" rel="noreferrer">
              Iowa Environmental Mesonet
            </a>
          </>
        )}
        . Terrain:{" "}
        <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noreferrer">
          USGS The National Map
        </a>
        . Colors show how heavy the precipitation is, not whether it&rsquo;s rain or snow. Mountains block radar beams, so
        snow over high terrain can be heavier than it looks here.
      </p>
    </div>
  );
}
