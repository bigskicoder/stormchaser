/**
 * Prints every pending calibration proposal (read-only), biggest changes
 * first, so they can be checked without the admin panel.
 *
 *   npx tsx scripts/list-pending-calibrations.ts
 */

import { getServiceDb } from "../src/lib/db/client";

async function main() {
  const db = getServiceDb();
  const { data, error } = await db
    .from("calibration_recommendations")
    .select("enso_phase, sample_count, mean_signed_error_in, current_multiplier, recommended_multiplier, resorts(name)")
    .eq("status", "pending");
  if (error) throw error;
  type Row = { enso_phase: string | null; sample_count: number; mean_signed_error_in: number; current_multiplier: number; recommended_multiplier: number; resorts: { name: string } | null };
  const rows = ((data ?? []) as unknown as Row[]).sort(
    (a, b) => Math.abs(Math.log(b.recommended_multiplier / b.current_multiplier)) - Math.abs(Math.log(a.recommended_multiplier / a.current_multiplier))
  );
  console.log(`${rows.length} pending.`);
  for (const r of rows) {
    console.log(
      `${(r.resorts?.name ?? "?").padEnd(28)} ${(r.enso_phase ?? "base").padEnd(8)} ${Number(r.current_multiplier).toFixed(2)} -> ${Number(r.recommended_multiplier).toFixed(2)}  n=${r.sample_count}  bias=${Number(r.mean_signed_error_in).toFixed(2)}in`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
