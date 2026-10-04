import { notFound } from "next/navigation";
import { BrandRow } from "@/components/brand-row";
import { ConditionsStrip } from "@/components/conditions-strip";
import { ScoreTable } from "@/components/score-table";
import { SnowfallChart } from "@/components/snowfall-chart";
import { WebcamEmbed } from "@/components/webcam-embed";
import { getPastWeekSnowfall, getResortBySlug, getUpcomingScoresForResort } from "@/lib/public/resort-scores";
import { buildSnowfallTimeline } from "@/lib/public/snowfall-timeline";
import { localTodayIso } from "@/lib/utils/timezone";

export const dynamic = "force-dynamic";

export default async function ResortPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const resort = await getResortBySlug(slug);
  if (!resort) notFound();

  const [scores, pastWeek] = await Promise.all([
    getUpcomingScoresForResort(resort.id, resort.timezone),
    getPastWeekSnowfall(resort.id, resort.timezone),
  ]);

  const todayIso = localTodayIso(resort.timezone);
  const snowfallBars = buildSnowfallTimeline({ todayIso, pastWeek, upcoming: scores });

  return (
    <>
      <header className="site-header">
        <div className="container" style={{ paddingBottom: 32 }}>
          <BrandRow />
          <a href="/" className="back-link">
            &larr; All resorts
          </a>
          <h1 style={{ marginTop: 14 }}>{resort.name}</h1>
          <p className="tagline">
            {resort.state} &middot; {resort.pass_affiliation.toUpperCase()} &middot; base{" "}
            {Math.round(resort.elevation_base_m)}m / summit {Math.round(resort.elevation_summit_m)}m
          </p>
        </div>
      </header>
      <main className="container" style={{ paddingTop: 8 }}>
        <h2>Snowfall: past week, today &amp; next 5 days</h2>
        <SnowfallChart bars={snowfallBars} />

        <h2 style={{ marginTop: 40 }}>Conditions</h2>
        <ConditionsStrip scores={scores} />

        <h2 style={{ marginTop: 40 }}>Live webcam</h2>
        <WebcamEmbed webcamUrl={resort.webcam_url} resortName={resort.name} />

        <h2 style={{ marginTop: 40 }}>Full forecast detail</h2>
        <ScoreTable scores={scores} />

        <p className="disclaimer">
          Estimated snowfall is a multi-model reconciled forecast, converted from liquid equivalent via the Kuchera
          snow-to-liquid method. Past-week snowfall is observed SNOTEL station data (nearest station, not necessarily
          on-mountain); resorts outside SNOTEL coverage show no past-week data. Wind-hold probability is a generic
          estimate from forecast wind gusts, not this resort&rsquo;s actual lift policy. Not a guarantee &mdash;
          always check the resort&rsquo;s own snow report and your local avalanche center before making trip
          decisions.
        </p>
      </main>
    </>
  );
}
