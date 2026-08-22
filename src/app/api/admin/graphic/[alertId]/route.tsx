/**
 * Social graphic generation (BUILD_PRIMER section 8) via @vercel/og.
 * Deliberately NOT behind Clerk auth: the Instagram Graph API's container
 * creation call (lib/social/instagram.ts) fetches `image_url` from Meta's
 * own servers, which cannot present a Clerk session — the URL must be
 * publicly reachable. The data rendered (resort name/dates/score/inches) is
 * already public on the site itself, so this doesn't leak anything the
 * public transparency requirement (section 10.5) wouldn't already show.
 */

import { ImageResponse } from "@vercel/og";
import { getServiceDb } from "@/lib/db/client";
import type { AlertFired, Resort } from "@/lib/db/types";

export const runtime = "edge";

export async function GET(_req: Request, { params }: { params: Promise<{ alertId: string }> }) {
  const { alertId } = await params;
  const db = getServiceDb();

  const { data: alert, error: alertError } = await db
    .from("alerts_fired")
    .select("*, resorts(*)")
    .eq("id", alertId)
    .maybeSingle();

  if (alertError || !alert) {
    return new Response("alert not found", { status: 404 });
  }

  const typedAlert = alert as AlertFired & { resorts: Resort };
  const payload = typedAlert.trip_opportunity_payload;
  const resortName = typedAlert.resorts?.name ?? payload.resort_name;
  const dateLabel = new Date(payload.target_date_start).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(160deg, #0b1220 0%, #16233d 100%)",
          color: "#e8edf6",
          padding: 64,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 28, color: "#5fb0ff", fontWeight: 700 }}>POWDER ALERT</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", fontSize: 56, fontWeight: 800 }}>{resortName}</div>
          <div style={{ display: "flex", fontSize: 32, color: "#94a3b8" }}>{dateLabel}</div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 40 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 96, fontWeight: 800 }}>
              {payload.estimated_snowfall_in.toFixed(0)}&quot;
            </div>
            <div style={{ display: "flex", fontSize: 22, color: "#94a3b8" }}>forecast snowfall</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 48, fontWeight: 800, textTransform: "uppercase" }}>
              {payload.confidence_label}
            </div>
            <div style={{ display: "flex", fontSize: 22, color: "#94a3b8" }}>confidence</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 48, fontWeight: 800 }}>
              {(payload.powder_score * 100).toFixed(0)}
            </div>
            <div style={{ display: "flex", fontSize: 22, color: "#94a3b8" }}>powder score</div>
          </div>
        </div>
      </div>
    ),
    { width: 1080, height: 1080 }
  );
}
