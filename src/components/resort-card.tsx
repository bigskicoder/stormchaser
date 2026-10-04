import Link from "next/link";
import { ConfidenceBadge } from "@/components/confidence-badge";
import type { Resort, SnowScore } from "@/lib/db/types";

export interface ResortCardProps {
  resort: Resort;
  bestUpcomingScore: SnowScore | null;
}

/**
 * Presentational — takes data as props rather than fetching it, so the
 * same component renders real resort-scores.ts data on the live homepage
 * and fixture data on /design-preview (Phase D: no live Supabase to
 * screenshot against otherwise). See ROADMAP.md Phase D.
 */
export function ResortCard({ resort, bestUpcomingScore }: ResortCardProps) {
  return (
    <Link href={`/resorts/${resort.slug}`} className="resort-card">
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
  );
}
