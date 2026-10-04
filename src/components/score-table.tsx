import { ConfidenceBadge } from "@/components/confidence-badge";
import type { SnowScore } from "@/lib/db/types";

/** Presentational — see resort-card.tsx for why (Phase D /design-preview). */
export function ScoreTable({ scores }: { scores: SnowScore[] }) {
  if (scores.length === 0) {
    return <p className="no-signal">No forecast signal yet for this resort.</p>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Est. snowfall</th>
          <th>Confidence</th>
          <th>Powder score</th>
          <th>Lead time</th>
        </tr>
      </thead>
      <tbody>
        {scores.map((s) => {
          const dateLabel = new Date(`${s.target_date}T00:00:00Z`).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          });
          return (
            <tr key={s.id}>
              <td data-label="Date">{dateLabel}</td>
              <td data-label="Est. snowfall">{s.is_rain_case ? "Rain" : `${s.estimated_snowfall_in.toFixed(1)}"`}</td>
              <td data-label="Confidence">
                <ConfidenceBadge label={s.confidence_label} />
              </td>
              <td data-label="Powder score">{(s.powder_score * 100).toFixed(0)}/100</td>
              <td data-label="Lead time">{Math.round(s.lead_time_hours)}h</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
