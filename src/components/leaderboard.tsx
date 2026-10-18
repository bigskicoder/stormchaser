"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { RadarPanel } from "@/components/radar-panel";
import { SnowBars } from "@/components/snow-bars";
import type { PassAffiliation } from "@/lib/db/types";
import {
  REGION_LABELS,
  rankRows,
  summarizeWindow,
  type LeaderboardRow,
  type LeaderboardWindow,
  type RegionKey,
  type WindowSummary,
} from "@/lib/public/leaderboard";

const INITIAL_ROWS = 15;

const PASS_LABEL: Record<PassAffiliation, string> = { epic: "Epic", ikon: "Ikon", independent: "Independent", none: "No pass" };

const WINDOW_LABEL: Record<LeaderboardWindow, string> = { 1: "today", 3: "next 3 days", 5: "next 5 days" };

function fmtIn(v: number | null): string {
  if (v == null) return "–";
  return `${v < 10 && v % 1 !== 0 ? v.toFixed(1) : v.toFixed(0)}"`;
}

function ConfidencePill({ label }: { label: string | null | undefined }) {
  if (!label) return <span className="ps-dash">–</span>;
  return <span className={`ps-conf ${label}`}>{label[0]!.toUpperCase() + label.slice(1)}</span>;
}

function WindIcon() {
  return (
    <svg role="img" aria-label="Lift wind holds likely" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#b26a00" strokeWidth="2.2" strokeLinecap="round">
      <title>Lift wind holds likely</title>
      <path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7" />
    </svg>
  );
}

function bestDayText(s: WindowSummary): string {
  return s.bestDay ? s.bestDay.weekday : "–";
}

