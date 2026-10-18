import type { EnsoAdjustablePhase } from "@/lib/enso/oni";
import { getEnsoPhaseLookup } from "@/lib/enso/oni";
import type { Resort } from "@/lib/db/types";
import { getActiveModelVersion } from "@/lib/model-versions/resolve";
import { slrMultiplierForPhase } from "@/lib/scoring/enso-multiplier";

/**
 * Per-date SLR multiplier for a backtest, matching what live scoring would
 * use for that date: the base multiplier (the pinned version's, or the
 * resort's live one), swapped for the El Nino / La Nina multiplier in a
 * winter of that phase. `ensoSlrMultipliers` undefined means "the active
 * version's", the same default the base multiplier has.
 */
export async function backtestMultiplierByDate(
  resort: Resort,
  overrides: { calibrationMultiplier?: number; ensoSlrMultipliers?: Partial<Record<EnsoAdjustablePhase, number>> }
): Promise<(dateIso: string) => number> {
  const base = overrides.calibrationMultiplier ?? resort.slr_calibration_multiplier;
  const phaseMultipliers =
    overrides.ensoSlrMultipliers !== undefined
      ? overrides.ensoSlrMultipliers
      : (await getActiveModelVersion())?.resort_enso_slr_multipliers?.[resort.id];
  const lookup = await getEnsoPhaseLookup();
  return (dateIso) => slrMultiplierForPhase(base, phaseMultipliers, lookup.phaseForDate(dateIso));
}
