import type { NaturalBase } from "@/lib/public/natural-base";

/**
 * Natural base, design D1 (snow-stake gauge), picked by Nick on
 * 2026-11-04 from the three mockups on the design canvas.
 */

function inches(v: number): string {
  return `${Math.round(v)}"`;
}

function signed(v: number): string {
  const r = Math.round(v);
  return r > 0 ? `+${r}"` : r < 0 ? `−${Math.abs(r)}"` : `0"`;
}

function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function NaturalBaseGauge({ base }: { base: NaturalBase }) {
  const top = Math.max(24, Math.ceil(Math.max(base.todayIn, base.projectedIn ?? 0, base.stationDepthIn ?? 0) / 12) * 12);
  const pct = (v: number) => `${Math.min(100, (Math.max(0, v) / top) * 100)}%`;
  const label = `Snow stake gauge: ${inches(base.todayIn)} of natural snow now${
    base.projectedIn != null ? `, ${inches(base.projectedIn)} projected by ${shortDate(base.projectedDate!)}` : ""
  }`;

  return (
    <section className="ps-panel ps-base" aria-labelledby="base-h">
      <div className="ps-base-head">
        <h2 id="base-h">Natural base</h2>
        {base.calibrated ? <span className="ps-base-badge good">Calibrated</span> : <span className="ps-base-badge rough">Uncalibrated</span>}
      </div>
      <div className="ps-base-body">
        <div className="ps-stake" role="img" aria-label={label}>
          <div className="stake" />
          {base.projectedIn != null && base.projectedIn - base.todayIn >= 0.5 && <div className="proj" style={{ height: pct(base.projectedIn) }} />}
          <div className="now" style={{ height: pct(base.todayIn) }} />
          <span className="tick top">{inches(top)}</span>
          <span className="tick zero">0</span>
        </div>
        <div className="ps-base-figs">
          <div>
            <b className="ps-base-big">{inches(base.todayIn)}</b>
            <span className="ps-meta">off-piste at mid-mountain, today</span>
          </div>
          <dl>
            {base.pastWeekChangeIn != null && (
              <div>
                <dt>Past 7 days</dt>
                <dd>{signed(base.pastWeekChangeIn)}</dd>
              </div>
            )}
            {base.projectedIn != null && (
              <div>
                <dt>By {shortDate(base.projectedDate!)}</dt>
                <dd className="accent">{inches(base.projectedIn)}</dd>
              </div>
            )}
            {base.stationDepthIn != null && (
              <div>
                <dt>Snow station measured</dt>
                <dd>{inches(base.stationDepthIn)}</dd>
              </div>
            )}
            <div>
              <dt>Water in pack</dt>
              <dd>{base.sweIn.toFixed(1)}&Prime;</dd>
            </div>
          </dl>
        </div>
      </div>
      <p className="ps-meta ps-base-note">
        Modeled natural snow only: no snowmaking or grooming, so it often differs from the resort&rsquo;s reported base.{" "}
        {base.calibrated
          ? "Checked against the nearby SNOTEL station over past winters."
          : "This resort has no nearby snow station to check it against, so treat it as a rough estimate."}
      </p>
    </section>
  );
}
