"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from "react-simple-maps";
import type { ResortWithScore } from "@/lib/public/resort-scores";
import type { ConfidenceLabel } from "@/lib/db/types";

const GEO_URL = "/us-states-10m.json";

const CONFIDENCE_COLORS: Record<ConfidenceLabel, string> = {
  high: "#34d399",
  medium: "#fbbf24",
  low: "#8d9ab8",
};
const NO_SIGNAL_COLOR = "#3a4868";

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.5;

/**
 * US map with resort markers, pan/zoom/scroll (ROADMAP Phase D — the
 * operator asked for this directly). Uses react-simple-maps + us-atlas
 * rather than the Mapbox the primer named as the optional choice
 * (section 3): Mapbox needs an API key that hasn't been provisioned
 * (Phase 0) and its tile servers can't be reached from this sandbox
 * either way, so a Mapbox integration couldn't actually be verified
 * working. This renders from a local topology file (public/us-states-10m.json,
 * copied from the installed us-atlas package — no runtime network call,
 * no API key, genuinely $0 forever) and was fully tested in a real
 * browser before shipping. If a real Mapbox key gets provisioned later
 * and street-level/satellite imagery becomes worth the cost, swapping
 * this component is a contained change — nothing else depends on it.
 */
export function ResortMap({ resorts }: { resorts: ResortWithScore[] }) {
  const router = useRouter();
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<[number, number]>([-96, 38]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const active = resorts.find((r) => r.resort.id === activeId) ?? null;

  function zoomBy(factor: number) {
    setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * factor)));
  }

  function resetView() {
    setZoom(1);
    setCenter([-96, 38]);
  }

  return (
    <div className="resort-map-wrap">
      <div className="resort-map-canvas">
        <ComposableMap projection="geoAlbersUsa" className="resort-map-svg">
          <ZoomableGroup
            center={center}
            zoom={zoom}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            onMoveEnd={({ coordinates, zoom: z }) => {
              if (coordinates) setCenter(coordinates);
              if (z) setZoom(z);
            }}
          >
            <Geographies geography={GEO_URL}>
              {({ geographies }) =>
                geographies.map((geo) => <Geography key={geo.rsmKey} geography={geo} className="resort-map-state" />)
              }
            </Geographies>
            {resorts.map(({ resort, bestUpcomingScore }) => {
              const color = bestUpcomingScore ? CONFIDENCE_COLORS[bestUpcomingScore.confidence_label] : NO_SIGNAL_COLOR;
              const isActive = activeId === resort.id;
              return (
                <Marker
                  key={resort.id}
                  coordinates={[resort.lng, resort.lat]}
                  onMouseEnter={() => setActiveId(resort.id)}
                  onClick={() => router.push(`/resorts/${resort.slug}`)}
                  className="resort-map-marker"
                >
                  <circle r={isActive ? 7 / zoom : 5 / zoom} fill={color} stroke="#090d16" strokeWidth={1.2 / zoom} />
                </Marker>
              );
            })}
          </ZoomableGroup>
        </ComposableMap>

        <div className="resort-map-controls">
          <button type="button" onClick={() => zoomBy(ZOOM_STEP)} aria-label="Zoom in">
            +
          </button>
          <button type="button" onClick={() => zoomBy(1 / ZOOM_STEP)} aria-label="Zoom out">
            &minus;
          </button>
          <button type="button" onClick={resetView} aria-label="Reset view" className="reset">
            Reset
          </button>
        </div>
      </div>

      <div className="resort-map-panel">
        {active ? (
          <>
            <h3>{active.resort.name}</h3>
            <div className="meta">
              {active.resort.state} &middot; {active.resort.pass_affiliation.toUpperCase()}
            </div>
            {active.bestUpcomingScore ? (
              <div className="score-row" style={{ marginTop: 12 }}>
                <span className="score">{active.bestUpcomingScore.estimated_snowfall_in.toFixed(0)}&Prime;</span>
                <span className={`badge ${active.bestUpcomingScore.confidence_label}`}>{active.bestUpcomingScore.confidence_label}</span>
              </div>
            ) : (
              <p className="no-signal">No forecast signal yet</p>
            )}
            <a href={`/resorts/${active.resort.slug}`} className="back-link" style={{ marginTop: 14, display: "inline-flex" }}>
              View full forecast &rarr;
            </a>
          </>
        ) : (
          <>
            <h3>Hover or tap a marker</h3>
            <p className="meta">Dot color shows forecast confidence for that resort&rsquo;s best upcoming day.</p>
            <div className="resort-map-legend">
              <span>
                <i style={{ background: CONFIDENCE_COLORS.high }} /> High
              </span>
              <span>
                <i style={{ background: CONFIDENCE_COLORS.medium }} /> Medium
              </span>
              <span>
                <i style={{ background: CONFIDENCE_COLORS.low }} /> Low
              </span>
              <span>
                <i style={{ background: NO_SIGNAL_COLOR }} /> No signal
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
