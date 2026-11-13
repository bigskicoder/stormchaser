import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/authz";
import { approveCalibrationBatch } from "@/lib/calibration/approve-batch";

export const maxDuration = 60;

const bodySchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });

/** Approves the given pending calibration recommendations together as one model version. */
export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = (await requireAdmin()).userId;
  } catch {
    return NextResponse.json({ error: "Your admin session has ended; reload the page and enter the PIN again." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    const result = await approveCalibrationBatch(parsed.data.ids, userId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
