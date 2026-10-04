import Link from "next/link";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { StatusBadge } from "@/components/status-badge";
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

async function getDashboardStats() {
  const db = getServiceDb();
  const [resortsRes, pendingCalibrationRes, alerts30dRes] = await Promise.all([
    db.from("resorts").select("id", { count: "exact", head: true }).eq("active", true),
    db.from("calibration_recommendations").select("id", { count: "exact", head: true }).eq("status", "pending"),
    db
      .from("alerts_fired")
      .select("id", { count: "exact", head: true })
      .gte("fired_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
  ]);
  return {
    activeResorts: resortsRes.count ?? 0,
    pendingCalibration: pendingCalibrationRes.count ?? 0,
    alertsLast30d: alerts30dRes.count ?? 0,
  };
}

export default async function AdminHomePage() {
  const [alerts, stats] = await Promise.all([getRecentAlerts(), getDashboardStats()]);

  return (
    <>
      <div className="admin-stat-row">
        <div className="admin-stat-card">
          <div className="num">{stats.activeResorts}</div>
          <div className="label">Active resorts</div>
        </div>
        <div className="admin-stat-card">
          <div className="num">{stats.alertsLast30d}</div>
          <div className="label">Alerts fired (30d)</div>
        </div>
        <div className="admin-stat-card">
          <div className="num">{stats.pendingCalibration}</div>
          <div className="label">
            {stats.pendingCalibration > 0 ? (
              <Link href="/admin/calibration">Pending calibration reviews &rarr;</Link>
            ) : (
              "Pending calibration reviews"
            )}
          </div>
        </div>
      </div>

      <h2 style={{ fontSize: 16 }}>Recent alerts</h2>
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
              <td data-label="Fired">{new Date(a.fired_at).toLocaleString()}</td>
              <td data-label="Resort">
                <Link href={`/admin/alerts/${a.id}`}>{a.resorts?.name}</Link>
              </td>
              <td data-label="Score">{(a.powder_score_at_trigger * 100).toFixed(0)}/100</td>
              <td data-label="Confidence">
                <ConfidenceBadge label={a.confidence_label} />
              </td>
              <td data-label="Delivery">
                <StatusBadge status={a.delivery_status} />
              </td>
              <td data-label="Social post">
                <StatusBadge status={a.social_posts?.[0]?.status ?? "not started"} />
              </td>
            </tr>
          ))}
          {alerts.length === 0 && (
            <tr>
              <td colSpan={6} className="no-signal">
                No alerts fired yet — accumulates once the scoring/alert cron pipeline is live.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
