import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-log";
import { hourlyModelsForUtcHour, ingestModels } from "@/lib/ingestion/ingest-models";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const unauthorized = verifyCronRequest(req);
  if (unauthorized) return unauthorized;

  const result = await ingestModels(hourlyModelsForUtcHour(new Date().getUTCHours()));
  await recordCronRun("ingest-hrrr-gfs", result);
  return NextResponse.json(result);
}
