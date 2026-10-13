import { getAccuracySummary } from "@/lib/backtest/accuracy";

export const dynamic = "force-dynamic";

/** How many hit-rate percentage points count as a real edge either way, below which the two are shown as "even" rather than claiming a difference that's really just sample noise. */
const COMPARE_EVEN_THRESHOLD_PTS = 3;

function CompareBadge({ powderAlertHitRatePct, nwsHitRatePct }: { powderAlertHitRatePct?: number; nwsHitRatePct?: number }) {
  if (powderAlertHitRatePct == null || nwsHitRatePct == null) return null;
  const deltaPts = powderAlertHitRatePct - nwsHitRatePct;
  if (Math.abs(deltaPts) < COMPARE_EVEN_THRESHOLD_PTS) {
    return <span className="compare-badge even">even w/ NWS</span>;
  }
  return (
    <span className={`compare-badge ${deltaPts > 0 ? "better" : "worse"}`}>
      {deltaPts > 0 ? "+" : ""}
      {deltaPts.toFixed(0)}pt vs NWS
    </span>
  );
}

const BACKTEST_SOURCE_LABEL: Record<string, string> = {
  slr_reanalysis_backtest: "SLR vs. reanalysis",
  reconciliation_forecast_backtest: "Full pipeline vs. forecast archive",
};

export default async function AdminBacktestPage() {
  const summary = await getAccuracySummary();

  const byResort = new Map<string, { resortName: string; powderAlert?: typeof summary[number]; nws?: typeof summary[number] }>();
  for (const row of summary) {
    const entry = byResort.get(row.resortId) ?? { resortName: row.resortName };
    if (row.source === "powder_alert") entry.powderAlert = row;
    if (row.source === "nws") entry.nws = row;
    byResort.set(row.resortId, entry);
  }

  // Deliberately kept out of the live-vs-NWS table above: these rows come
  // from a one-off historical backtest script run (see ROADMAP.md), not
  // live production traffic, and mixing "how we're doing right now" with
  // "how the formula would have done on storms from years ago" into one
  // table risks reading backtest numbers as live operational ones.
  const historicalBacktestRows = summary.filter(
    (row) => row.source === "slr_reanalysis_backtest" || row.source === "reconciliation_forecast_backtest"
  );

  return (
    <>
      <h2 style={{ fontSize: 18 }}>Forecast accuracy (season-to-date)</h2>
      <p style={{ color: "var(--text-muted)" }}>
        Predicted snowfall vs. SNOTEL-observed liquid equivalent. Hit rate = predictions within &plusmn;2&Prime; of
        observed. See BUILD_PRIMER section 5.5 for the credibility-metric rationale — required reading before PART_2
        (booking) begins.
      </p>
      <p style={{ color: "var(--text-muted)" }}>
        The &ldquo;NWS baseline&rdquo; column is a public-domain comparison (api.weather.gov gridded forecasts),
        not OpenSnow or any other proprietary product — see ROADMAP.md for why. It's here to answer &ldquo;are we
        beating a plain public forecast,&rdquo; a different and more defensible question than &ldquo;do we match a
        competitor.&rdquo;
      </p>
      <table>
        <thead>
          <tr>
            <th>Resort</th>
            <th>Our samples</th>
            <th>Our MAE</th>
            <th>Our hit rate</th>
            <th>NWS samples</th>
            <th>NWS MAE</th>
            <th>NWS hit rate</th>
            <th>Comparison</th>
          </tr>
        </thead>
        <tbody>
          {Array.from(byResort.values()).map(({ resortName, powderAlert, nws }) => (
            <tr key={resortName}>
              <td data-label="Resort">{resortName}</td>
              <td data-label="Our samples">{powderAlert?.sampleCount ?? "—"}</td>
              <td data-label="Our MAE">{powderAlert ? `${powderAlert.meanAbsoluteErrorIn.toFixed(2)}"` : "—"}</td>
              <td data-label="Our hit rate">{powderAlert ? `${powderAlert.hitRatePct.toFixed(0)}%` : "—"}</td>
              <td data-label="NWS samples">{nws?.sampleCount ?? "—"}</td>
              <td data-label="NWS MAE">{nws ? `${nws.meanAbsoluteErrorIn.toFixed(2)}"` : "—"}</td>
              <td data-label="NWS hit rate">{nws ? `${nws.hitRatePct.toFixed(0)}%` : "—"}</td>
              <td data-label="Comparison">
                <CompareBadge powderAlertHitRatePct={powderAlert?.hitRatePct} nwsHitRatePct={nws?.hitRatePct} />
              </td>
            </tr>
          ))}
          {byResort.size === 0 && (
            <tr>
              <td colSpan={8} className="no-signal">
                No backtest data yet — accumulates as the daily backtest cron runs against SNOTEL actuals.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2 style={{ fontSize: 18, marginTop: 40 }}>Pre-season historical backtest</h2>
      <p style={{ color: "var(--text-muted)" }}>
        Run on demand via <code>npm run backtest:slr-reanalysis</code> and <code>npm run backtest:reconciliation</code>{" "}
        (see ROADMAP.md) — validates the scoring logic against storms from years ago, so Phase B calibration doesn&rsquo;t
        have to wait out a full live season before it has something to learn from. &ldquo;SLR vs. reanalysis&rdquo;
        checks only the snow-to-liquid conversion, against ~85 years of ERA5 reanalysis. &ldquo;Full pipeline vs.
        forecast archive&rdquo; checks reconciliation + SLR together, against real archived model forecasts, but only
        back to ~2021 and at a nominal short lead time &mdash; see that pipeline&rsquo;s own code comments for the full
        caveat on what it does and doesn&rsquo;t validate.
      </p>
      <table>
        <thead>
          <tr>
            <th>Resort</th>
            <th>Method</th>
            <th>Samples</th>
            <th>MAE</th>
            <th>Hit rate</th>
          </tr>
        </thead>
        <tbody>
          {historicalBacktestRows.map((row) => (
            <tr key={`${row.resortId}:${row.source}`}>
              <td data-label="Resort">{row.resortName}</td>
              <td data-label="Method">{BACKTEST_SOURCE_LABEL[row.source] ?? row.source}</td>
              <td data-label="Samples">{row.sampleCount}</td>
              <td data-label="MAE">{row.meanAbsoluteErrorIn.toFixed(2)}&quot;</td>
              <td data-label="Hit rate">{row.hitRatePct.toFixed(0)}%</td>
            </tr>
          ))}
          {historicalBacktestRows.length === 0 && (
            <tr>
              <td colSpan={5} className="no-signal">
                No historical backtest data yet — run one of the scripts above.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
