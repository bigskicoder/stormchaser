import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { getResortBySlug, getUpcomingScoresForResort } from "@/lib/public/resort-scores";

export const dynamic = "force-dynamic";

export default async function ResortPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const resort = await getResortBySlug(slug);
  if (!resort) notFound();

  const scores = await getUpcomingScoresForResort(resort.id);

  return (
    <>
      <header className="site-header">
        <div className="container" style={{ padding: 0 }}>
          <Link href="/">&larr; all resorts</Link>
          <h1 style={{ marginTop: 8 }}>{resort.name}</h1>
          <p>
            {resort.state} &middot; {resort.pass_affiliation.toUpperCase()} &middot; base {Math.round(resort.elevation_base_m)}m
            / summit {Math.round(resort.elevation_summit_m)}m
          </p>
        </div>
      </header>
      <main className="container">
        {scores.length === 0 ? (
          <p className="no-signal">No forecast signal yet for this resort.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Est. snowfall</th>
                <th>Confidence</th>
                <th>Powder score</th>
                <th>Lead time</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((s) => (
                <tr key={s.id}>
                  <td>
                    {new Date(`${s.target_date}T00:00:00Z`).toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                  <td>{s.is_rain_case ? "Rain" : `${s.estimated_snowfall_in.toFixed(1)}"`}</td>
                  <td>
                    <ConfidenceBadge label={s.confidence_label} />
                  </td>
                  <td>{(s.powder_score * 100).toFixed(0)}/100</td>
                  <td>{Math.round(s.lead_time_hours)}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="disclaimer">
          Estimated snowfall is a multi-model reconciled forecast, converted from liquid equivalent via the Kuchera
          snow-to-liquid method. Not a guarantee — always check the resort&rsquo;s own snow report and your local
          avalanche center before making trip decisions.
        </p>
      </main>
    </>
  );
}
