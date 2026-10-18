import { getServiceDb } from "@/lib/db/client";

const MAX_LOGGED_ERRORS = 50;

/**
 * Records an ingest cron's outcome in cron_runs (migration 0013). Never
 * throws: a failure to log must not turn a partly successful ingest into a
 * failed cron.
 */
export async function recordCronRun(job: string, result: { resorts?: number; rowsWritten?: number; errors: string[] }): Promise<void> {
  try {
    await getServiceDb()
      .from("cron_runs")
      .insert({
        job,
        resorts: result.resorts ?? null,
        rows_written: result.rowsWritten ?? null,
        error_count: result.errors.length,
        errors: result.errors.slice(0, MAX_LOGGED_ERRORS),
      });
  } catch {
    // Best effort only.
  }
}
