"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import {
  RADAR_MAX_ZOOM,
  RADAR_MIN_ZOOM,
  USGS_RELIEF_MAX_NATIVE_ZOOM,
  USGS_RELIEF_TILES,
  bboxToLatLngBounds,
  radarBboxAround,
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

let statesPromise: Promise<GeoJSON.FeatureCollection | null> | null = null;
function loadStates(): Promise<GeoJSON.FeatureCollection | null> {
  statesPromise ??= fetch("/us-states-10m.json")
    .then((r) => r.json())
    .then((topo: Topology) => feature(topo, topo.objects.states as GeometryCollection) as unknown as GeoJSON.FeatureCollection)
    .catch(() => null);
  return statesPromise;
}

/**
 * Resorts a few km apart (Alta, Snowbird, Brighton) land on top of each
 * other when zoomed out. The selected pin always keeps its label; any other
 * pin whose label would overlap one already placed shows as a bare dot
 * (still clickable, name in its tooltip). Widths are estimated from the
 * name length at the pins' font size. Positions are container pixels.
 */
function declutter<T extends { slug: string; name: string; x: number; y: number }>(
  pins: T[],
  selectedSlug: string | null,
  stageWidth: number
): (T & { labeled: boolean; flip: boolean })[] {
  const ordered = [...pins].sort((a, b) => Number(b.slug === selectedSlug) - Number(a.slug === selectedSlug));
  const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
  return ordered.map((p) => {
    const selected = p.slug === selectedSlug;
    const x = p.x - 7;
    const w = p.name.length * (selected ? 8 : 6.8) + 30;
    // Labels near the right edge open leftward (the "flip" class), so their box does too.
    const flip = p.x > stageWidth * 0.68;
    const box = flip ? { x0: x - w + 14, x1: x + 18, y0: p.y - 13, y1: p.y + 13 } : { x0: x - 4, x1: x + w, y0: p.y - 13, y1: p.y + 13 };
    const clash = boxes.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0);
    if (!clash || selected) boxes.push(box);
    return { ...p, labeled: selected || !clash, flip };
  });
}

/**
 * Whether a loaded radar tile has any echoes at all. Tiles come from our
 * own /api/radar proxy (same origin), so the canvas isn't tainted. A small
 * downscale is enough: any colored pixel survives as nonzero alpha.
 */
function tileHasEchoes(img: HTMLImageElement): boolean | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
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

// Tiles never change once loaded, so each is checked once.
const echoCache = new WeakMap<HTMLImageElement, boolean | null>();

/**
 * Whether the radar layer shows nothing anywhere in view: null while its
 * tiles are still loading or can't be read, otherwise true/false. Reads
 * the loaded tile images directly rather than tracking load events, which
 * race with pans and frame changes.
 */
function layerIsQuiet(layer: Leaflet.TileLayer, map: Leaflet.Map): boolean | null {
  if (layer.isLoading()) return null;
  const view = map.getContainer().getBoundingClientRect();
  const imgs = Array.from(layer.getContainer()?.querySelectorAll<HTMLImageElement>("img.leaflet-tile-loaded") ?? []).filter((img) => {
    const r = img.getBoundingClientRect();
    return r.right > view.left && r.left < view.right && r.bottom > view.top && r.top < view.bottom;
  });
  if (imgs.length === 0) return null;
  for (const img of imgs) {
    if (!echoCache.has(img)) echoCache.set(img, tileHasEchoes(img));
    const has = echoCache.get(img);
    if (has == null) return null;
    if (has) return false;
  }
  return true;
}

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const RADAR_OPACITY = 0.85;

