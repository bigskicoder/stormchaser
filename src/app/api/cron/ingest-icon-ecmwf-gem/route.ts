import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { ingestModels } from "@/lib/ingestion/ingest-models";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const unauthorized = verifyCronRequest(req);
  if (unauthorized) return unauthorized;

  const result = await ingestModels(["icon", "ecmwf", "gem"]);
  return NextResponse.json(result);
}
