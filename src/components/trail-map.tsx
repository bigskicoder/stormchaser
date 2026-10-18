"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BAND_COLORS, scoreBand } from "@/lib/trail-difficulty/score";
import type { LatLng } from "@/lib/trail-difficulty/types";

/**
 * Satellite base map: USGS National Map imagery (NAIP aerial photos at
 * high zoom), public domain, no key. Nick chose satellite over the
 * resorts' own trail maps, which are copyrighted (2026-10-18). Summer
 * photos show cut trails clearly against the trees.
 *
 * USGS lists levels 0-23 for this service, but not every level is really
 * rendered (the shaded relief stops at 7); deeper levels upscale the
 * last native one, and a tile that fails is hidden rather than broken.
 */
export const USGS_IMAGERY_TILES = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}";
export const USGS_IMAGERY_MAX_NATIVE_ZOOM = 16;
const MAX_ZOOM = 18;

export interface MapTrail {
  slug: string;
  name: string;
  score: number;
  lines: LatLng[][];
}

/**
 * Trails drawn as lines colored by true difficulty over satellite imagery.
 * Clicking a trail opens its page (Nick: "when you click on a trail have it
 * take u to the info for that trail"). `highlight` thickens one trail and,
 * with `fitTo`, frames the map on it (the trail page's small map).
 */
export function TrailMap({
  resortSlug,
  trails,
  lifts,
  bounds,
  highlight,
  fitTo,
  height = 620,
}: {
  resortSlug: string;
  trails: MapTrail[];
  lifts: LatLng[][];
  bounds: [LatLng, LatLng];
  highlight?: string | null;
  fitTo?: LatLng[][];
  height?: number;
}) {
  const router = useRouter();
  const stageRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const lineRefs = useRef<Map<string, Leaflet.Polyline[]>>(new Map());
  const [ready, setReady] = useState(false);
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    let disposed = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (disposed || !stageRef.current || mapRef.current) return;
      const map = L.map(stageRef.current, {
        maxZoom: MAX_ZOOM,
        zoomSnap: 0.25,
        scrollWheelZoom: false,
        attributionControl: true,
      });
      map.attributionControl.setPrefix(false);
      map.zoomControl.setPosition("topright");
      L.tileLayer(USGS_IMAGERY_TILES, {
        maxNativeZoom: USGS_IMAGERY_MAX_NATIVE_ZOOM,
        maxZoom: MAX_ZOOM,
        attribution: 'Imagery: USGS · Trails and lifts © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Elevation: USGS 3DEP lidar',
        className: "ps-td-imagery",
      })
        .on("tileerror", (e) => {
          (e.tile as HTMLImageElement).style.visibility = "hidden";
        })
        .addTo(map);

      for (const lift of lifts) {
        L.polyline(lift, { color: "#ffffff", weight: 1.5, opacity: 0.85, dashArray: "4 4", interactive: false }).addTo(map);
      }

      // Easiest first, so the hardest trails draw on top where they cross.
      for (const t of [...trails].sort((a, b) => a.score - b.score)) {
        const color = BAND_COLORS[scoreBand(t.score)];
        const drawn: Leaflet.Polyline[] = [];
        for (const line of t.lines) {
          L.polyline(line, { color: "#0b1b33", weight: 7, opacity: 0.55, interactive: false }).addTo(map);
          const p = L.polyline(line, { color, weight: 4, opacity: 1 })
            .bindTooltip(`${t.name} · ${t.score}`, { sticky: true, className: "ps-td-tip" })
            .on("click", () => routerRef.current.push(`/difficulty/${resortSlug}/${t.slug}`))
            .addTo(map);
          drawn.push(p);
        }
        lineRefs.current.set(t.slug, drawn);
      }

      const fitLines = fitTo?.flat() ?? [];
      if (fitLines.length > 1) map.fitBounds(L.latLngBounds(fitLines), { padding: [30, 30], maxZoom: 16 });
      else map.fitBounds(bounds, { padding: [10, 10] });
      map.on("click", () => map.scrollWheelZoom.enable());
      map.on("mouseout", () => map.scrollWheelZoom.disable());
      mapRef.current = map;
      setReady(true);
    })();
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      lineRefs.current.clear();
    };
    // Built once; highlighting is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready) return;
    for (const [slug, lines] of lineRefs.current) {
      const on = slug === highlight;
      for (const l of lines) {
        l.setStyle({ weight: on ? 8 : 4 });
        if (on) l.bringToFront();
      }
    }
  }, [highlight, ready]);

  return <div ref={stageRef} className="ps-td-map" style={{ height }} role="region" aria-label="Satellite map of the trails, colored by true difficulty" />;
}
