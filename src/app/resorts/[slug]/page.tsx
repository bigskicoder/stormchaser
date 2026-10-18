import Link from "next/link";
import { notFound } from "next/navigation";
import { ConditionsStrip } from "@/components/conditions-strip";
import { ResortRadar } from "@/components/resort-radar";
import { ScoreTable } from "@/components/score-table";
import { SiteTopbar } from "@/components/site-topbar";
import { SnowfallChart } from "@/components/snowfall-chart";
import { WebcamEmbed } from "@/components/webcam-embed";
import { CONFIDENCE_WEIGHT_BY_LABEL } from "@/lib/config/constants";
import { getAnonDb } from "@/lib/db/client";
import type { SnowScore } from "@/lib/db/types";
import { POWDER_DAY_IN, WIND_HOLD_LIKELY, buildLeaderboardRow, summarizeWindow, weekdayLabel } from "@/lib/public/leaderboard";
import { getPastWeekSnowfall, getResortBySlug, getUpcomingScoresForResort } from "@/lib/public/resort-scores";
import { buildSnowfallTimeline } from "@/lib/public/snowfall-timeline";
import { kmhToMph } from "@/lib/utils/units";
import { localTodayIso } from "@/lib/utils/timezone";
import "../../public.css";

export const dynamic = "force-dynamic";

const PASS_LABEL: Record<string, string> = { epic: "Epic", ikon: "Ikon", independent: "Independent", none: "No pass" };

function fmtIn(v: number): string {
  return `${v < 10 && v % 1 !== 0 ? v.toFixed(1) : v.toFixed(0)}"`;
}

/** Plain-language callouts for the next 5 days, straight from the scored fields. */
function headsUp(scores: SnowScore[]): { kind: "powder" | "wind" | "rain"; day: string; text: string }[] {
  const out: { kind: "powder" | "wind" | "rain"; day: string; text: string }[] = [];
  for (const s of scores.slice(0, 5)) {
    const day = weekdayLabel(s.target_date);
    if (s.is_rain_case) out.push({ kind: "rain", day, text: "Rain or mixed precipitation expected." });
    else if (s.estimated_snowfall_in >= POWDER_DAY_IN)
      out.push({
        kind: "powder",
        day,
        text: `Powder day: about ${fmtIn(s.estimated_snowfall_in)} forecast, ${s.confidence_label} confidence.`,
      });
    if ((s.wind_hold_probability ?? 0) >= WIND_HOLD_LIKELY) {
      const gust = s.max_wind_gust_kmh != null ? ` Gusts near ${Math.round(kmhToMph(s.max_wind_gust_kmh))} mph.` : "";
      out.push({ kind: "wind", day, text: `Lift wind holds likely.${gust}` });
    }
  }
  return out;
}

