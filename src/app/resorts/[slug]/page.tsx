import { notFound } from "next/navigation";
import { BrandRow } from "@/components/brand-row";
import { ScoreTable } from "@/components/score-table";
import { getResortBySlug, getUpcomingScoresForResort } from "@/lib/public/resort-scores";

export const dynamic = "force-dynamic";

export default async function ResortPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const resort = await getResortBySlug(slug);
  if (!resort) notFound();

  const scores = await getUpcomingScoresForResort(resort.id);

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
        <ScoreTable scores={scores} />
        <p className="disclaimer">
          Estimated snowfall is a multi-model reconciled forecast, converted from liquid equivalent via the Kuchera
          snow-to-liquid method. Not a guarantee — always check the resort&rsquo;s own snow report and your local
          avalanche center before making trip decisions.
        </p>
      </main>
    </>
  );
}
