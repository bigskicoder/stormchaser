import { BrandRow } from "@/components/brand-row";
import { ResortCard } from "@/components/resort-card";
import { SubscribeForm } from "@/components/subscribe-form";
import { getResortsWithBestUpcomingScore } from "@/lib/public/resort-scores";
import type { ResortWithScore } from "@/lib/public/resort-scores";

// Rendered per-request rather than statically: scores change hourly, and a
// static build has no live Supabase connection to prerender against.
export const dynamic = "force-dynamic";

function headerStats(resorts: ResortWithScore[]) {
  const withSignal = resorts.filter((r) => r.bestUpcomingScore);
  const topScore = withSignal.reduce<number>(
    (max, r) => Math.max(max, r.bestUpcomingScore?.powder_score ?? 0),
    0
  );
  return {
    tracked: resorts.length,
    withSignal: withSignal.length,
    topScore: Math.round(topScore * 100),
  };
}

export default async function HomePage() {
  const resorts = await getResortsWithBestUpcomingScore();
  const stats = headerStats(resorts);

  return (
    <>
      <header className="site-header">
        <div className="container" style={{ paddingBottom: 0 }}>
          <BrandRow />
          <h1>Know before the storm hits.</h1>
          <p className="tagline">
            Multi-model storm-signal detection and confidence-scored powder alerts for storm-chasing skiers. Every
            tracked resort, every score, visible here with no paywall.
          </p>
          <div className="header-stats">
            <div className="header-stat">
              <div className="num">{stats.tracked}</div>
              <div className="label">Resorts tracked</div>
            </div>
            <div className="header-stat">
              <div className="num">{stats.withSignal}</div>
              <div className="label">With active forecast signal</div>
            </div>
            <div className="header-stat">
              <div className="num">{stats.topScore}</div>
              <div className="label">Highest powder score right now</div>
            </div>
          </div>
          <SubscribeForm />
        </div>
      </header>
      <main className="container" style={{ paddingTop: 40 }}>
        <div className="resort-grid">
          {resorts.map(({ resort, bestUpcomingScore }) => (
            <ResortCard key={resort.id} resort={resort} bestUpcomingScore={bestUpcomingScore} />
          ))}
        </div>
        <p className="disclaimer">
          Scores are automated forecast estimates, not guarantees. Indicative fares shown on resort pages are
          recently-seen cached prices, not live quotes or bookable offers.
        </p>
      </main>
    </>
  );
}
