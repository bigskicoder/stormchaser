import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { runBacktestForDate } from "@/lib/backtest/accuracy";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const unauthorized = verifyCronRequest(req);
  if (unauthorized) return unauthorized;

  const result = await runBacktestForDate();
  return NextResponse.json(result);
}
