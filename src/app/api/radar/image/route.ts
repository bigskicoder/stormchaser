import { NextRequest, NextResponse } from "next/server";
import { iemLatestImageUrl, noaaExportImageUrl, parseBbox } from "@/lib/radar/noaa";

export const dynamic = "force-dynamic";

async function fetchImage(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000), cache: "no-store" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

/**
 * One radar frame as a transparent PNG over `bbox` (Web Mercator meters).
 * `t` (epoch ms) picks a past frame from NOAA; without it, the latest.
 * A timestamped frame never changes, so it caches for a day; the latest
 * frame caches for two minutes. Falls back to IEM's latest composite only
 * when no specific time was asked for, so a loop never mixes sources.
 */
export async function GET(req: NextRequest) {
  const bbox = parseBbox(req.nextUrl.searchParams.get("bbox"));
  if (!bbox) return NextResponse.json({ error: "bad bbox" }, { status: 400 });

  const tRaw = req.nextUrl.searchParams.get("t");
  const t = tRaw != null ? Number(tRaw) : undefined;
  if (t != null && (!Number.isFinite(t) || t <= 0)) return NextResponse.json({ error: "bad t" }, { status: 400 });

  let body = await fetchImage(noaaExportImageUrl(bbox, t));
  let source = "noaa";
  if (!body && t == null) {
    body = await fetchImage(iemLatestImageUrl(bbox));
    source = "iem";
  }
  if (!body) return NextResponse.json({ error: "radar unavailable" }, { status: 502 });

  return new NextResponse(body, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": t != null ? "public, s-maxage=86400, max-age=3600" : "public, s-maxage=120, max-age=60",
      "X-Radar-Source": source,
    },
  });
}
