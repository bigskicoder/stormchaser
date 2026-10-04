import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { generateCalibrationRecommendations } from "@/lib/calibration/generate";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const unauthorized = verifyCronRequest(req);
  if (unauthorized) return unauthorized;

  const result = await generateCalibrationRecommendations();
  return NextResponse.json(result);
}
