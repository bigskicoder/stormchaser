/**
 * Social graphic generation (BUILD_PRIMER section 8) via @vercel/og.
 * Deliberately NOT behind Clerk auth: the Instagram Graph API's container
 * creation call (lib/social/instagram.ts) fetches `image_url` from Meta's
 * own servers, which cannot present a Clerk session — the URL must be
 * publicly reachable. The data rendered (resort name/dates/score/inches) is
 * already public on the site itself, so this doesn't leak anything the
 * public transparency requirement (section 10.5) wouldn't already show.
 *
 * Visual design matches the public site's "alpine night" palette (Phase D,
 * ROADMAP.md) — @vercel/og renders via Satori, which doesn't support CSS
 * custom properties, so the tokens from globals.css are repeated here as
 * literal values rather than shared. Keep these two in sync by hand if the
 * palette changes.
 *
 * The brand mark is drawn as three rotated CSS divs, not a snowflake
 * glyph/emoji — tried "❄" first and Satori's default font silently drops
 * it (renders as nothing, not a tofu box), confirmed by rendering in
 * isolation before committing to this approach. Pure CSS shapes are
 * guaranteed to render; font glyph coverage in Satori is not.
 */

import { ImageResponse } from "@vercel/og";
import { getServiceDb } from "@/lib/db/client";
import type { AlertFired, ConfidenceLabel, Resort } from "@/lib/db/types";

export const runtime = "edge";

const CONFIDENCE_COLORS: Record<ConfidenceLabel, string> = {
  high: "#34d399",
  medium: "#fbbf24",
  low: "#8d9ab8",
};

function BrandMark() {
  const line = (rotate: number) => (
    <div
      style={{
        position: "absolute",
        width: 3,
        height: 22,
        background: "#9bd0ff",
        borderRadius: 2,
        top: 5,
        left: 18.5,
        transform: `rotate(${rotate}deg)`,
        transformOrigin: "1.5px 11px",
        display: "flex",
      }}
    />
  );
  return (
    <div
      style={{
        display: "flex",
        width: 40,
        height: 40,
        borderRadius: 12,
        background: "rgba(95, 176, 255, 0.14)",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
      }}
    >
      {line(0)}
      {line(60)}
      {line(120)}
    </div>
  );
}

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
  const confidenceColor = CONFIDENCE_COLORS[payload.confidence_label];

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(160deg, #090d16 0%, #0f1830 55%, #10182b 100%)",
          color: "#eef2fb",
          padding: 72,
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {/* confidence-colored glow, echoes the badge color system from the site */}
        <div
          style={{
            position: "absolute",
            top: -160,
            right: -160,
            width: 520,
            height: 520,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${confidenceColor} 0%, transparent 70%)`,
            opacity: 0.35,
            display: "flex",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <BrandMark />
          <div style={{ display: "flex", fontSize: 22, color: "#8d9ab8", fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>
            Powder Alert
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", fontSize: 72, fontWeight: 800, letterSpacing: -2, lineHeight: 1.02 }}>{resortName}</div>
          <div style={{ display: "flex", fontSize: 30, color: "#8d9ab8", fontWeight: 500 }}>{dateLabel}</div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", gap: 56 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 128, fontWeight: 800, letterSpacing: -4, lineHeight: 1 }}>
              {payload.estimated_snowfall_in.toFixed(0)}&quot;
            </div>
            <div style={{ display: "flex", fontSize: 20, color: "#8d9ab8", marginTop: 6, fontWeight: 500 }}>forecast snowfall</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 36,
                fontWeight: 800,
                textTransform: "uppercase",
                color: confidenceColor,
              }}
            >
              <div style={{ display: "flex", width: 14, height: 14, borderRadius: "50%", background: confidenceColor }} />
              {payload.confidence_label}
            </div>
            <div style={{ display: "flex", fontSize: 20, color: "#8d9ab8", marginTop: 6, fontWeight: 500 }}>confidence</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 36, fontWeight: 800 }}>{(payload.powder_score * 100).toFixed(0)}/100</div>
            <div style={{ display: "flex", fontSize: 20, color: "#8d9ab8", marginTop: 6, fontWeight: 500 }}>powder score</div>
          </div>
        </div>
      </div>
    ),
    { width: 1080, height: 1080 }
  );
}
