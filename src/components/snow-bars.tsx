import { POWDER_DAY_IN, type LeaderboardDay } from "@/lib/public/leaderboard";

/** Bars share one fixed scale (0-20", capped) so a glance compares resorts honestly. */
const SCALE_MAX_IN = 20;

function barClass(d: LeaderboardDay): string {
  if (d.snowIn == null) return "ps-bar nodata";
  if (d.isRain) return "ps-bar mix";
  if (d.snowIn <= 0) return "ps-bar none";
  const base = d.snowIn >= POWDER_DAY_IN ? "ps-bar powder" : "ps-bar";
  return d.isMixed ? `${base} mixed` : base;
}

function fmtIn(v: number): string {
  return v < 10 && v % 1 !== 0 ? v.toFixed(1) : v.toFixed(0);
}

export function snowDaysLabel(days: LeaderboardDay[]): string {
  return days
    .map((d) => `${d.weekday} ${d.snowIn == null ? "no forecast" : d.isRain ? "rain" : `${fmtIn(d.snowIn)} inches${d.isMixed ? " with some rain" : ""}`}`)
    .join(", ");
}

/**
 * Daily forecast snowfall as small bars (OpenSnow's convention: blue for
 * some snow, orange from 6", purple for rain; a purple cap on a snow bar
 * means part of the day falls as rain). A day with no score is a
 * dashed outline, never a zero bar.
 */
export function SnowBars({
  days,
  height = 32,
  showValues = false,
  showDays = false,
}: {
  days: LeaderboardDay[];
  height?: number;
  showValues?: boolean;
  showDays?: boolean;
}) {
  const plot = showValues ? height - 16 : height;
  return (
    <div>
      <div className="ps-bars" style={{ height }} role="img" aria-label={`Forecast snowfall: ${snowDaysLabel(days)}`}>
        {days.map((d) => {
          const h = d.snowIn == null ? plot * 0.35 : Math.max(3, (Math.min(d.snowIn, SCALE_MAX_IN) / SCALE_MAX_IN) * plot);
          return (
            <div className="ps-bar-col" key={d.date} aria-hidden="true">
              {showValues && <small>{d.snowIn == null ? "–" : d.isRain ? "rain" : `${fmtIn(d.snowIn)}"`}</small>}
              <div className={barClass(d)} style={{ height: h }} />
            </div>
          );
        })}
      </div>
      {showDays && (
        <div className="ps-bar-days" aria-hidden="true">
          {days.map((d) => (
            <span key={d.date}>{d.weekday}</span>
          ))}
        </div>
      )}
    </div>
  );
}
