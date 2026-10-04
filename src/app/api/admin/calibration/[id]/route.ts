import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/authz";
import { reviewCalibrationRecommendation } from "@/lib/calibration/apply";

const bodySchema = z.object({ decision: z.enum(["approved", "rejected"]) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = (await requireAdmin()).userId;
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const updated = await reviewCalibrationRecommendation(id, parsed.data.decision, userId);
    return NextResponse.json({ status: updated.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