export function Leaderboard({ rows }: { rows: LeaderboardRow[] }) {
  const [pass, setPass] = useState<"all" | PassAffiliation>("all");
  const [region, setRegion] = useState<"all" | RegionKey>("all");
  const [windowDays, setWindowDays] = useState<LeaderboardWindow>(5);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const radarRef = useRef<HTMLDivElement>(null);

  const regionsPresent = useMemo(() => {
    const keys = new Set(rows.map((r) => r.region));
    return (Object.keys(REGION_LABELS) as RegionKey[]).filter((k) => keys.has(k));
  }, [rows]);
  const passesPresent = useMemo(() => {
    const keys = new Set(rows.map((r) => r.pass));
    return (["epic", "ikon", "independent"] as PassAffiliation[]).filter((k) => keys.has(k));
  }, [rows]);

  const ranked = useMemo(
    () => rankRows(rows.filter((r) => (pass === "all" || r.pass === pass) && (region === "all" || r.region === region)), windowDays),
    [rows, pass, region, windowDays]
  );
  const leader = ranked.find((r) => r.summary.score != null) ?? ranked[0] ?? null;
  const selectedRow = rows.find((r) => r.slug === selectedSlug) ?? leader?.row ?? null;
  const selectedSummary = selectedRow ? summarizeWindow(selectedRow, windowDays) : null;
  const isLeaderView = !selectedSlug || selectedSlug === leader?.row.slug;

  function select(slug: string, scroll: boolean) {
    setSelectedSlug(slug);
    if (scroll) radarRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const visible = showAll ? ranked : ranked.slice(0, INITIAL_ROWS);
  const topPicks = ranked.filter((r) => r.summary.score != null).slice(0, 3);
  const anyScores = ranked.some((r) => r.summary.score != null);
  const rankOf = new Map(ranked.map((r, i) => [r.row.slug, i + 1]));

  return (
    <>
      <div className="ps-filters">
        <div className="ps-chips" role="group" aria-label="Pass">
          <button type="button" className="ps-chip" aria-pressed={pass === "all"} onClick={() => setPass("all")}>
            All passes
          </button>
          {passesPresent.map((p) => (
            <button key={p} type="button" className="ps-chip" aria-pressed={pass === p} onClick={() => setPass(p)}>
              {PASS_LABEL[p]}
            </button>
          ))}
        </div>
        <div className="ps-divider" />
        <div className="ps-chips" role="group" aria-label="Region">
          <button type="button" className="ps-chip" aria-pressed={region === "all"} onClick={() => setRegion("all")}>
            All regions
          </button>
          {regionsPresent.map((r) => (
            <button key={r} type="button" className="ps-chip" aria-pressed={region === r} onClick={() => setRegion(r)}>
              {REGION_LABELS[r]}
            </button>
          ))}
        </div>
        <div className="ps-divider" />
        <div className="ps-seg" role="group" aria-label="Time window">
          {([1, 3, 5] as LeaderboardWindow[]).map((w) => (
            <button key={w} type="button" aria-pressed={windowDays === w} onClick={() => setWindowDays(w)}>
              {w === 1 ? "Today" : `${w} days`}
            </button>
          ))}
        </div>
      </div>

      {selectedRow && selectedSummary && (
        <section className="ps-radar-row" ref={radarRef} aria-label="Radar and selected resort">
          <RadarPanel
            center={{ lat: selectedRow.lat, lng: selectedRow.lng }}
            pins={rows.map((r) => ({ slug: r.slug, name: r.name, lat: r.lat, lng: r.lng }))}
            selectedSlug={selectedRow.slug}
            onSelect={(slug) => select(slug, false)}
            title={isLeaderView && anyScores ? `Radar: ${REGION_LABELS[selectedRow.region]}, the leading region` : `Radar around ${selectedRow.name}`}
            subtitle={
              isLeaderView && anyScores
                ? `Centered on ${selectedRow.name}, the top score right now. Pick any resort to move the radar there.`
                : "Pick another resort below or on the map to move the radar."
            }
          />
          <div className="ps-pick">
            <span className="ps-kicker">{isLeaderView && anyScores ? "Top pick right now" : "Selected resort"}</span>
            <div className="ps-pick-head">
              <div>
                <div className="ps-pick-name">{selectedRow.name}</div>
                <div className="ps-meta">
                  {selectedRow.state} &middot; {PASS_LABEL[selectedRow.pass]}
                </div>
              </div>
              <div className="ps-bigscore">
                <b>{selectedSummary.score ?? "–"}</b>
                <span>powder score</span>
              </div>
            </div>
            <SnowBars days={selectedRow.days} height={72} showValues showDays />
            <div className="ps-facts">
              <span>
                <strong>{fmtIn(selectedSummary.totalIn)}</strong> {WINDOW_LABEL[windowDays]}
              </span>
              {selectedSummary.bestDay && <span className="ps-meta">&middot; best {selectedSummary.bestDay.weekday}</span>}
              <ConfidencePill label={selectedSummary.bestDay?.confidence} />
              {selectedSummary.windHoldLikely && <WindIcon />}
            </div>
            <Link href={`/resorts/${selectedRow.slug}`} className="ps-button" style={{ marginTop: "auto" }}>
              Full {selectedRow.name} forecast
            </Link>
          </div>
        </section>
      )}

      {topPicks.length > 0 && (
        <section aria-labelledby="top-picks" className="ps-top-section">
          <div className="ps-section-head">
            <h2 id="top-picks">Top picks</h2>
          </div>
          <div className="ps-top">
            {topPicks.map(({ row, summary }, i) => (
              <button
                key={row.slug}
                type="button"
                className="ps-card"
                aria-pressed={row.slug === selectedRow?.slug}
                aria-label={`#${i + 1} ${row.name}, powder score ${summary.score}. Show on the radar`}
                onClick={() => select(row.slug, true)}
              >
                <div className="ps-pick-head">
                  <div>
                    <div className="ps-card-rank">
                      #{i + 1} &middot; {row.state} &middot; {PASS_LABEL[row.pass]}
                    </div>
                    <div className="ps-card-name">{row.name}</div>
                  </div>
                  <div className="ps-bigscore">
                    <b>{summary.score}</b>
                    <span>powder score</span>
                  </div>
                </div>
                <SnowBars days={row.days} height={64} showValues showDays />
                <div className="ps-facts">
                  <strong>
                    {fmtIn(summary.totalIn)} {WINDOW_LABEL[windowDays]}
                  </strong>
                  <span className="ps-meta">&middot; best {bestDayText(summary)}</span>
                  <ConfidencePill label={summary.bestDay?.confidence} />
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="all-resorts">
        <div className="ps-section-head">
          <h2 id="all-resorts">All resorts</h2>
          <div className="ps-legend">
            <span>
              <i style={{ background: "var(--snow)" }} />
              Under 6&Prime;
            </span>
            <span>
              <i style={{ background: "var(--powder)" }} />
              6&Prime; or more
            </span>
            <span>
              <i style={{ background: "var(--mix)" }} />
              Rain
            </span>
            <span>
              <i style={{ border: "1px dashed #b9c4d2" }} />
              No forecast yet
            </span>
            <span>
              <WindIcon />
              Wind holds likely
            </span>
          </div>
        </div>
        {ranked.length === 0 ? (
          <p className="ps-empty">No resorts match these filters.</p>
        ) : (
          <ol className="ps-board" aria-label={`Resorts ranked by powder score, ${WINDOW_LABEL[windowDays]}`}>
            <li className="ps-board-head" aria-hidden="true">
              <span>#</span>
              <span>Resort</span>
              <span>Powder score</span>
              <span>Next 5 days</span>
              <span className="num">Total</span>
              <span>Best day</span>
              <span>Confidence</span>
              <span className="num">Past 7 days</span>
              <span />
            </li>
            {visible.map(({ row, summary }) => {
              const selected = row.slug === selectedRow?.slug;
              return (
                <li key={row.slug} className={`ps-board-row${selected ? " selected" : ""}`}>
                  <span className="ps-rank">{rankOf.get(row.slug)}</span>
                  <div className="ps-resort">
                    <button type="button" onClick={() => select(row.slug, true)} aria-label={`Show ${row.name} on the radar`}>
                      {row.name}
                      {selected && <span className="ps-onradar">On radar</span>}
                      {summary.windHoldLikely && <WindIcon />}
                    </button>
                    <span className="ps-meta" style={{ fontSize: 13 }}>
                      {row.state} &middot; {PASS_LABEL[row.pass]}
                    </span>
                  </div>
                  <div className="ps-scorebar">
                    <b>{summary.score ?? "–"}</b>
                    <div className="track" aria-hidden="true">
                      <div className="fill" style={{ width: `${summary.score ?? 0}%` }} />
                    </div>
                  </div>
                  <div className="bars">
                    <SnowBars days={row.days} height={32} />
                  </div>
                  <span className="num desk" style={{ fontWeight: 700 }}>
                    {fmtIn(summary.totalIn)}
                  </span>
                  <span className="desk">{bestDayText(summary)}</span>
                  <span className="desk">
                    <ConfidencePill label={summary.bestDay?.confidence} />
                  </span>
                  <span className="num desk ps-meta">{fmtIn(row.pastWeekIn)}</span>
                  <div className="facts">
                    <span>
                      <strong>{fmtIn(summary.totalIn)}</strong> {WINDOW_LABEL[windowDays]}
                    </span>
                    <span>Best {bestDayText(summary)}</span>
                    <ConfidencePill label={summary.bestDay?.confidence} />
                    <span className="ps-meta">Past 7 days {fmtIn(row.pastWeekIn)}</span>
                  </div>
                  <Link href={`/resorts/${row.slug}`} className="ps-open" aria-label={`${row.name} full forecast`}>
                    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
        {!showAll && ranked.length > INITIAL_ROWS && (
          <button type="button" className="ps-more" onClick={() => setShowAll(true)}>
            Show all {ranked.length} resorts
          </button>
        )}
      </section>
    </>
  );
}
