"use client";

import Link from "next/link";
import { useState } from "react";
import { TrailMap, type MapTrail } from "@/components/trail-map";
import { BAND_COLORS, scoreBand } from "@/lib/trail-difficulty/score";
import type { LatLng } from "@/lib/trail-difficulty/types";

export interface ExplorerTrail extends MapTrail {
  resortRating: string | null;
}

/** The resort page: satellite map first, hardest-first list beside it. Hovering a list row lights up its trail. */
export function DifficultyExplorer({
  resortSlug,
  resortName,
  trails,
  lifts,
  bounds,
}: {
  resortSlug: string;
  resortName: string;
  trails: ExplorerTrail[];
  lifts: LatLng[][];
  bounds: [LatLng, LatLng];
}) {
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div className="ps-td-explorer">
      <div className="ps-td-map-wrap">
        <TrailMap resortSlug={resortSlug} trails={trails} lifts={lifts} bounds={bounds} highlight={hover} height={680} />
      </div>
      <section className="ps-td-list" aria-labelledby="td-list-title">
        <div className="ps-td-list-head">
          <h2 id="td-list-title">Hardest first</h2>
          <span>{trails.length} trails</span>
        </div>
        <ol>
          {trails.map((t, i) => {
            const color = BAND_COLORS[scoreBand(t.score)];
            return (
              <li key={t.slug}>
                <Link
                  href={`/difficulty/${resortSlug}/${t.slug}`}
                  onMouseEnter={() => setHover(t.slug)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(t.slug)}
                  onBlur={() => setHover(null)}
                >
                  <span className="rank">{i + 1}</span>
                  <span className="name">
                    <b>{t.name}</b>
                    <small>{t.resortRating ? `${resortName}: ${t.resortRating}` : "No resort rating mapped"}</small>
                  </span>
                  <span className="bar" aria-hidden="true">
                    <i style={{ width: `${t.score}%`, background: color }} />
                  </span>
                  <span className="score" style={{ color: "var(--ink)" }}>
                    <span className="dot" style={{ background: color }} aria-hidden="true" />
                    {t.score}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
