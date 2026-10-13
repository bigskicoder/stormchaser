import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/authz";
import { activateModelVersion, ModelVersionNotFoundError } from "@/lib/model-versions/activate";

/**
 * Activates any model_versions row — a draft (promoting an experiment to
 * live) or an archived one (a rollback: "run" an older saved version
 * again). Same code path either way, see activateModelVersion's own doc
 * comment on why rollback isn't a separate operation.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = (await requireAdmin()).userId;
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  try {
    const activated = await activateModelVersion(id, userId);
    return NextResponse.json({ id: activated.id, status: activated.status });
  } catch (err) {
    if (err instanceof ModelVersionNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
