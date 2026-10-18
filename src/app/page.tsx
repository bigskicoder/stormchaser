import { Leaderboard } from "@/components/leaderboard";
import { SiteTopbar } from "@/components/site-topbar";
import { SubscribeForm } from "@/components/subscribe-form";
import { getLeaderboardRows } from "@/lib/public/resort-scores";
import "./public.css";

// Rendered per-request rather than statically: scores change hourly, and a
// static build has no live Supabase connection to prerender against.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const rows = await getLeaderboardRows();

  return (
    <div className="ps">
      <SiteTopbar current="leaderboard" />
      <main className="ps-wrap ps-main">
        <div className="ps-title-row">
          <div>
            <h1>Best bets for powder</h1>
            <p className="ps-sub">
              {rows.length} resorts ranked by powder score, from a blend of forecast models updated every hour. Free, no paywall.
            </p>
          </div>
        </div>

        <Leaderboard rows={rows} />

        <section id="alerts" className="ps-alerts" aria-labelledby="alerts-title">
          <h2 id="alerts-title">Get powder alerts</h2>
          <p>We&rsquo;ll email you when a resort&rsquo;s forecast turns into a real powder day.</p>
          <SubscribeForm />
        </section>

        <p className="ps-note">
          Scores are automated forecast estimates, not guarantees. Past-7-day snowfall is measured at the nearest SNOTEL
          station within 40 km; resorts without one show a dash. Always check the resort&rsquo;s own report and your local
          avalanche center before you go.
        </p>
      </main>
    </div>
  );
}
