import { NextRequest, NextResponse } from "next/server";
import { RADAR_MAX_ZOOM, RADAR_MIN_ZOOM, RADAR_TILE_PX, iemLatestImageUrl, noaaExportImageUrl, tileBbox } from "@/lib/radar/noaa";

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
 * One radar frame as a standard 256 px map tile, for the pannable radar
 * map. Same sources and caching as /api/radar/image: NOAA MRMS, with `t`
 * (epoch ms) picking a past frame; IEM's latest composite only when no
 * time is asked for. Standard z/x/y keys mean every visitor looking at the
 * same area shares Vercel's cached tiles. Zoom is limited to the map's own
 * range so the route can't be used as a general image proxy.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await params;
  const zoom = Number(z);
  const bbox = tileBbox(zoom, Number(x), Number(y));
  if (!bbox || zoom < RADAR_MIN_ZOOM || zoom > RADAR_MAX_ZOOM) return NextResponse.json({ error: "bad tile" }, { status: 400 });

  const tRaw = req.nextUrl.searchParams.get("t");
  const t = tRaw != null ? Number(tRaw) : undefined;
  if (t != null && (!Number.isFinite(t) || t <= 0)) return NextResponse.json({ error: "bad t" }, { status: 400 });

  const size: [number, number] = [RADAR_TILE_PX, RADAR_TILE_PX];
  let body = await fetchImage(noaaExportImageUrl(bbox, t, size));
  let source = "noaa";
  if (!body && t == null) {
    body = await fetchImage(iemLatestImageUrl(bbox, size));
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
