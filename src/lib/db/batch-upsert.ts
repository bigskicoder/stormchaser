import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Rows per upsert request. PostgREST takes a JSON array body, so one
 * request can carry many rows; 500 keeps each body well under typical
 * request-size limits while turning a year of daily rows into one or two
 * round trips instead of 365.
 */
export const UPSERT_BATCH_SIZE = 500;

/**
 * Upserts rows in batches instead of one request per row. The backtests and
 * SNOTEL backfills used to upsert each day separately, so a one-year chunk
 * was ~730 sequential round trips to Supabase — from a home connection that
 * dominated the run time far more than the weather-API calls did. Same
 * rows, same conflict key, same result; only the number of requests changes.
 *
 * Callers must not pass two rows with the same conflict key in one call
 * (Postgres rejects "ON CONFLICT DO UPDATE command cannot affect row a
 * second time"); every caller here builds rows from a per-date map, so
 * dates are already unique.
 */
export async function upsertInBatches(
  db: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  batchSize: number = UPSERT_BATCH_SIZE
): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await db.from(table).upsert(batch, { onConflict });
    if (error) throw error;
    written += batch.length;
  }
  return written;
}
