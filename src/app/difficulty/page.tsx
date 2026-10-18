import Link from "next/link";
import { SiteTopbar } from "@/components/site-topbar";
import { DifficultyLegend } from "@/components/difficulty-legend";
import { difficultyResorts } from "@/lib/trail-difficulty/data";
import "../public.css";

export const metadata = { title: "True trail difficulty · Powder Seeker" };

/** True trail difficulty (ROADMAP D.4): its own section, separate from the forecasts. Stowe is the pilot. */
export default function DifficultyIndexPage() {
  const resorts = difficultyResorts();
  return (
    <div className="ps">
      <SiteTopbar current="difficulty" />
      <main className="ps-wrap ps-main">
        <div className="ps-title-row">
          <div>
            <h1>True trail difficulty</h1>
            <p className="ps-sub">
              Every trail measured from lidar and scored 1 to 100 on one scale for every mountain, so a black at one resort
              can be compared with a black at another.
            </p>
          </div>
          <DifficultyLegend />
        </div>

        <div className="ps-td-resorts">
          {resorts.map((r) => (
            <Link key={r.slug} href={`/difficulty/${r.slug}`} className="ps-card">
              <span className="ps-card-rank">Pilot resort</span>
              <span className="ps-card-name">{r.name}</span>
              <span className="ps-td-card-sub">
                {r.trails.length > 0 ? `${r.trails.length} trails measured` : "Being measured"}
              </span>
            </Link>
          ))}
        </div>

        <section className="ps-panel ps-td-how" aria-labelledby="td-how">
          <h2 id="td-how">How the score works</h2>
          <ul>
            <li>
              <b>Pitch, 60 points.</b> The steepest average pitch over 10, 30, 100 and 300 m of the trail, blended 10%, 20%, 30%
              and 40%. A short steep roll counts less than a long sustained pitch. 10° scores 0 and 45° scores all 60.
            </li>
            <li>
              <b>Grooming, 15 points.</b> Groomed scores 0, ungroomed 15, sometimes groomed or not mapped 7.
            </li>
            <li>
              <b>Width, 10 points.</b> Wider than 40 m scores 0, narrower than 10 m scores 10.
            </li>
            <li>
              <b>Features, 15 points.</b> Trees, moguls, a cliff band or no-fall pitch, and a north-facing slope that holds ice.
            </li>
          </ul>
          <p className="ps-note">
            Lidar measures the ground, not the snow, so the score is how hard a trail is built, not how it skis today. Grooming,
            width and features come from OpenStreetMap and can be missing for some trails.
          </p>
        </section>
      </main>
    </div>
  );
}
