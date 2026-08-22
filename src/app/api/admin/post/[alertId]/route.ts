import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/authz";
import { getServiceDb } from "@/lib/db/client";
import { publishToInstagram } from "@/lib/social/instagram";
import type { AlertFired } from "@/lib/db/types";
import { z } from "zod";

const bodySchema = z.object({ caption: z.string().min(1).max(2200) });

/**
 * Manual approval + publish (BUILD_PRIMER section 8): admin reviews the
 * generated graphic + caption in the UI, then hits this endpoint to
 * actually post. No automated posting path exists anywhere else in the
 * codebase — this is the one place the Instagram Graph API is called for
 * publishing.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ alertId: string }> }) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { alertId } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const db = getServiceDb();
  const { data: alertData, error: alertError } = await db.from("alerts_fired").select("*").eq("id", alertId).maybeSingle();
  if (alertError || !alertData) {
    return NextResponse.json({ error: "alert_not_found" }, { status: 404 });
  }
  const alert = alertData as AlertFired;

  const publicBaseUrl = process.env.PUBLIC_BASE_URL;
  if (!publicBaseUrl) {
    return NextResponse.json({ error: "PUBLIC_BASE_URL not configured" }, { status: 500 });
  }
  const graphicUrl = `${publicBaseUrl.replace(/\/$/, "")}/api/admin/graphic/${alertId}`;

  const { data: postRow, error: postInsertError } = await db
    .from("social_posts")
    .insert({
      alert_id: alertId,
      graphic_url: graphicUrl,
      caption_text: parsed.data.caption,
      status: "publishing",
    })
    .select()
    .single();
  if (postInsertError) {
    return NextResponse.json({ error: postInsertError.message }, { status: 500 });
  }

  try {
    const { containerId, mediaId } = await publishToInstagram({
      imageUrl: graphicUrl,
      caption: parsed.data.caption,
      onContainerCreated: async (id) => {
        await db.from("social_posts").update({ ig_container_id: id }).eq("id", postRow.id);
      },
    });

    await db
      .from("social_posts")
      .update({
        status: "posted",
        ig_container_id: containerId,
        ig_media_id: mediaId,
        posted_at: new Date().toISOString(),
      })
      .eq("id", postRow.id);

    return NextResponse.json({ status: "posted", mediaId });
  } catch (err) {
    await db.from("social_posts").update({ status: "failed" }).eq("id", postRow.id);
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
