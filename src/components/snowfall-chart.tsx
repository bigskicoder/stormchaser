import type { SnowfallBar } from "@/lib/public/snowfall-timeline";

/**
 * Custom SVG bar chart — no charting library pulled in (same judgment call
 * as the map: build it directly when the visualization is simple enough,
 * keep it on the existing design tokens, avoid a dependency for something
 * this contained). Requested directly: "chart should be a bar chart with a
 * bar and the number displayed over it for each of the days."
 */

const WIDTH = 760;
const HEIGHT = 220;
const PADDING_TOP = 28;
const PADDING_BOTTOM = 36;
const PADDING_X = 8;
const BAR_GAP = 6;

const KIND_COLOR: Record<SnowfallBar["kind"], string> = {
  actual: "var(--text-faint)",
  today: "var(--accent)",
  predicted: "var(--high)",
};

function dayLabel(dateIso: string): string {
  return new Date(`${dateIso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

export function SnowfallChart({ bars }: { bars: SnowfallBar[] }) {
  const maxValue = Math.max(1, ...bars.map((b) => b.valueIn ?? 0));
  const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const barWidth = (WIDTH - PADDING_X * 2 - BAR_GAP * (bars.length - 1)) / bars.length;

  return (
    <div className="snowfall-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="snowfall-chart-svg" role="img" aria-label="Snowfall: past week, today, and next 5 days">
        {bars.map((bar, i) => {
          const x = PADDING_X + i * (barWidth + BAR_GAP);
          const value = bar.valueIn ?? 0;
          const barHeight = bar.valueIn != null ? Math.max(2, (value / maxValue) * plotHeight) : 0;
          const y = PADDING_TOP + plotHeight - barHeight;

          return (
            <g key={bar.date}>
              {bar.kind === "today" && (
                <rect
                  x={x - 2}
                  y={PADDING_TOP - 4}
                  width={barWidth + 4}
                  height={plotHeight + 4}
                  rx={6}
                  className="snowfall-chart-today-highlight"
                />
              )}
              {bar.valueIn != null ? (
                <>
                  <text x={x + barWidth / 2} y={y - 8} textAnchor="middle" className="snowfall-chart-value">
                    {value.toFixed(value < 10 ? 1 : 0)}&Prime;
                  </text>
                  <rect x={x} y={y} width={barWidth} height={barHeight} rx={3} fill={KIND_COLOR[bar.kind]} />
                </>
              ) : (
                <text x={x + barWidth / 2} y={PADDING_TOP + plotHeight - 6} textAnchor="middle" className="snowfall-chart-no-data">
                  &ndash;
                </text>
              )}
              <text x={x + barWidth / 2} y={HEIGHT - 16} textAnchor="middle" className="snowfall-chart-day-label">
                {bar.kind === "today" ? "Today" : dayLabel(bar.date)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="snowfall-chart-legend">
        <span>
          <i style={{ background: KIND_COLOR.actual }} /> Observed (SNOTEL)
        </span>
        <span>
          <i style={{ background: KIND_COLOR.today }} /> Today
        </span>
        <span>
          <i style={{ background: KIND_COLOR.predicted }} /> Forecast
        </span>
      </div>
    </div>
  );
}
