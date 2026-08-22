import Link from "next/link";
import { getServiceDb } from "@/lib/db/client";
import type { AlertFired, Resort, SocialPost } from "@/lib/db/types";

export const dynamic = "force-dynamic";

async function getRecentAlerts() {
  const db = getServiceDb();
  const { data, error } = await db
    .from("alerts_fired")
    .select("*, resorts(name, slug), social_posts(status)")
    .order("fired_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as Array<AlertFired & { resorts: Pick<Resort, "name" | "slug">; social_posts: Pick<SocialPost, "status">[] }>;
}

export default async function AdminHomePage() {
  const alerts = await getRecentAlerts();

  return (
    <>
      <p>
        <Link href="/admin/backtest">Forecast accuracy report &rarr;</Link>
      </p>
      <h2 style={{ fontSize: 16, marginTop: 24 }}>Recent alerts</h2>
      <table>
        <thead>
          <tr>
            <th>Fired</th>
            <th>Resort</th>
            <th>Score</th>
            <th>Confidence</th>
            <th>Delivery</th>
            <th>Social post</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((a) => (
            <tr key={a.id}>
              <td>{new Date(a.fired_at).toLocaleString()}</td>
              <td>
                <Link href={`/admin/alerts/${a.id}`}>{a.resorts?.name}</Link>
              </td>
              <td>{(a.powder_score_at_trigger * 100).toFixed(0)}/100</td>
              <td>{a.confidence_label}</td>
              <td>{a.delivery_status}</td>
              <td>{a.social_posts?.[0]?.status ?? "not started"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
