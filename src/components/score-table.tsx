import { ConfidenceBadge } from "@/components/confidence-badge";
import { WindHoldBadge } from "@/components/wind-hold-badge";
import type { SnowScore } from "@/lib/db/types";
import { kmhToMph } from "@/lib/utils/units";

function windCell(s: SnowScore): string {
  if (s.avg_wind_speed_kmh == null && s.max_wind_gust_kmh == null) return "n/a";
  const sustained = s.avg_wind_speed_kmh != null ? `${Math.round(kmhToMph(s.avg_wind_speed_kmh))}` : "–";
  const gust = s.max_wind_gust_kmh != null ? ` (gust ${Math.round(kmhToMph(s.max_wind_gust_kmh))})` : "";
  return `${sustained} mph${gust}`;
}

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
          <th>SLR</th>
          <th>Confidence</th>
          <th>Powder score</th>
          <th>Wind</th>
          <th>Wind hold</th>
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
              <td data-label="SLR">{s.is_rain_case ? "–" : `${s.snow_to_liquid_ratio.toFixed(1)}:1`}</td>
              <td data-label="Confidence">
                <ConfidenceBadge label={s.confidence_label} />
              </td>
              <td data-label="Powder score">{(s.powder_score * 100).toFixed(0)}/100</td>
              <td data-label="Wind">{windCell(s)}</td>
              <td data-label="Wind hold">
                <WindHoldBadge probability={s.wind_hold_probability} />
              </td>
              <td data-label="Lead time">{Math.round(s.lead_time_hours)}h</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
