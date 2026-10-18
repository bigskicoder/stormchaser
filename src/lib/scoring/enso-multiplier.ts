import type { EnsoAdjustablePhase, EnsoPhase } from "@/lib/enso/oni";

/**
 * The SLR calibration multiplier to use for a date in a winter of `phase`
 * (ROADMAP Phase B.6): the resort's El Nino / La Nina multiplier when the
 * active model version has one for that phase, otherwise its base
 * multiplier. Neutral and unknown phases always use the base one. Shared
 * by live scoring and both backtests so they can't disagree.
 */
export function slrMultiplierForPhase(
  baseMultiplier: number,
  phaseMultipliers: Partial<Record<EnsoAdjustablePhase, number>> | undefined,
  phase: EnsoPhase | null
): number {
  if (phase === "el_nino" || phase === "la_nina") return phaseMultipliers?.[phase] ?? baseMultiplier;
  return baseMultiplier;
}
