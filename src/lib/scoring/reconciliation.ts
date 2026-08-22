/**
 * Multi-model reconciliation (BUILD_PRIMER section 5.1). Weights models by
 * lead-time bucket, not statically. This is the highest-rigor component in
 * the spec — kept as pure, independently testable functions (see
 * tests/scoring/reconciliation.test.ts).
 */

import { MODEL_DISAGREEMENT_THRESHOLD, MODEL_WEIGHTS_BY_BUCKET, leadTimeBucketFor } from "@/lib/config/constants";
import type { ModelName } from "@/lib/db/types";

export interface ReconciliationResult {
  reconciledValue: number;
  modelAgreementScore: number;
  disagreementFlag: boolean;
  modelsUsed: ModelName[];
}

/**
 * Weighted-mean blend of per-model values for one resort/day/elevation-band,
 * using the weight table for the bucket implied by leadTimeHours. Missing
 * models (a pull failed, or the bucket excludes them — e.g. HRRR beyond
 * T+48h) are simply absent from `modelValues`; their weight allocation is
 * renormalized across whatever models are actually present rather than
 * silently changing the blend's total weight.
 */
export function reconcileModels(
  modelValues: Partial<Record<ModelName, number>>,
  leadTimeHours: number
): ReconciliationResult {
  const bucket = leadTimeBucketFor(leadTimeHours);
  const weightTable = MODEL_WEIGHTS_BY_BUCKET[bucket];

  const present = (Object.entries(modelValues) as Array<[ModelName, number]>).filter(
    ([model, value]) => weightTable[model] != null && Number.isFinite(value)
  );

  if (present.length === 0) {
    throw new Error(`reconcileModels: no usable model values for lead time bucket ${bucket}`);
  }

  const totalWeight = present.reduce((sum, [model]) => sum + (weightTable[model] ?? 0), 0);
  const reconciledValue = present.reduce(
    (sum, [model, value]) => sum + value * ((weightTable[model] ?? 0) / totalWeight),
    0
  );

  const values = present.map(([, v]) => v);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;

  // Guard divide-by-zero: with mean 0, only flag disagreement if models
  // genuinely differ (an epsilon guards float noise around exact zero).
  const relativeSpread = mean > 1e-6 ? (max - min) / mean : max - min > 1e-6 ? Infinity : 0;
  const disagreementFlag = relativeSpread > MODEL_DISAGREEMENT_THRESHOLD;

  // model_agreement_score: 1.0 = perfect agreement, decays linearly to 0 at
  // 100% relative spread. Engineering default, tunable post-backtest — not
  // drawn from a cited source, unlike the SLR/confidence-threshold constants.
  const modelAgreementScore = Number.isFinite(relativeSpread) ? Math.max(0, Math.min(1, 1 - relativeSpread)) : 0;

  return {
    reconciledValue,
    modelAgreementScore,
    disagreementFlag,
    modelsUsed: present.map(([model]) => model),
  };
}