export default async function ResortPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const resort = await getResortBySlug(slug);
  if (!resort) notFound();

  const [scores, pastWeek, neighbors] = await Promise.all([
    getUpcomingScoresForResort(resort.id, resort.timezone),
    getPastWeekSnowfall(resort.id, resort.timezone),
    getAnonDb().from("resorts").select("slug, name, lat, lng").eq("active", true),
  ]);
  const todayIso = localTodayIso(resort.timezone);
  const snowfallBars = buildSnowfallTimeline({ todayIso, pastWeek, upcoming: scores });
  const row = buildLeaderboardRow({ resort, todayIso, scores, pastWeek: pastWeek.filter((p) => p.date < todayIso) });
  const summary = summarizeWindow(row, 5);
  const best = summary.bestDay ? scores.find((s) => s.target_date === summary.bestDay!.date) ?? null : null;
  const alerts = headsUp(scores);
  const pins = (neighbors.data ?? []) as { slug: string; name: string; lat: number; lng: number }[];

  return (
    <div className="ps">
      <SiteTopbar />
      <div className="ps-hero">
        <div className="ps-wrap">
          <Link href="/" className="ps-back">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Leaderboard
          </Link>
          <div className="ps-hero-row">
            <div>
              <h1>{resort.name}</h1>
              <div className="ps-meta">
                {resort.state} &middot; {PASS_LABEL[resort.pass_affiliation] ?? resort.pass_affiliation} &middot; base{" "}
                {Math.round(resort.elevation_base_m * 3.28084).toLocaleString()} ft / summit{" "}
                {Math.round(resort.elevation_summit_m * 3.28084).toLocaleString()} ft
              </div>
            </div>
            <div className="ps-bigscore">
              <b>{summary.score ?? "–"}</b>
              <span>best powder score, next 5 days</span>
            </div>
          </div>
          {summary.bestDay && (
            <div className="ps-tags">
              <span className="ps-tag hot">Best day {summary.bestDay.weekday}</span>
              <span className="ps-tag">{fmtIn(summary.totalIn ?? 0)} over 5 days</span>
              <span className={`ps-tag${summary.bestDay.confidence === "high" ? " good" : ""}`}>
                {summary.bestDay.confidence ? `${summary.bestDay.confidence[0]!.toUpperCase()}${summary.bestDay.confidence.slice(1)} confidence` : "Confidence n/a"}
              </span>
            </div>
          )}
        </div>
      </div>

      <main className="ps-wrap ps-main">
        <div className="ps-cols">
          <div className="wide">
            <ResortRadar resort={{ slug: resort.slug, name: resort.name, lat: resort.lat, lng: resort.lng }} pins={pins} />
            <section className="ps-panel" aria-labelledby="snow-h">
              <h2 id="snow-h">Snowfall: past week, today and next 5 days</h2>
              <SnowfallChart bars={snowfallBars} />
            </section>
          </div>
          <div className="side">
            <section className="ps-heads" aria-labelledby="heads-h">
              <h2 id="heads-h" style={{ fontSize: 18 }}>
                Heads up
              </h2>
              {alerts.length === 0 ? (
                <p className="ps-meta" style={{ margin: 0 }}>
                  No powder days, rain or wind holds in the next 5 days.
                </p>
              ) : (
                alerts.map((a, i) => (
                  <div key={i} className={`ps-head ${a.kind}`}>
                    <b>{a.day}</b>
                    <span>{a.text}</span>
                  </div>
                ))
              )}
            </section>
            {best && (
              <section className="ps-panel" aria-labelledby="why-h">
                <h2 id="why-h">Why {summary.score}</h2>
                <p className="ps-meta" style={{ margin: "4px 0 0" }}>
                  The score for {weekdayLabel(best.target_date)} blends three things:
                </p>
                {[
                  { name: "Fresh snow", note: `${fmtIn(best.estimated_snowfall_in)} vs. this resort's big days`, v: best.normalized_snowfall },
                  { name: "Forecast confidence", note: `${best.confidence_label}`, v: CONFIDENCE_WEIGHT_BY_LABEL[best.confidence_label] },
                  { name: "Timing", note: `${Math.round(best.lead_time_hours)} hours out`, v: best.lead_time_fit },
                ].map((f) => (
                  <div className="ps-factor" key={f.name}>
                    <div>
                      <strong>{f.name}</strong>
                      <span className="ps-meta">{f.note}</span>
                    </div>
                    <div className="track" aria-hidden="true">
                      <div className="fill" style={{ width: `${Math.round(f.v * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </section>
            )}
          </div>
        </div>

        <section aria-labelledby="cond-h">
          <h2 id="cond-h" style={{ fontSize: 20 }}>
            Conditions
          </h2>
          <ConditionsStrip scores={scores} />
        </section>

        <section aria-labelledby="detail-h">
          <h2 id="detail-h" style={{ fontSize: 20 }}>
            Day by day
          </h2>
          <ScoreTable scores={scores} />
        </section>

        <section className="ps-panel" aria-labelledby="cam-h">
          <h2 id="cam-h">Live webcam</h2>
          <WebcamEmbed webcamUrl={resort.webcam_url} resortName={resort.name} />
        </section>

        <p className="ps-note">
          Estimated snowfall is a multi-model reconciled forecast, converted from liquid equivalent with a snow-to-liquid
          ratio. Past-week snowfall is observed at the nearest SNOTEL station (not necessarily on the mountain); resorts
          outside SNOTEL coverage show no past-week data. Wind-hold probability is a generic estimate from forecast gusts,
          not this resort&rsquo;s own lift policy. Always check the resort&rsquo;s snow report and your local avalanche
          center before you go.
        </p>
      </main>
    </div>
  );
}
