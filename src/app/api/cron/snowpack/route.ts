import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-log";
import { runSnowpackForAllResorts } from "@/lib/snowpack/run";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const unauthorized = verifyCronRequest(req);
  if (unauthorized) return unauthorized;

  const result = await runSnowpackForAllResorts();
  await recordCronRun("snowpack", { resorts: result.resorts, rowsWritten: result.rowsWritten, errors: result.errors });
  return NextResponse.json(result);
}
