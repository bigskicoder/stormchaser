import Link from "next/link";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { SubscribeForm } from "@/components/subscribe-form";
import { getResortsWithBestUpcomingScore } from "@/lib/public/resort-scores";

// Rendered per-request rather than statically: scores change hourly, and a
// static build has no live Supabase connection to prerender against.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const resorts = await getResortsWithBestUpcomingScore();

  return (
    <>
      <header className="site-header">
        <div className="container" style={{ padding: 0 }}>
          <h1>powder-alert</h1>
          <p>Multi-model storm-signal detection for storm-chasing skiers. Every resort, every score, no paywall.</p>
        </div>
      </header>
      <main className="container">
        <SubscribeForm />
        <div className="resort-grid">
          {resorts.map(({ resort, bestUpcomingScore }) => (
            <Link key={resort.id} href={`/resorts/${resort.slug}`} className="resort-card">
              <h2>{resort.name}</h2>
              <div className="meta">
                {resort.state} &middot; {resort.pass_affiliation.toUpperCase()}
              </div>
              {bestUpcomingScore ? (
                <>
                  <div className="score-row">
                    <span className="score">{bestUpcomingScore.estimated_snowfall_in.toFixed(0)}&Prime;</span>
                    <ConfidenceBadge label={bestUpcomingScore.confidence_label} />
                  </div>
                  <div className="meta">
                    Powder score {(bestUpcomingScore.powder_score * 100).toFixed(0)}/100 &middot;{" "}
                    {new Date(`${bestUpcomingScore.target_date}T00:00:00Z`).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </div>
                </>
              ) : (
                <p className="no-signal">No forecast signal yet</p>
              )}
            </Link>
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
