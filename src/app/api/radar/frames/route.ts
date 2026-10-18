import { NextResponse } from "next/server";
import { NOAA_RADAR_SERVICE, framesFromTimeExtent } from "@/lib/radar/noaa";

export const dynamic = "force-dynamic";

/**
 * The radar loop's frame times, from NOAA's own time extent so we never ask
 * for a frame that doesn't exist yet. If NOAA is down, `frames` is empty and
 * the panel shows the IEM latest frame without a loop.
 */
export async function GET() {
  try {
    const res = await fetch(`${NOAA_RADAR_SERVICE}?f=json`, {
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 120 },
    });
    if (!res.ok) throw new Error(`NOAA radar metadata HTTP ${res.status}`);
    const json = (await res.json()) as { timeInfo?: { timeExtent?: unknown } };
    const frames = framesFromTimeExtent(json.timeInfo?.timeExtent);
    return NextResponse.json(
      { source: frames.length > 0 ? "noaa" : "iem", frames },
      { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" } }
    );
  } catch {
    return NextResponse.json(
      { source: "iem", frames: [] },
      { headers: { "Cache-Control": "public, s-maxage=60" } }
    );
  }
}
