import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { dispatchAllTriggeredAlerts } from "@/lib/alerts/dispatch";
import { findTriggerCandidates } from "@/lib/alerts/trigger";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const unauthorized = verifyCronRequest(req);
  if (unauthorized) return unauthorized;

  const candidates = await findTriggerCandidates();
  const result = await dispatchAllTriggeredAlerts(candidates);
  return NextResponse.json({ candidates: candidates.length, ...result });
}
