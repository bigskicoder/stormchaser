import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/authz";
import { createBaselineVersionIfNoneExists, createModelVersion } from "@/lib/model-versions/create";
import { getModelVersionById } from "@/lib/model-versions/resolve";

const weightsByModelSchema = z.record(z.string(), z.number());

const scoringConfigSchema = z.object({
  modelWeightsByBucket: z.object({
    T0_48: weightsByModelSchema,
    T48_120: weightsByModelSchema,
    T120_PLUS: weightsByModelSchema,
  }),
  modelDisagreementThreshold: z.number(),
  ensembleConfidenceThresholds: z.object({ HIGH_MIN: z.number(), MEDIUM_MIN: z.number() }),
  ensembleSpreadNormalizationCeilingMm: z.number(),
  slrStrategyName: z.enum(["kuchera", "fixed-ratio", "cobb-waldstreicher"]),
  powderScoreWeights: z.object({ SNOWFALL: z.number(), CONFIDENCE: z.number(), LEAD_TIME_FIT: z.number() }),
  confidenceWeightByLabel: z.object({ high: z.number(), medium: z.number(), low: z.number() }),
  actionableWindowHours: z.object({ min: z.number(), max: z.number() }),
  leadTimeFitDecayPerHour: z.number(),
});

const bodySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  config: scoringConfigSchema,
  /** Branch off this version's resort_slr_multipliers + lineage instead of whatever's currently active — e.g. a "Duplicate" action on an older row. Defaults to the active version. */
  sourceVersionId: z.string().uuid().optional(),
});

/**
 * Creates a new DRAFT model version — never active on creation; see
 * lib/model-versions/activate.ts for the separate, explicit activation
 * step this endpoint deliberately does NOT perform (ROADMAP Phase C:
 * "human input... rollback options"). resort_slr_multipliers and
 * parent_version_id are always cloned from the source version server-side,
 * never taken from the request body — this endpoint is for experimenting
 * with the GLOBAL scoring config (weights/thresholds/SLR strategy), not
 * per-resort multipliers, which stay governed by the calibration
 * recommendation flow (lib/calibration/apply.ts).
 */
export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = (await requireAdmin()).userId;
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    // Falls back to the lazily-created baseline rather than erroring on a
    // fresh deploy where seed-resorts.ts's baseline step hasn't run yet —
    // same guarantee used in lib/calibration/apply.ts.
    const source = parsed.data.sourceVersionId
      ? await getModelVersionById(parsed.data.sourceVersionId)
      : await createBaselineVersionIfNoneExists();
    if (!source) {
      return NextResponse.json({ error: "source_version_not_found" }, { status: 404 });
    }

    const created = await createModelVersion({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      config: parsed.data.config,
      resortSlrMultipliers: source.resort_slr_multipliers,
      parentVersionId: source.id,
      createdBy: userId,
      status: "draft",
    });
    return NextResponse.json({ id: created.id, status: created.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
