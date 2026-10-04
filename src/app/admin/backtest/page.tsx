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

export default async function AdminBacktestPage() {
  const summary = await getAccuracySummary();

  const byResort = new Map<string, { resortName: string; powderAlert?: typeof summary[number]; nws?: typeof summary[number] }>();
  for (const row of summary) {
    const entry = byResort.get(row.resortId) ?? { resortName: row.resortName };
    if (row.source === "powder_alert") entry.powderAlert = row;
    if (row.source === "nws") entry.nws = row;
    byResort.set(row.resortId, entry);
  }

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
    </>
  );
}
