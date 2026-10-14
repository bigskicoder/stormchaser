import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/authz";
import { ModelVersionNotFoundError, setShadowing } from "@/lib/model-versions/shadow";

const bodySchema = z.object({ isShadow: z.boolean() });

/**
 * Marks (or unmarks) a version as shadow-scored — computed every live run
 * alongside the active version, for season-long comparison, never
 * public-facing. See lib/model-versions/shadow.ts.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const updated = await setShadowing(id, parsed.data.isShadow);
    return NextResponse.json({ id: updated.id, is_shadow: updated.is_shadow });
  } catch (err) {
    if (err instanceof ModelVersionNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
