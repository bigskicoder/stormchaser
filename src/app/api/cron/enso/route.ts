import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { refreshEnsoOni } from "@/lib/enso/oni";

export const maxDuration = 60;

/** Monthly: NOAA updates the ONI table once a month, around the 10th. */
export async function GET(req: NextRequest) {
  const unauthorized = verifyCronRequest(req);
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json(await refreshEnsoOni());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
