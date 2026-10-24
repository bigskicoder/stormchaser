/**
 * Runs one calibration pass (lib/calibration/generate.ts) and prints the
 * summary. The "Calibration recommend" GitHub workflow runs it on demand;
 * the nightly historical run and the weekly Vercel cron run the same code.
 *
 *   npx tsx scripts/calibration-recommend.ts
 */

import { generateCalibrationRecommendations } from "../src/lib/calibration/generate";

async function main() {
  const result = await generateCalibrationRecommendations();
  console.log(`Proposed ${result.proposed}, skipped ${result.skipped}.`);
  for (const e of result.errors) console.log(`  error: ${e}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
