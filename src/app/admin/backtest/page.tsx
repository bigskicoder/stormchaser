import { getAccuracySummary } from "@/lib/backtest/accuracy";

export const dynamic = "force-dynamic";

export default async function AdminBacktestPage() {
  const summary = await getAccuracySummary();

  return (
    <>
      <h2 style={{ fontSize: 18 }}>Forecast accuracy (season-to-date)</h2>
      <p style={{ color: "#94a3b8" }}>
        Predicted snowfall vs. SNOTEL-observed liquid equivalent, converted back through the same SLR used at
        prediction time. Hit rate = predictions within &plusmn;2&Prime; of observed. See BUILD_PRIMER section 5.5 for
        the credibility-metric rationale — required reading before PART_2 (booking) begins.
      </p>
      <table>
        <thead>
          <tr>
            <th>Resort</th>
            <th>Samples</th>
            <th>Mean abs. error</th>
            <th>Hit rate</th>
          </tr>
        </thead>
        <tbody>
          {summary.map((s) => (
            <tr key={s.resortId}>
              <td>{s.resortName}</td>
              <td>{s.sampleCount}</td>
              <td>{s.meanAbsoluteErrorIn.toFixed(2)}&quot;</td>
              <td>{s.hitRatePct.toFixed(0)}%</td>
            </tr>
          ))}
          {summary.length === 0 && (
            <tr>
              <td colSpan={4} className="no-signal">
                No backtest data yet — accumulates as the daily backtest cron runs against SNOTEL actuals.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
