import Link from "next/link";
import { notFound } from "next/navigation";
import { DifficultyExplorer } from "@/components/difficulty-explorer";
import { DifficultyLegend } from "@/components/difficulty-legend";
import { SiteTopbar } from "@/components/site-topbar";
import { difficultyData, difficultyResorts } from "@/lib/trail-difficulty/data";
import "../../public.css";

export function generateStaticParams() {
  return difficultyResorts().map((r) => ({ resort: r.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ resort: string }> }) {
  const data = difficultyData((await params).resort);
  return { title: data ? `${data.name} true trail difficulty · Powder Seeker` : "Powder Seeker" };
}

/** Map first (Nick, 2026-10-18): trails colored by score; clicking one opens its page. */
export default async function DifficultyResortPage({ params }: { params: Promise<{ resort: string }> }) {
  const data = difficultyData((await params).resort);
  if (!data) notFound();

  return (
    <div className="ps">
      <SiteTopbar current="difficulty" />
      <main className="ps-wrap ps-main">
        <div className="ps-title-row">
          <div>
            <Link href="/difficulty" className="ps-td-back">
              True trail difficulty
            </Link>
            <h1>{data.name}</h1>
            <p className="ps-sub">Measured from lidar, not the trail map. Tap a trail for its details.</p>
          </div>
          <DifficultyLegend />
        </div>

        {data.trails.length === 0 ? (
          <div className="ps-panel ps-empty">{data.name}&rsquo;s trails are being measured. Check back soon.</div>
        ) : (
          <DifficultyExplorer
            resortSlug={data.slug}
            resortName={data.name}
            bounds={data.bounds}
            lifts={data.lifts.map((l) => l.line)}
            trails={data.trails.map((t) => ({ slug: t.slug, name: t.name, score: t.score, lines: t.lines, resortRating: t.resortRating }))}
          />
        )}

        <p className="ps-note">
          Scores are 1 to 100 on the same scale at every resort. Lidar measures the ground, not the snow, so this is how hard
          a trail is built, not how it skis today. Sources: {data.sources.join("; ")}.
          {data.measuredAt ? ` Measured ${new Date(data.measuredAt).toLocaleDateString("en-US", { dateStyle: "medium" })}.` : ""}
        </p>
      </main>
    </div>
  );
}
