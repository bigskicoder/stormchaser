import { BAND_COLORS } from "@/lib/trail-difficulty/score";

/** The five color bands of the 1–100 true difficulty score. */
export function DifficultyLegend() {
  return (
    <div className="ps-td-legend" aria-label="True difficulty colors, 1 easiest to 100 hardest">
      <div className="ramp" aria-hidden="true">
        {([1, 2, 3, 4, 5] as const).map((b) => (
          <i key={b} style={{ background: BAND_COLORS[b] }} />
        ))}
      </div>
      <div className="ticks" aria-hidden="true">
        <span>1</span>
        <span>20</span>
        <span>40</span>
        <span>60</span>
        <span>80</span>
        <span>100</span>
      </div>
    </div>
  );
}
