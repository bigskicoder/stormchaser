import { notFound } from "next/navigation";
import { getServiceDb } from "@/lib/db/client";
import { draftCaption } from "@/lib/social/caption";
import { PostApprovalPanel } from "@/components/post-approval-panel";
import type { AlertFired, Resort } from "@/lib/db/types";

export const dynamic = "force-dynamic";

async function getAlert(id: string) {
  const db = getServiceDb();
  const { data, error } = await db.from("alerts_fired").select("*, resorts(*)").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as (AlertFired & { resorts: Resort }) | null;
}

export default async function AdminAlertPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const alert = await getAlert(id);
  if (!alert) notFound();

  const caption = draftCaption(alert.resorts, alert);
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? "";
  const graphicUrl = `${publicBaseUrl.replace(/\/$/, "")}/api/admin/graphic/${alert.id}`;

  return (
    <>
      <h2 style={{ fontSize: 18 }}>{alert.resorts.name}</h2>
      <p style={{ color: "#94a3b8" }}>
        Fired {new Date(alert.fired_at).toLocaleString()} &middot; {alert.recipients_count} recipients &middot;{" "}
        {alert.delivery_status}
      </p>
      <p>
        {alert.trip_opportunity_payload.estimated_snowfall_in.toFixed(1)}&quot; &middot;{" "}
        {alert.confidence_label} confidence &middot; score {(alert.powder_score_at_trigger * 100).toFixed(0)}/100
      </p>
      {!publicBaseUrl && (
        <p style={{ color: "#facc15" }}>
          PUBLIC_BASE_URL is not set — the graphic preview below won&rsquo;t load and posting will fail until it&rsquo;s
          configured (Instagram needs a publicly reachable image URL).
        </p>
      )}
      <PostApprovalPanel alertId={alert.id} graphicUrl={graphicUrl} initialCaption={caption} />
    </>
  );
}
