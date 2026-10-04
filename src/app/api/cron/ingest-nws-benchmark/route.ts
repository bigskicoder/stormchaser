import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { ingestNwsBenchmark } from "@/lib/ingestion/nws";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const unauthorized = verifyCronRequest(req);
  if (unauthorized) return unauthorized;

  const result = await ingestNwsBenchmark();
  return NextResponse.json(result);
}
