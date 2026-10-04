import { WindHoldBadge } from "@/components/wind-hold-badge";
import type { SnowScore } from "@/lib/db/types";
import { cToF, kmhToMph } from "@/lib/utils/units";

const DAYS_SHOWN = 5;

function dayLabel(dateIso: string): string {
  return new Date(`${dateIso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

function windLabel(s: SnowScore): string {
  if (s.avg_wind_speed_kmh == null && s.max_wind_gust_kmh == null) return "n/a";
  const sustained = s.avg_wind_speed_kmh != null ? Math.round(kmhToMph(s.avg_wind_speed_kmh)) : null;
  const gust = s.max_wind_gust_kmh != null ? Math.round(kmhToMph(s.max_wind_gust_kmh)) : null;
  if (sustained != null && gust != null) return `${sustained}–${gust} mph`;
  return `${sustained ?? gust} mph`;
}

/** Glanceable visual strip (weather/wind/SLR/wind-hold) for the next few days — the detailed numeric breakdown of the same fields lives in ScoreTable below it. */
export function ConditionsStrip({ scores }: { scores: SnowScore[] }) {
  const days = scores.slice(0, DAYS_SHOWN);
  if (days.length === 0) return null;

  return (
    <div className="conditions-strip">
      {days.map((s) => (
        <div key={s.id} className="conditions-card">
          <div className="conditions-date">{dayLabel(s.target_date)}</div>
          <div className="conditions-temp">{s.avg_temp_c != null ? `${Math.round(cToF(s.avg_temp_c))}°F` : "n/a"}</div>
          <div className="conditions-cloud">
            <div className="cloud-bar">
              <div className="cloud-bar-fill" style={{ width: `${Math.round(s.avg_cloud_cover_pct ?? 0)}%` }} />
            </div>
            <span>{s.avg_cloud_cover_pct != null ? `${Math.round(s.avg_cloud_cover_pct)}% cloud` : "cloud n/a"}</span>
          </div>
          <div className="conditions-wind">{windLabel(s)}</div>
          <div className="conditions-slr">{s.is_rain_case ? "Rain" : `SLR ${s.snow_to_liquid_ratio.toFixed(1)}:1`}</div>
          <WindHoldBadge probability={s.wind_hold_probability} />
        </div>
      ))}
    </div>
  );
}
