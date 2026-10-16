import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { ingestSnotelActuals } from "@/lib/ingestion/snotel";
import { ingestMansfieldStakeActuals } from "@/lib/ingestion/mansfield-stake";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const unauthorized = verifyCronRequest(req);
  if (unauthorized) return unauthorized;

  // Both write ground-truth rows into the same snotel_actuals table (see
  // migration 0011's `source` column) — run together under this one route
  // rather than adding a second Vercel Cron schedule entry for what's
  // currently a single additional station (ROADMAP: Mansfield stake).
  const [snotel, mansfield] = await Promise.all([ingestSnotelActuals(), ingestMansfieldStakeActuals()]);
  return NextResponse.json({ snotel, mansfield });
}
