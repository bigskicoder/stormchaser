/**
 * Approves every pending calibration recommendation at once, as ONE new
 * model version (lib/calibration/approve-batch.ts). Written for Nick's
 * 2026-11-04 instruction in the project thread ("approve them", "50").
 * Rolled back like any approval: activate the parent version from
 * /admin/model-versions.
 *
 *   npx tsx scripts/approve-pending-calibrations.ts --by="Nick"
 */

import { approveCalibrationBatch } from "../src/lib/calibration/approve-batch";

async function main() {
  const by = process.argv.find((a) => a.startsWith("--by="))?.slice(5) || "admin";
  const r = await approveCalibrationBatch(null, by);
  console.log(r.approved ? `Approved ${r.approved}; activated "${r.versionName}" (${r.versionId}).` : "No pending recommendations.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