/**
 * NOAA MRMS radar as a pannable, zoomable map with a 2-hour loop. It opens
 * on about 400 km around `center` and flies there again whenever `center`
 * changes. Terrain is USGS shaded relief with state lines on top; resort
 * pins re-center the view when clicked. See lib/radar/noaa.ts for the feed
 * choice and its fallback.
 *
 * Built on Leaflet directly (loaded in an effect, since it needs `window`)
 * rather than react-leaflet, so the map instance and its layers are owned
 * in one place and survive re-renders.
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
  const stageRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const frameLayers = useRef<Map<string, Leaflet.TileLayer>>(new Map());
  const markerLayer = useRef<Leaflet.LayerGroup | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const [ready, setReady] = useState(false);
  const [viewTick, setViewTick] = useState(0);
  const [frames, setFrames] = useState<FramesState>({ status: "loading" });
  const [index, setIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [preload, setPreload] = useState(false);
  const [failed, setFailed] = useState(false);
  const [quietState, setQuietState] = useState<boolean | null>(null);

  const frameList = frames.status === "ready" ? frames.frames : [];
  const hasLoop = frames.status === "ready" && frames.source === "noaa" && frameList.length > 1;
  const current = index ?? frameList.length - 1;
  // Frame keys: a timestamp, or "latest" when only IEM's latest composite is available.
  const frameKeys = useMemo(
    () => (frames.status !== "ready" ? [] : hasLoop ? frameList.map(String) : ["latest"]),
    [frames.status, hasLoop, frameList]
  );
  const shownKey = frameKeys[Math.min(Math.max(current, 0), frameKeys.length - 1)];

  useEffect(() => {
    let live = true;
    loadFrames().then((f) => live && setFrames({ status: "ready", ...f }));
    return () => {
      live = false;
    };
  }, []);

  // Create the map once.
  useEffect(() => {
    let disposed = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (disposed || !stageRef.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(stageRef.current, {
        minZoom: RADAR_MIN_ZOOM,
        maxZoom: RADAR_MAX_ZOOM,
        zoomSnap: 0.25,
        attributionControl: false,
        // Wheel zoom only after the map is clicked, so scrolling the page past it doesn't zoom it.
        scrollWheelZoom: false,
      });
      map.zoomControl.setPosition("topright");
      map.fitBounds(bboxToLatLngBounds(radarBboxAround(center.lat, center.lng)));
      L.tileLayer(USGS_RELIEF_TILES, {
        maxNativeZoom: USGS_RELIEF_MAX_NATIVE_ZOOM,
        maxZoom: RADAR_MAX_ZOOM,
        className: "ps-relief-tile",
      }).addTo(map);
      map.createPane("ps-states").style.zIndex = "350";
      map.createPane("ps-radar").style.zIndex = "360";
      loadStates().then((fc) => {
        if (!fc || disposed) return;
        L.geoJSON(fc, {
          pane: "ps-states",
          interactive: false,
          style: { color: "rgba(226, 236, 255, 0.6)", weight: 1.2, fill: false },
        }).addTo(map);
      });
      markerLayer.current = L.layerGroup().addTo(map);
      map.on("click", () => map.scrollWheelZoom.enable());
      map.on("mouseout", () => map.scrollWheelZoom.disable());
      map.on("zoomend moveend resize", () => setViewTick((t) => t + 1));
      mapRef.current = map;
      setReady(true);
    })();
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      frameLayers.current.clear();
    };
    // The map is created once; re-centering is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fly to a new center when the selected resort changes.
  const centerKey = `${center.lat},${center.lng}`;
  const firstCenter = useRef(true);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (firstCenter.current) {
      firstCenter.current = false;
      return;
    }
    map.flyToBounds(bboxToLatLngBounds(radarBboxAround(center.lat, center.lng)), { duration: 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerKey, ready]);

  const shownKeyRef = useRef(shownKey);
  shownKeyRef.current = shownKey;
  const checkQuiet = () => {
    const map = mapRef.current;
    const layer = shownKeyRef.current ? frameLayers.current.get(shownKeyRef.current) : undefined;
    setQuietState(map && layer ? layerIsQuiet(layer, map) : null);
  };
  useEffect(checkQuiet, [viewTick, shownKey]);

  // Radar layers: the shown frame always; every frame once the loop is played or scrubbed.
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map || frameKeys.length === 0) return;
    const wanted = preload ? frameKeys : shownKey ? [shownKey] : [];
    for (const key of wanted) {
      if (frameLayers.current.has(key)) continue;
      const url = key === "latest" ? "/api/radar/tile/{z}/{x}/{y}" : `/api/radar/tile/{z}/{x}/{y}?t=${key}`;
      const layer = L.tileLayer(url, {
        pane: "ps-radar",
        opacity: 0,
        minZoom: RADAR_MIN_ZOOM,
        maxZoom: RADAR_MAX_ZOOM,
        // Hidden frames keep their tiles so the loop plays from cache.
        keepBuffer: 4,
      });
      let loaded = 0;
      let errors = 0;
      layer.on("tileload", () => {
        loaded++;
      });
      layer.on("tileerror", () => {
        errors++;
      });
      layer.on("load", () => {
        if (key === shownKeyRef.current) {
          setFailed(errors > 0 && loaded === 0);
          checkQuiet();
        }
        loaded = 0;
        errors = 0;
      });
      layer.addTo(map);
      frameLayers.current.set(key, layer);
    }
    for (const [key, layer] of frameLayers.current) layer.setOpacity(key === shownKey ? RADAR_OPACITY : 0);
    checkQuiet();
    // checkQuiet only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, frameKeys, shownKey, preload]);

  useEffect(() => {
    if (!playing || !hasLoop) return;
    const timer = setInterval(() => {
      setIndex((i) => {
        const at = i ?? frameList.length - 1;
        return at >= frameList.length - 1 ? 0 : at + 1;
      });
    }, 650);
    return () => clearInterval(timer);
  }, [playing, hasLoop, frameList.length]);

  // Resort pins as Leaflet markers, re-decluttered whenever the view changes.
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const group = markerLayer.current;
    if (!L || !map || !group) return;
    group.clearLayers();
    const size = map.getSize();
    const onScreen = pins
      .map((p) => {
        const pt = map.latLngToContainerPoint([p.lat, p.lng]);
        return { ...p, x: pt.x, y: pt.y };
      })
      .filter((p) => p.x > -40 && p.x < size.x + 40 && p.y > -20 && p.y < size.y + 20);
    for (const p of declutter(onScreen, selectedSlug, size.x)) {
      const selected = p.slug === selectedSlug;
      const cls = `ps-radar-pin${p.labeled ? (p.flip ? " flip" : "") : " dot"}${selected ? " selected" : ""}`;
      const icon = L.divIcon({
        className: "ps-radar-marker",
        html: `<span class="${cls}" title="${p.labeled ? "" : escapeHtml(p.name)}"><i></i>${p.labeled ? escapeHtml(p.name) : ""}</span>`,
        iconSize: [0, 0],
      });
      const marker = L.marker([p.lat, p.lng], {
        icon,
        keyboard: !!onSelectRef.current,
        title: p.name,
        alt: p.name,
        zIndexOffset: selected ? 1000 : p.labeled ? 100 : 0,
        interactive: !!onSelectRef.current,
      });
      marker.on("click", () => onSelectRef.current?.(p.slug));
      group.addLayer(marker);
    }
  }, [ready, pins, selectedSlug, viewTick]);

  const quiet = quietState === true;
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
      <div className="ps-radar-stage">
        <div className="ps-radar-map" ref={stageRef} role="region" aria-labelledby="radar-title" />
        {quiet && !failed && (
          <div className="ps-radar-quiet">
            No rain or snow on radar in this view {current === frameList.length - 1 || !hasLoop ? "right now" : "at this time"}.
          </div>
        )}
        {failed && <div className="ps-radar-msg">Radar isn&rsquo;t loading right now. Try again in a few minutes.</div>}
        <div className="ps-radar-legend" aria-hidden="true">
          Light <span className="scale" /> Heavy
        </div>
      </div>
      <div className="ps-radar-controls">
        <button
          type="button"
          className="ps-radar-play"
          onClick={() => {
            setPreload(true);
            setPlaying((p) => !p);
          }}
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
              setPreload(true);
              setPlaying(false);
              setIndex(Number(e.target.value));
            }}
          />
        </label>
      </div>
      <p className="ps-radar-foot">
        Drag to pan; use + and &minus; or pinch to zoom (click the map first to zoom with the scroll wheel). Radar:{" "}
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
