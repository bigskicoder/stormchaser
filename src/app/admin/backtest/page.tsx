import { getAccuracySummary } from "@/lib/backtest/accuracy";

export const dynamic = "force-dynamic";

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
      <p style={{ color: "#94a3b8" }}>
        Predicted snowfall vs. SNOTEL-observed liquid equivalent. Hit rate = predictions within &plusmn;2&Prime; of
        observed. See BUILD_PRIMER section 5.5 for the credibility-metric rationale — required reading before PART_2
        (booking) begins.
      </p>
      <p style={{ color: "#94a3b8" }}>
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
          </tr>
        </thead>
        <tbody>
          {Array.from(byResort.values()).map(({ resortName, powderAlert, nws }) => (
            <tr key={resortName}>
              <td>{resortName}</td>
              <td>{powderAlert?.sampleCount ?? "—"}</td>
              <td>{powderAlert ? `${powderAlert.meanAbsoluteErrorIn.toFixed(2)}"` : "—"}</td>
              <td>{powderAlert ? `${powderAlert.hitRatePct.toFixed(0)}%` : "—"}</td>
              <td>{nws?.sampleCount ?? "—"}</td>
              <td>{nws ? `${nws.meanAbsoluteErrorIn.toFixed(2)}"` : "—"}</td>
              <td>{nws ? `${nws.hitRatePct.toFixed(0)}%` : "—"}</td>
            </tr>
          ))}
          {byResort.size === 0 && (
            <tr>
              <td colSpan={7} className="no-signal">
                No backtest data yet — accumulates as the daily backtest cron runs against SNOTEL actuals.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
